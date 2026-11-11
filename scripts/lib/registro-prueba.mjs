// scripts/lib/registro-prueba.mjs — DN-14 (ronda DN, PROMPT 142) — release-check
// aprobaba con solo que qa/release-<version>.md existiera y no fuera un stub,
// sin verificar que alguien hubiera marcado una sola casilla real ni dejado
// constancia de quién probó. Este gate exige las dos cosas:
//   1. al menos una casilla `- [x]` marcada (no todas `- [ ]`).
//   2. una línea "Probado por: <nombre> · <fecha>" con fecha real.
// Separado de release-check.mjs por el mismo motivo que ok-linea.mjs: que
// registro-prueba.test.mjs pueda importar solo la función.
const FECHA_RX = /\b\d{4}-\d{2}-\d{1,2}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}\s*[-\s]?\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-zñ]*\.?\s*[-\s]?\s*\d{2,4}\b/i;

export function tieneCasillaMarcada(contenido) {
  if (!contenido) return false;
  return /^\s*-\s*\[[xX]\]/m.test(contenido);
}

export function probadoPorValido(contenido) {
  if (!contenido) return false;
  for (const linea of contenido.split('\n')) {
    const t = linea.trim();
    const m = t.match(/^-?\s*probado por:\s*(.+)$/i);
    if (!m) continue;
    const resto = m[1].trim();
    if (resto.length > 0 && FECHA_RX.test(resto)) return true;
  }
  return false;
}

// Devuelve { ok, motivos } — motivos lista lo que falta cuando ok=false.
export function registroPruebaValido(contenido) {
  const motivos = [];
  if (!tieneCasillaMarcada(contenido)) motivos.push('ninguna casilla "- [x]" marcada (todas quedaron "- [ ]" o no hay casillas).');
  if (!probadoPorValido(contenido)) motivos.push('falta una línea "Probado por: <nombre> · <fecha>" con fecha real.');
  return { ok: motivos.length === 0, motivos };
}
