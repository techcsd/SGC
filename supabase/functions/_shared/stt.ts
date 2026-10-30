// _shared/stt.ts — DC4 (ronda DC) — extrae la llamada al proveedor de
// transcripción de voz (antes solo en transcribe-audio/index.ts, AA22) para que
// whatsapp-webhook (notas de voz de WhatsApp) use la MISMA implementación.
// Proveedor configurable por secret: STT_PROVIDER ('openai'|'groq'), STT_API_KEY,
// STT_MODEL (opcional).

export const STT_PROVIDERS: Record<string, { url: string; model: string }> = {
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
};

export interface SttConfig {
  provider: string;
  apiKey: string;
  model: string;
}

// Si no hay STT_API_KEY configurado, devuelve null (el llamador decide qué
// hacer — en transcribe-audio: no tocar nada; en whatsapp-webhook: avisar al
// usuario que todavía no se pueden escuchar notas de voz).
export function resolverSttConfig(): SttConfig | null {
  const apiKey = Deno.env.get("STT_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const providerKey = (Deno.env.get("STT_PROVIDER") ?? "openai").toLowerCase();
  const provider = STT_PROVIDERS[providerKey] ?? STT_PROVIDERS.openai;
  const model = Deno.env.get("STT_MODEL") ?? provider.model;
  return { provider: providerKey, apiKey, model };
}

export async function transcribirAudio(blob: Blob, ext: string, cfg: SttConfig): Promise<string> {
  const provider = STT_PROVIDERS[cfg.provider] ?? STT_PROVIDERS.openai;
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", cfg.model);
  form.append("language", "es");
  const res = await fetch(provider.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`STT ${res.status}: ${txt.slice(0, 300)}`);
  try { return (JSON.parse(txt).text ?? "").trim(); } catch { return txt.trim(); }
}
