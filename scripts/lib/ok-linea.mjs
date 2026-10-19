// scripts/lib/ok-linea.mjs — CR3 — gate de la línea "OK:" en qa/release-<version>.md.
// Separado de release-check.mjs (que tiene efectos secundarios en el top-level:
// exige --version/--env) para que scripts/release-check.test.mjs pueda importar
// SOLO la función, sin disparar el script completo.
//
// La línea tiene que EMPEZAR con "OK:" o "**OK de Xaviel**", traer una FECHA, y
// esa misma línea no puede tener "pendiente/falta/no/skip" después del prefijo
// — el hallazgo real (HANDOFF de CQ) fue "**OK de Xaviel** (pendiente)" pasando
// porque antes solo se buscaba el texto "OK de Xaviel" en cualquier parte.
const FECHA_RX = /\b\d{4}-\d{2}-\d{1,2}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}\s*[-\s]?\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-zñ]*\.?\s*[-\s]?\s*\d{2,4}\b/i;
const NEGACION_RX = /\b(pendiente|falta|no|skip)\b/i;

export function okLineaValida(contenido) {
  if (!contenido) return false;
  for (const linea of contenido.split('\n')) {
    const t = linea.trim();
    const m = t.match(/^(OK:|\*\*OK de Xaviel\*\*)\s*(.*)$/i);
    if (!m) continue;
    const resto = m[2] ?? '';
    if (FECHA_RX.test(t) && !NEGACION_RX.test(resto)) return true;
  }
  return false;
}
