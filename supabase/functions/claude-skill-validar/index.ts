import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { readZipCentralDirectory, extractZipEntry } from "../_shared/zip.ts";
import { escanearSkillMd, combinarResultados, TAMANO_MAXIMO_BYTES, ResultadoEscaneo } from "../_shared/claude-skill-escaneo.ts";

// ============================================================================
// DM1 (ronda DM, PROMPT 140 F1) — valida un archivo antes de guardarlo como
// skill (DM-05): tamaño, estructura de SKILL.md, nombre/descripción, secretos
// y código ejecutable. Guarda el archivo en el bucket privado `claude-skills`
// y crea/versiona la fila en sgc.claude_skills si pasa (o si el único problema
// es "requiere revisión" por traer código — DM-06 permite guardar igual).
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = envRequerido("SUPABASE_ANON_KEY");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado." }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: "No autorizado." }, 401);

  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  const slug = String(form?.get("slug") ?? "").trim();
  const nombre = String(form?.get("nombre") ?? "").trim();
  const descripcion = String(form?.get("descripcion") ?? "").trim();
  const skillId = form?.get("skill_id") ? String(form.get("skill_id")) : null;
  if (!(archivo instanceof File)) return json({ error: "Falta el archivo." }, 400);
  if (!slug || !/^[a-z0-9-]{1,64}$/.test(slug)) return json({ error: "Slug inválido (minúsculas y guiones, máx. 64)." }, 400);

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (bytes.length > TAMANO_MAXIMO_BYTES) {
    return json({ ok: false, errores: [`El archivo pesa más de ${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB.`], avisos: [] });
  }

  const esZip = archivo.name.toLowerCase().endsWith(".zip");
  let resultado: ResultadoEscaneo;

  try {
    if (esZip) {
      const entries = readZipCentralDirectory(bytes);
      const skillMd = entries.find((e) => /(^|\/)SKILL\.md$/i.test(e.name));
      if (!skillMd) return json({ ok: false, errores: ["El .zip no trae un archivo SKILL.md."], avisos: [] });
      const contenidoSkillMd = new TextDecoder().decode(await extractZipEntry(bytes, skillMd));
      const resultadosPorArchivo: ResultadoEscaneo[] = [escanearSkillMd(contenidoSkillMd, "SKILL.md", true)];
      for (const e of entries) {
        if (e.name === skillMd.name) continue;
        if (e.name.endsWith("/")) continue;
        const contenido = /\.(md|txt|json|yaml|yml)$/i.test(e.name)
          ? new TextDecoder().decode(await extractZipEntry(bytes, e))
          : "";
        resultadosPorArchivo.push(escanearSkillMd(contenido, e.name, false));
      }
      resultado = combinarResultados(resultadosPorArchivo);
    } else {
      const contenido = new TextDecoder().decode(bytes);
      resultado = escanearSkillMd(contenido, archivo.name, false);
    }
  } catch (e) {
    return json({ ok: false, errores: [e instanceof Error ? e.message : "No se pudo leer el archivo."], avisos: [] });
  }

  // Secreto duro = rechazo. Código ejecutable NO bloquea el guardado personal
  // (DM-06): se guarda igual, pero queda marcado para requerir revisión al
  // proponerla a rol/empresa.
  if (!resultado.ok) return json({ ok: false, ...resultado });

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "sgc" } });
  const sha256 = await sha256Hex(bytes);
  const storagePath = `${userData.user.id}/${slug}/${Date.now()}-${archivo.name}`;

  const { error: uploadError } = await svc.storage.from("claude-skills").upload(storagePath, bytes, {
    contentType: esZip ? "application/zip" : "text/markdown",
  });
  if (uploadError) return json({ ok: false, errores: [`No se pudo guardar el archivo: ${uploadError.message}`], avisos: [] }, 500);

  let finalSkillId = skillId;
  if (!finalSkillId) {
    const { data: creada, error: crearError } = await svc
      .from("claude_skills")
      .insert({
        slug, nombre: nombre || resultado.nombreDetectado || slug,
        descripcion: descripcion || resultado.descripcionDetectada || "Sin descripción.",
        owner_id: userData.user.id, tiene_codigo_ejecutable: resultado.tieneCodigoEjecutable,
      })
      .select("id")
      .single();
    if (crearError) return json({ ok: false, errores: [crearError.message], avisos: [] }, 500);
    finalSkillId = creada.id;
  } else {
    const { data: actual } = await svc.from("claude_skills").select("version_actual").eq("id", finalSkillId).single();
    await svc.from("claude_skills").update({
      tiene_codigo_ejecutable: resultado.tieneCodigoEjecutable, version_actual: (actual?.version_actual ?? 0) + 1, updated_at: new Date().toISOString(),
    }).eq("id", finalSkillId);
  }

  const { data: versionActual } = await svc.from("claude_skills").select("version_actual").eq("id", finalSkillId).single();
  await svc.from("claude_skill_versiones").insert({
    skill_id: finalSkillId, version: versionActual?.version_actual ?? 1,
    storage_path: storagePath, tamano_bytes: bytes.length, sha256,
    // DM4 — texto plano SOLO para .md/.txt sueltos; lo usa leer_skill_claude
    // (conector fase 2, apagado) cuando se encienda. Un .zip no se guarda aquí
    // (RPC en SQL puro no tiene acceso a Storage para desempaquetarlo).
    contenido_texto: esZip ? null : new TextDecoder().decode(bytes),
  });

  return json({ ok: true, ...resultado, skill_id: finalSkillId, sha256 });
});
