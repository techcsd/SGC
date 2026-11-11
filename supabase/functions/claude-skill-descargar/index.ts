import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { buildStoreZip } from "../_shared/zip.ts";

// ============================================================================
// DM1 (ronda DM, PROMPT 140 F1) — DM-08: descarga de una skill ya (zip válido),
// con un LEEME-INSTALAR.md generado con la fecha y los pasos de la superficie
// vigente de Claude (releída en F0, docs/CLAUDE-MODULO.md). RLS la aplica el
// cliente con el JWT de quien pide (no se usa service_role para decidir qué ve).
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function leeme(nombres: string[]): string {
  const fecha = new Date().toISOString().slice(0, 10);
  return [
    `# Cómo instalar (generado ${fecha})`,
    "",
    `Trae: ${nombres.join(", ")}.`,
    "",
    "## Claude Desktop / claude.ai",
    "1. Entra a Configuración → Capacidades → Skills.",
    "2. Sube cada carpeta (o el .zip de una sola skill) con «Subir skill».",
    "3. Confírmala y actívala para tu cuenta.",
    "",
    "## Celular (app de Claude)",
    "1. Comparte este archivo hacia la app de Claude (botón Compartir).",
    "2. Si tu plan no permite subir skills desde el celular, hazlo primero desde la computadora — se sincroniza solo.",
    "",
    "**Regla de oro de datos:** no pegues en Claude cédulas, claves, contraseñas, datos de nómina ni contratos completos de terceros.",
    "",
    "_Pasos según la documentación vigente de Claude al día de hoy — puede cambiar (producto en beta); revisa docs/CLAUDE-MODULO.md si algo no coincide._",
  ].join("\n");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado." }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, db: { schema: "sgc" } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: "No autorizado." }, 401);

  const body = await req.json().catch(() => ({}));
  const skillId = body.skill_id as string | undefined;
  if (!skillId) return json({ error: "Falta skill_id." }, 400);

  // Esta select pasa por RLS de sgc.claude_skills (lo mío + publicado para mi
  // rol/empresa): si no la puede ver, data vuelve null y se corta aquí.
  const { data: skill } = await caller
    .from("claude_skills")
    .select("id, nombre, slug, version_actual")
    .eq("id", skillId)
    .maybeSingle();
  if (!skill) return json({ error: "No tienes acceso a esta skill." }, 403);

  const { data: version } = await caller
    .from("claude_skill_versiones")
    .select("storage_path")
    .eq("skill_id", skillId)
    .eq("version", skill.version_actual)
    .maybeSingle();
  if (!version) return json({ error: "Esta skill no tiene un archivo guardado." }, 404);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: archivo, error: descargaError } = await svc.storage.from("claude-skills").download(version.storage_path);
  if (descargaError || !archivo) return json({ error: "No se pudo leer el archivo guardado." }, 500);

  const nombreArchivo = version.storage_path.split("/").pop() ?? `${skill.slug}.md`;
  const zip = buildStoreZip([
    { name: nombreArchivo, data: new Uint8Array(await archivo.arrayBuffer()) },
    { name: "LEEME-INSTALAR.md", data: new TextEncoder().encode(leeme([skill.nombre])) },
  ]);

  return new Response(zip, {
    status: 200,
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${skill.slug}.zip"` },
  });
});
