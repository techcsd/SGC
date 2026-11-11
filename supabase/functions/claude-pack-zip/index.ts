import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { buildStoreZip } from "../_shared/zip.ts";

// ============================================================================
// DM1 (ronda DM, PROMPT 140 F1) — DM-12: zip de un pack completo (Setup inicial
// o uno por rol) con LEEME + guías + las skills que el pack trae, en un solo
// archivo. Respeta RLS: solo arma el zip con las skills que el que pide SÍ
// puede ver (lo mismo que vería en la biblioteca).
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function leemeGeneral(nombrePack: string, items: string[]): string {
  const fecha = new Date().toISOString().slice(0, 10);
  return [
    `# ${nombrePack} — LEEME-INSTALAR (generado ${fecha})`,
    "",
    "Este paquete trae:",
    ...items.map((i) => `- ${i}`),
    "",
    "## Cómo instalarlo",
    "1. Claude Desktop/claude.ai → Configuración → Capacidades → Skills → «Subir skill» (una carpeta por skill).",
    "2. En el celular: comparte este archivo hacia la app de Claude.",
    "3. Está bien que traiga skills que no uses todavía — revísalas cuando las necesites.",
    "",
    "**Regla de oro de datos:** no pegues en Claude cédulas, claves, contraseñas, datos de nómina ni contratos completos de terceros. Claude solo ve lo que tu usuario ya ve en el SGC.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado." }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, db: { schema: "sgc" } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: "No autorizado." }, 401);

  const body = await req.json().catch(() => ({}));
  const packId = body.pack_id as string | undefined;
  if (!packId) return json({ error: "Falta pack_id." }, 400);

  const { data: pack } = await caller.from("claude_packs").select("id, nombre, slug").eq("id", packId).maybeSingle();
  if (!pack) return json({ error: "Paquete no encontrado." }, 404);

  const { data: items } = await caller
    .from("claude_pack_items")
    .select("tipo_item, titulo, contenido, orden, skill_id, claude_skills(id, nombre, slug, version_actual)")
    .eq("pack_id", packId)
    .order("orden");

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const archivos: { name: string; data: Uint8Array }[] = [];
  const nombresParaLeeme: string[] = [];

  for (const it of items ?? []) {
    if (it.tipo_item !== "skill") {
      if (it.contenido) {
        archivos.push({ name: `${(it.titulo ?? "nota").replace(/[^a-z0-9-]+/gi, "-")}.md`, data: new TextEncoder().encode(it.contenido) });
        nombresParaLeeme.push(it.titulo ?? "Nota");
      }
      continue;
    }
    // RLS de la select de arriba ya filtró: si claude_skills viene null, esa
    // skill no era visible para esta persona (join con RLS de claude_skills).
    const skill = it.claude_skills as { id: string; nombre: string; slug: string; version_actual: number } | null;
    if (!skill) continue;
    const { data: version } = await caller
      .from("claude_skill_versiones")
      .select("storage_path")
      .eq("skill_id", skill.id)
      .eq("version", skill.version_actual)
      .maybeSingle();
    if (!version) continue;
    const { data: archivo } = await svc.storage.from("claude-skills").download(version.storage_path);
    if (!archivo) continue;
    const nombreArchivo = version.storage_path.split("/").pop() ?? `${skill.slug}.md`;
    archivos.push({ name: `skills/${skill.slug}/${nombreArchivo}`, data: new Uint8Array(await archivo.arrayBuffer()) });
    nombresParaLeeme.push(skill.nombre);
  }

  archivos.unshift({ name: "LEEME-INSTALAR.md", data: new TextEncoder().encode(leemeGeneral(pack.nombre, nombresParaLeeme)) });

  const zip = buildStoreZip(archivos);
  return new Response(zip, {
    status: 200,
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${pack.slug}.zip"` },
  });
});
