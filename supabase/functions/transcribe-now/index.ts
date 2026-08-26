import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// AZ5 — Transcripción SÍNCRONA de una nota de voz (para Compa en la app móvil).
//
// A diferencia de `transcribe-audio` (barrido por pg_cron de audios YA guardados
// en la BD, protegido con x-sync-secret), esta función recibe el blob de audio
// DIRECTO en el request (multipart form-data, campo `file` o `audio`) y devuelve
// la transcripción en el MISMO turno: { text }. El JWT del usuario lo verifica el
// runtime (verify_jwt por defecto) → cualquier usuario autenticado puede dictar.
//
// Usa el MISMO proveedor STT configurable por secret que transcribe-audio:
//   STT_PROVIDER  = 'openai' (default) | 'groq'
//   STT_API_KEY   = la API key del proveedor (o, de reserva, OPENAI_API_KEY)
//   STT_MODEL     = opcional (default por proveedor)
//
// Errores DIFERENCIADOS por status + código en el body, para que el cliente
// muestre la causa correcta (no un genérico "no pudimos transcribir"):
//   400 empty_audio        — no llegó audio (o venía vacío)
//   413 audio_too_large    — el audio excede el límite
//   503 stt_not_configured — no hay STT_API_KEY en el proyecto (avísale a Tecnología)
//   502 stt_failed         — el proveedor STT falló (red/servicio)
//   200 { text }           — ok (text puede venir "" si no se entendió nada)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PROVIDERS: Record<string, { url: string; model: string }> = {
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
};

// Límite defensivo: una nota de voz de Compa es corta. 25 MB es el tope de OpenAI.
const MAX_BYTES = 25 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const providerKey = (Deno.env.get("STT_PROVIDER") ?? "openai").toLowerCase();
  const provider = PROVIDERS[providerKey] ?? PROVIDERS.openai;
  const apiKey = Deno.env.get("STT_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("STT_MODEL") ?? provider.model;

  // Sin key configurada: causa específica (no un genérico) para que el cliente
  // invite a escribir y avise que es un tema de configuración, no del usuario.
  if (!apiKey) {
    return json(
      { error: "stt_not_configured", message: "El dictado por voz aún no está configurado. Avísale a Tecnología." },
      503,
    );
  }

  // Lee el audio del multipart. Aceptamos `file` (nuestro estándar) o `audio`
  // (retrocompat con el cliente anterior de Compa).
  let blob: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file") ?? form.get("audio");
    if (f instanceof File) blob = f;
  } catch {
    return json({ error: "empty_audio", message: "No recibimos el audio." }, 400);
  }

  if (!blob || blob.size === 0) {
    return json({ error: "empty_audio", message: "No recibimos el audio." }, 400);
  }
  if (blob.size > MAX_BYTES) {
    return json({ error: "audio_too_large", message: "La nota de voz es muy larga." }, 413);
  }

  const ext = (blob.name?.split(".").pop() || blob.type?.split("/").pop() || "webm").split(";")[0];
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", model);
  form.append("language", "es");

  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (e) {
    return json({ error: "stt_failed", message: String(e instanceof Error ? e.message : e).slice(0, 200) }, 502);
  }

  const txt = await res.text();
  if (!res.ok) {
    return json(
      { error: "stt_failed", provider: providerKey, status: res.status, message: txt.slice(0, 300) },
      502,
    );
  }

  let text = "";
  try {
    text = (JSON.parse(txt).text ?? "").trim();
  } catch {
    text = txt.trim();
  }
  return json({ text });
});
