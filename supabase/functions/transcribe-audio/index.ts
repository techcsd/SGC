import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AA22 — Transcripción automática de notas de voz.
// Barre los audios pendientes de sgc.audio_notas (bucket,path) y
// sgc.bitacora_archivos (bucket 'sgc-bitacora', path=url) y los transcribe con
// un proveedor STT configurable por secret:
//   STT_PROVIDER  = 'openai' (default) | 'groq'
//   STT_API_KEY   = la API key del proveedor (secret del proyecto)
//   STT_MODEL     = opcional (default por proveedor)
// Invocada por pg_cron con x-sync-secret. Si no hay STT_API_KEY, no toca nada
// (no gasta reintentos): cuando pongas la key, procesa todos los pendientes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const PROVIDERS: Record<string, { url: string; model: string }> = {
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
};

const MAX_INTENTOS = 3;
const BATCH = 20;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const expected = Deno.env.get("STT_SYNC_SECRET") ?? Deno.env.get("INFRA_SYNC_SECRET");
  if (expected && req.headers.get("x-sync-secret") !== expected) {
    return json({ error: "No autorizado." }, 401);
  }

  const providerKey = (Deno.env.get("STT_PROVIDER") ?? "openai").toLowerCase();
  const provider = PROVIDERS[providerKey] ?? PROVIDERS.openai;
  const apiKey = Deno.env.get("STT_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("STT_MODEL") ?? provider.model;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );

  // Si no hay key configurada aún: no tocar nada (no gastar reintentos).
  if (!apiKey) {
    const { count: a } = await admin.from("audio_notas").select("id", { count: "exact", head: true })
      .in("transcripcion_estado", ["pendiente", "fallida"]);
    const { count: b } = await admin.from("bitacora_archivos").select("id", { count: "exact", head: true })
      .in("transcripcion_estado", ["pendiente", "fallida"]);
    return json({ ok: false, reason: "STT_API_KEY no configurado", pendientes: (a ?? 0) + (b ?? 0) });
  }

  async function transcribir(bucket: string, path: string): Promise<string> {
    const { data: blob, error } = await admin.storage.from(bucket).download(path);
    if (error || !blob) throw new Error(`descarga: ${error?.message ?? "sin archivo"}`);
    const ext = (path.split(".").pop() || "webm").split("?")[0];
    const form = new FormData();
    form.append("file", blob, `audio.${ext}`);
    form.append("model", model);
    form.append("language", "es");
    const res = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`STT ${res.status}: ${txt.slice(0, 300)}`);
    try { return (JSON.parse(txt).text ?? "").trim(); } catch { return txt.trim(); }
  }

  let ok = 0, fail = 0;

  // audio_notas
  const { data: ans } = await admin.from("audio_notas")
    .select("id, bucket, path, transcripcion_intentos")
    .in("transcripcion_estado", ["pendiente", "fallida"])
    .lt("transcripcion_intentos", MAX_INTENTOS)
    .limit(BATCH);
  for (const r of ans ?? []) {
    await admin.from("audio_notas").update({ transcripcion_estado: "procesando" }).eq("id", r.id);
    try {
      const t = await transcribir(r.bucket, r.path);
      await admin.from("audio_notas").update({
        transcripcion: t, transcripcion_estado: "completada", transcrito_at: new Date().toISOString(), transcripcion_error: null,
      }).eq("id", r.id);
      ok++;
    } catch (e) {
      await admin.from("audio_notas").update({
        transcripcion_estado: "fallida", transcripcion_error: String(e instanceof Error ? e.message : e).slice(0, 400),
        transcripcion_intentos: (r.transcripcion_intentos ?? 0) + 1,
      }).eq("id", r.id);
      fail++;
    }
  }

  // bitacora_archivos (bucket fijo sgc-bitacora; path = url)
  const { data: bas } = await admin.from("bitacora_archivos")
    .select("id, url, transcripcion_intentos")
    .in("transcripcion_estado", ["pendiente", "fallida"])
    .lt("transcripcion_intentos", MAX_INTENTOS)
    .limit(BATCH);
  for (const r of bas ?? []) {
    await admin.from("bitacora_archivos").update({ transcripcion_estado: "procesando" }).eq("id", r.id);
    try {
      const t = await transcribir("sgc-bitacora", r.url);
      await admin.from("bitacora_archivos").update({
        transcripcion: t, transcripcion_estado: "completada", transcrito_at: new Date().toISOString(), transcripcion_error: null,
      }).eq("id", r.id);
      ok++;
    } catch (e) {
      await admin.from("bitacora_archivos").update({
        transcripcion_estado: "fallida", transcripcion_error: String(e instanceof Error ? e.message : e).slice(0, 400),
        transcripcion_intentos: (r.transcripcion_intentos ?? 0) + 1,
      }).eq("id", r.id);
      fail++;
    }
  }

  return json({ ok: true, provider: providerKey, model, transcritos: ok, fallidos: fail });
});
