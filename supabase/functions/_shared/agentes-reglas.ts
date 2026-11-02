// DF2 — reglas deterministas puras de los agentes (Vigía/Capataz/Soporte).
// Separadas de Deno.serve para poder testearlas con `deno test` sin red/DB.

export function transcripcionAtascada(estado: string, creadaEnIso: string, ahoraIso: string, minutos = 30): boolean {
  if (estado !== "procesando") return false;
  const edadMin = (Date.parse(ahoraIso) - Date.parse(creadaEnIso)) / 60000;
  return edadMin >= minutos;
}

export function envioAtascado(resuelto: boolean, categoria: string, ultimaVezIso: string, ahoraIso: string, horas = 2): boolean {
  if (resuelto || categoria !== "sistema") return false;
  const edadHoras = (Date.parse(ahoraIso) - Date.parse(ultimaVezIso)) / 3_600_000;
  return edadHoras >= horas;
}

export function errorEsRepetido(conteo: number, umbral = 5): boolean {
  return conteo >= umbral;
}

export function obraSinBitacoraHoy(proyectoId: string, idsConBitacoraHoy: ReadonlySet<string>): boolean {
  return !idsConBitacoraHoy.has(proyectoId);
}

export function reporteSinResponder(
  estado: string,
  respuestaAdmin: string | null,
  creadoEnIso: string,
  ahoraIso: string,
  horas = 48,
): boolean {
  if (estado !== "abierto" || respuestaAdmin) return false;
  const edadHoras = (Date.parse(ahoraIso) - Date.parse(creadoEnIso)) / 3_600_000;
  return edadHoras >= horas;
}

export function dedupClaveError(errorType: string, message: string): string {
  return `${errorType}::${message}`;
}

// Espejo puro de sgc.agente_bajo_tope(text) — mismo `<` que la función SQL.
// Ningún agente llama IA todavía (todos son deterministas, costo 0), así que
// hoy esto siempre da `true`; queda listo para cuando Cronista/Capataz sumen
// un paso de diagnóstico con Claude y necesiten cortar a "solo determinista".
export function agenteBajoTope(costoHoyUsd: number, topeDiarioUsd: number): boolean {
  return costoHoyUsd < topeDiarioUsd;
}
