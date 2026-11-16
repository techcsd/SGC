// DS-41 / #76 — parte diario de bitácora por voz/WhatsApp (conexión mínima, APAGADA por defecto).
// Piezas puras (sin red) para que se prueben: el interruptor, el nombre de la herramienta y el enlace a la revisión.
// Flujo: nota de voz (wa-ingest la transcribe con _shared/stt.ts) -> Compa -> herramienta `preparar_parte_diario`
// -> edge `bitacora-ia` con la sesión del usuario (guarda una PROPUESTA, nunca la bitácora) -> enlace a
// /bitacora/nueva?propuesta=<id> donde la persona revisa y confirma con el mismo formulario de siempre.

export const PARAM_PARTE_VOZ = "parte_voz_whatsapp_activo";
export const TOOL_PARTE_VOZ = "preparar_parte_diario";

/** Interruptor: solo el texto 'true' lo enciende. Cualquier otra cosa (ausente, vacío, 'false', basura) = apagado. */
export function parteVozActivo(valor: unknown): boolean {
  return String(valor ?? "").trim().toLowerCase() === "true";
}

/** Quita la herramienta del parte por voz cuando el interruptor está apagado; el resto no cambia. */
export function filtrarToolsParteVoz<T extends { name: string }>(tools: T[], activo: boolean): T[] {
  return activo ? tools : tools.filter((t) => t.name !== TOOL_PARTE_VOZ);
}

/** Enlace a la pantalla de revisión; el id debe ser un uuid (si no, se rechaza para no armar enlaces raros). */
export function enlacePropuestaParte(webUrl: string, propuestaId: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propuestaId)) return null;
  return `${webUrl.replace(/\/+$/, "")}/bitacora/nueva?propuesta=${propuestaId}`;
}

/** Valida los argumentos que manda el modelo: obra y transcripción obligatorias, fecha ISO opcional (por defecto hoy). */
export function validarArgsParte(inp: Record<string, unknown>, hoyIso: string): { ok: true; proyecto_id: string; fecha: string; transcripcion: string } | { ok: false; error: string } {
  const proyecto_id = String(inp.proyecto_id ?? "").trim();
  const transcripcion = String(inp.transcripcion ?? "").trim();
  const fecha = String(inp.fecha ?? "").trim() || hoyIso;
  if (!proyecto_id) return { ok: false, error: "Falta la obra (proyecto_id)." };
  if (transcripcion.length < 10) return { ok: false, error: "Falta lo que dijo la persona (transcripción)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "La fecha debe ser YYYY-MM-DD." };
  return { ok: true, proyecto_id, fecha, transcripcion: transcripcion.slice(0, 6000) };
}
