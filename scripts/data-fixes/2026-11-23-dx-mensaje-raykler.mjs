// 2026-11-23 -- Mensaje directo de Tecnología (Xaviel) a Raykler con los pasos para reconectar el conector de Odoo en Claude Desktop,
// la aclaración del rechazo de requisiciones y una foto (su propia captura del error). Pedido y autorizado por Xaviel el 23-nov-2026.
// Replica crear_conversacion_directa + enviar_mensaje_directo_adjunto (que dependen de auth.uid) con service role, autor = cuenta Tecnología.
//   node scripts/data-fixes/2026-11-23-dx-mensaje-raykler.mjs <ruta-imagen.jpg> --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
import { readFileSync } from 'node:fs';
const env = await resolverEnv(process.argv.slice(2));
const imagen = process.argv.slice(2).find((a) => /\.(jpe?g|png)$/i.test(a));
const url = process.env[`SUPABASE_URL_${env.entorno.toUpperCase()}`];
const key = process.env[`SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()}`];
const XAVIEL = '4b19cc4b-3dbe-40dc-8631-ef489cad0f45'; // tecnologia@constructorasd.com
const RAYKLER = '7c7ffd84-5c74-48d3-9084-5dad7202857b';
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc', Prefer: 'return=representation' };
const rest = async (m, p, b) => { const r = await fetch(`${url}/rest/v1/${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${p}: ${r.status} ${t}`); return t ? JSON.parse(t) : []; };

// 1) conversación directa (reusa si existe)
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
console.log('conversación', conv);

// 2) texto
const texto = `Hola Raykler, soy Xaviel (Tecnología). Sobre tus reportes de hoy:

1) ODOO — "Error al conectar / Connection closed": ese mensaje NO viene de SGC. Viene del conector de Odoo dentro de Claude Desktop en tu computadora. SGC y Odoo están funcionando bien. Para reconectarlo:
   a) Cierra Claude Desktop por completo (también el ícono junto al reloj) y ábrelo otra vez.
   b) Configuración → Conectores → odoo → "Reconectar".
   c) Si sigue igual, no lo borres: avísame por aquí y lo revisamos juntos por pantalla.

2) CANCELAR una requisición: el botón sí funciona, pero el motivo debe tener mínimo 10 letras ("DUPLICADA" tiene 9). Ahora SGC te muestra el contador (9/10). Escribe por ejemplo "REQUISICIÓN DUPLICADA".

3) Confirmar el conduce desde la app: lo estamos preparando con el QR; te aviso cuando esté.

Te mando la captura de tu error para que ubiques la pantalla. Gracias.`;
await rest('POST', 'mensajes', { conversacion_id: conv, autor_id: XAVIEL, contenido: texto, tipo: 'texto' });

// 3) foto
if (imagen) {
  const buf = readFileSync(imagen);
  const path = `${conv}/${crypto.randomUUID()}.jpg`;
  const up = await fetch(`${url}/storage/v1/object/sgc-mensajes/${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg' }, body: buf });
  if (!up.ok) throw new Error(`storage: ${up.status} ${await up.text()}`);
  await rest('POST', 'mensajes', { conversacion_id: conv, autor_id: XAVIEL, contenido: 'Tu captura del error de Odoo (es del conector en Claude Desktop, no de SGC).', archivo_path: path, archivo_nombre: 'tu-captura-odoo.jpg', archivo_mime: 'image/jpeg', archivo_size: buf.length, tipo: 'texto' });
  console.log('foto enviada', buf.length, 'bytes');
}
