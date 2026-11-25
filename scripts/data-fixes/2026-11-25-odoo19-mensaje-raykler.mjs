// 2026-11-25 -- Mensaje directo de Tecnología (Xaviel) a Raykler: el catálogo ahora refleja Odoo 19 (368 artículos importados)
// y 4 duplicados que debe revisar. Pedido y autorizado por Xaviel el 25-nov-2026. Autor = cuenta Tecnología (service role,
// mismo patrón que 2026-11-23-dx-mensaje-raykler.mjs).
//   node scripts/data-fixes/2026-11-25-odoo19-mensaje-raykler.mjs --env prod --yes
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

const texto = `Hola Raykler, soy Xaviel (Tecnología). Actualizamos SGC a la nueva versión de Odoo (19) y ya quedó arreglado lo del almacén en 0.

QUÉ PASÓ: SGC solo conocía una parte de los productos de Odoo, así que el stock de los demás no se veía. Ahora SGC trae solo los productos de Odoo que tienen existencias: se importaron 368 artículos y el stock de cada almacén ya sale igual que en Odoo (Odoo es la fuente de verdad, y los nombres son los de Odoo). Se actualiza solo cada 5 minutos.

QUÉ TE PIDO:
1) Los 368 artículos nuevos quedaron en la categoría «(Revisión) Artículos Sin Catálogo Oficial». Cuando puedas, clasifícalos en su categoría real.
2) Hay 4 artículos duplicados que debes revisar (el de SGC apunta a un producto vacío y existe otro con el mismo nombre en Odoo que sí tiene stock). No los toqué:
   - «BOTA de GOMA # 41» (CSD-01-024) ↔ en Odoo «BOTA DE GOMA # 41» (5 en stock)
   - «PINTURA ACRILICA TROPICAL CONTRACTOR VERDE LIMON #25» (CSD-03-025) ↔ en Odoo «GALONES DE PINTURA ACRILICA TROPICAL CONTRACTOR VERDE LIMON #25» (45 en stock)
   - «PATAS AJUSTABLES CSD» (CSD-04-021) ↔ en Odoo «PATAS AJUSTABLES CSD (copia)» (66 en stock)
   - «GUANTES NITRILO ONESIZE» (CSD-01-007) ↔ en Odoo «GUANTES NITRILO ONESIZE (ANTIGUO)» (100 en stock)
   Dime cuál es el correcto de cada par y lo unificamos.
3) Los artículos nuevos de SGC ya NO reciben 1000 unidades de apertura: el inventario lo manda Odoo.

Si algún almacén te sigue saliendo en 0 y en Odoo sí tiene stock, avísame por aquí.`;
await rest('POST', 'mensajes', { conversacion_id: conv, autor_id: XAVIEL, contenido: texto, tipo: 'texto' });
console.log('mensaje enviado a Raykler, conversación', conv);
