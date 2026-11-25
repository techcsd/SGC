// 2026-11-25 -- Corrección al mensaje a Raykler del mismo día (par GUANTES NITRILO: ambos productos tienen stock). Pedido y autorizado por Xaviel el 25-nov-2026. Autor = cuenta Tecnología (service role,
// mismo patrón que 2026-11-23-dx-mensaje-raykler.mjs).
//   node scripts/data-fixes/2026-11-25-odoo19-mensaje-raykler-correccion.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
const url = process.env[`SUPABASE_URL_${env.entorno.toUpperCase()}`];
const key = process.env[`SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()}`];
const XAVIEL = '4b19cc4b-3dbe-40dc-8631-ef489cad0f45'; // tecnologia@constructorasd.com
const RAYKLER = '7c7ffd84-5c74-48d3-9084-5dad7202857b'; // almacen@constructorasd.com
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc', Prefer: 'return=representation' };
const rest = async (m, p, b) => { const r = await fetch(`${url}/rest/v1/${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${p}: ${r.status} ${t}`); return t ? JSON.parse(t) : null; };

const mias = await rest('GET', `conversacion_participantes?usuario_id=eq.${XAVIEL}&select=conversacion_id`);
let conv = null;
if (mias.length) {
  const ids = mias.map((m) => m.conversacion_id).join(',');
  const comunes = await rest('GET', `conversacion_participantes?usuario_id=eq.${RAYKLER}&conversacion_id=in.(${ids})&select=conversacion_id`);
  for (const c of comunes) { const [x] = await rest('GET', `conversaciones?id=eq.${c.conversacion_id}&tipo=eq.directa&select=id`); if (x) { conv = x.id; break; } }
}
if (!conv) {
  [{ id: conv }] = await rest('POST', 'conversaciones', { tipo: 'directa', creado_por: XAVIEL });
  await rest('POST', 'conversacion_participantes', [{ conversacion_id: conv, usuario_id: XAVIEL }, { conversacion_id: conv, usuario_id: RAYKLER }]);
}

const texto = `Corrección a mi mensaje anterior (Xaviel, Tecnología): en el par de GUANTES NITRILO ONESIZE (CSD-01-007) los dos productos de Odoo tienen stock (el artículo de SGC ya apunta a uno con existencias, y en Odoo existe también «GUANTES NITRILO ONESIZE (ANTIGUO)» con 100). Ahí no hay un producto vacío: confírmame cuál debe quedar vigente. Los otros 3 pares sí son como te dije.`;
const [x] = await rest('GET', `conversaciones?id=eq.${conv}&select=id`);
await rest('POST', 'mensajes', { conversacion_id: conv, autor_id: XAVIEL, contenido: texto, tipo: 'texto' });
console.log('corrección enviada, conversación', conv);
