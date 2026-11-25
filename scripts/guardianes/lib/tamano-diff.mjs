// G1 — límite de tamaño de diff. Excede => NO se escribe código: la tarea pasa a "propuesta".
export const LIMITES_POR_DEFECTO = { max_archivos: 8, max_lineas: 300 };
const IGNORADOS = [/(^|\/)package-lock\.json$/, /^graphify-out\//, /^docs\/i18n-coverage\.json$/];

export function medirDiff(cambios) {
  const relevantes = cambios.filter((c) => !IGNORADOS.some((re) => re.test(c.ruta.replace(/\\/g, '/'))));
  const archivos = relevantes.length;
  const lineas = relevantes.reduce((a, c) => a + (c.agregadas ?? 0) + (c.borradas ?? 0), 0);
  return { archivos, lineas };
}

export function revisarTamano(cambios, limites = {}) {
  const l = { ...LIMITES_POR_DEFECTO, ...Object.fromEntries(Object.entries(limites).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) };
  const m = medirDiff(cambios);
  const motivos = [];
  if (m.archivos > l.max_archivos) motivos.push({ codigo: 'diff_grande', detalle: `${m.archivos} archivos > máximo ${l.max_archivos}. Debe quedar como propuesta para humano.` });
  if (m.lineas > l.max_lineas) motivos.push({ codigo: 'diff_grande', detalle: `${m.lineas} líneas cambiadas > máximo ${l.max_lineas}. Debe quedar como propuesta para humano.` });
  return { medida: m, limites: l, motivos };
}
