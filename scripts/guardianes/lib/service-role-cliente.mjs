// G1 — la service role jamás en código de cliente (src/**). Solo edge functions la usan.
import { coincideAlguno } from './glob.mjs';
const RE = /service[_-]?role|SUPABASE_SERVICE|serviceRoleKey/i;

export function detectarServiceRoleEnCliente(cambios) {
  const motivos = [];
  for (const c of cambios) {
    if (!coincideAlguno(c.ruta, ['src/**', 'public/**', 'capacitor.config.*'])) continue;
    (c.lineasAgregadas ?? []).forEach((l, i) => {
      if (RE.test(l)) motivos.push({ codigo: 'service_role_en_cliente', ruta: c.ruta, detalle: `Referencia a service role en código de cliente (${c.ruta}, línea agregada #${i + 1}). La service role solo vive en edge functions.` });
    });
  }
  return motivos;
}
