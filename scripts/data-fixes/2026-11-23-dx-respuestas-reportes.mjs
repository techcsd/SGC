// 2026-11-23 -- Publica las respuestas (respuesta_admin) de los reportes de la ronda DX (textos en docs/RESPUESTAS-REPORTES-DX.md)
// y marca el estado. Autorizado por Xaviel el 23-nov-2026 («A, B, C y D … haz todo»). Solo UPDATE por id de reporte (prefijo único);
// no toca 09252790 (Vigía gps, sigue abierto). Idempotente: re-ejecutar solo reescribe los mismos textos.
//   node scripts/data-fixes/2026-11-23-dx-respuestas-reportes.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
const R = [
  ['8241a425', 'resuelto', 'Raykler, el botón de rechazar sí funcionaba: pedía un motivo de mínimo 10 letras y "DUPLICADA" tiene 9, pero no te lo decía. Ahora la pantalla muestra cuántas letras llevas (por ejemplo 9/10). Escribe "REQUISICIÓN DUPLICADA" y ya te deja rechazar. Disponible en la versión 1.221.0.'],
  ['12295fd3', 'en_progreso', 'Raykler, ese mensaje no es de SGC: es el conector de Odoo dentro de Claude en tu computadora, que se quedó desconectado. SGC y Odoo están conectados con normalidad. Tecnología te va a acompañar a reconectarlo desde Claude (Configuración → Conectores → odoo → Reconectar).'],
  ['935a34ff', 'resuelto', 'Ya puedes cambiar el artículo de un renglón desde "Cambiar artículo" en el avance de despacho (versión 1.218.5). Si algo no se ve como esperas, mándanos una foto.'],
  ['b0b5b98e', 'resuelto', 'Ahora, antes de aprobar un gasto de combustible, ves la foto del recibo, del tablero y de la bomba en la misma lista de "Por aprobar".'],
  ['6cdefc4a', 'resuelto', 'Corregido en la app 2.71.6. Cerramos este aviso; si vuelve a aparecer se reabre solo.'],
  ['addfd93e', 'en_progreso', 'El stock ahora lo manda Odoo; para corregirlo usa "Aplicar como conteo físico". Cuéntanos si ya se ve bien en tu teléfono.'],
  ['a4f3a22d', 'resuelto', 'Yonairy, agregamos los 5 cargos que pediste (Ayudante CSD, Obrero CSD, Ayudante de carpintería, Ayudante de varillero y Ayudante de maestro). Además, al importar el Excel la obra se busca en las primeras filas y, si no se reconoce un cargo, te sugiere el más parecido. Disponible en la versión 1.221.0.'],
  ['5f607366', 'en_progreso', 'Raykler, estamos preparando que se pueda recibir/confirmar el conduce desde la app escaneando su QR. Te avisamos cuando esté.'],
];
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
for (const [pref, estado, texto] of R) {
  const filas = await q(`select id from sgc.reportes_usuario where id::text like '${pref}%'`);
  if (filas.length !== 1) { console.log(pref, 'ids encontrados:', filas.length, '→ se omite'); continue; }
  await q(`update sgc.reportes_usuario set respuesta_admin = ${lit(texto)}, estado = '${estado}', updated_at = now(), resuelto_en = ${estado === 'resuelto' ? 'now()' : 'null'} where id = '${filas[0].id}'`);
  console.log(pref, '→', estado);
}
