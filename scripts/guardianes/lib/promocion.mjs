// F8 — decisiones deterministas de promoción y verificación posterior (testables, sin red).

// ¿Se puede promover automáticamente a prod?
export function decidirPromocion({ config = {}, zonaRoja = { esZonaRoja: false }, promovidosHoy = 0, g1 = 'aprobado', g2 = 'aprobado', humoDev = true, nativo = false }) {
  const bool = (v) => v === true || v === 'true';
  if (bool(config.agentes_pausa_total)) return { promover: false, razon: 'pausa_total', detalle: 'agentes_pausa_total activa: nada avanza.' };
  if (!bool(config.agentes_auto_prod)) return { promover: false, razon: 'auto_prod_apagado', detalle: 'agentes_auto_prod apagado: se queda en dev.' };
  if (zonaRoja.esZonaRoja || nativo) return { promover: false, razon: 'zona_roja', detalle: 'Zona roja: requiere OK humano.' };
  if (g1 !== 'aprobado') return { promover: false, razon: 'g1', detalle: `G1 ${g1}.` };
  if (g2 !== 'aprobado') return { promover: false, razon: 'g2', detalle: `G2 ${g2}.` };
  if (!humoDev) return { promover: false, razon: 'humo_dev', detalle: 'El humo en dev falló.' };
  const tope = Number(config.max_prod_por_dia ?? 3);
  if (promovidosHoy >= tope) return { promover: false, razon: 'tope_diario', detalle: `Tope diario alcanzado (${promovidosHoy}/${tope}).` };
  return { promover: true, razon: 'ok', detalle: 'Cumple todas las condiciones.' };
}

// Verificación posterior: ¿hay que revertir?
// obs = { health: bool, smoke: bool, erroresBase: number|null, erroresAhora: number|null }
export function decidirReversion(obs, { factor = 2, minimoAbsoluto = 5 } = {}) {
  const motivos = [];
  if (!obs.health) motivos.push('health check de prod falló');
  if (!obs.smoke) motivos.push('smoke de prod falló');
  if (Number.isFinite(obs.erroresBase) && Number.isFinite(obs.erroresAhora)) {
    const umbral = Math.max(minimoAbsoluto, Math.ceil(obs.erroresBase * factor));
    if (obs.erroresAhora > umbral) motivos.push(`errores nuevos en 10 min: ${obs.erroresAhora} > umbral ${umbral} (base ${obs.erroresBase})`);
  }
  return { revertir: motivos.length > 0, motivos };
}

// Día calendario de Santo Domingo (UTC-4, sin DST) en formato AAAA-MM-DD.
export function diaRD(fecha = new Date()) {
  return new Date(fecha.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}
