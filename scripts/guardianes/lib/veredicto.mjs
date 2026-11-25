// G2 — veredicto estructurado del Guardián IA: extracción robusta + validación estricta.
// Forma: { veredicto: 'aprobado'|'rechazado', motivos: string[], riesgo: 'bajo'|'medio'|'alto' }
export function extraerJson(texto) {
  const t = String(texto ?? '');
  // el CLI con --output-format json envuelve el texto del modelo en { result: "..." }
  try {
    const o = JSON.parse(t);
    if (o && typeof o === 'object' && typeof o.result === 'string') return extraerJson(o.result);
    if (o && typeof o === 'object') return o;
  } catch { /* sigue */ }
  const cercado = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidatos = cercado ? [cercado[1]] : [];
  // último objeto {...} balanceado del texto
  for (let i = t.lastIndexOf('{'); i >= 0; i = t.lastIndexOf('{', i - 1)) {
    let prof = 0;
    for (let j = i; j < t.length; j++) {
      if (t[j] === '{') prof++;
      else if (t[j] === '}' && --prof === 0) { candidatos.push(t.slice(i, j + 1)); break; }
    }
    if (candidatos.length) break;
  }
  for (const c of candidatos) { try { return JSON.parse(c); } catch { /* siguiente */ } }
  return null;
}

export function validarVeredicto(obj) {
  const errores = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errores: ['no es un objeto JSON'] };
  if (!['aprobado', 'rechazado'].includes(obj.veredicto)) errores.push('veredicto debe ser aprobado|rechazado');
  if (!Array.isArray(obj.motivos) || obj.motivos.some((m) => typeof m !== 'string')) errores.push('motivos debe ser string[]');
  if (!['bajo', 'medio', 'alto'].includes(obj.riesgo)) errores.push('riesgo debe ser bajo|medio|alto');
  if (obj.veredicto === 'rechazado' && Array.isArray(obj.motivos) && obj.motivos.length === 0) errores.push('un rechazo exige al menos un motivo');
  if (errores.length) return { ok: false, errores };
  return { ok: true, veredicto: { veredicto: obj.veredicto, motivos: obj.motivos.slice(0, 20).map((m) => m.slice(0, 500)), riesgo: obj.riesgo } };
}

// Regla dura: ante respuesta ilegible el veredicto es RECHAZADO (fallar cerrado, nunca abierto).
export function veredictoDesdeTexto(texto) {
  const r = validarVeredicto(extraerJson(texto));
  if (r.ok) return r.veredicto;
  return { veredicto: 'rechazado', motivos: [`El Guardián no devolvió un veredicto válido (${r.errores.join('; ')}). Se rechaza por seguridad.`], riesgo: 'alto' };
}
