// 2026-11-17 -- #57: las solicitudes de compra pendientes (todas autogeneradas por faltante de requisicion, > 7 dias) se avisan a Compras
// para que las cierren o conviertan desde Compras > Solicitudes vencidas (DS-24). NO se rechaza ni se aprueba nada por ellos.
//   node scripts/data-fixes/2026-11-17-ds-aviso-solicitudes-vencidas-prod.mjs --env prod --yes
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
const [{ n }] = await consulta(env, "select count(*)::int n from sgc.solicitudes_compra where estado='pendiente' and created_at < now() - interval '7 days'");
if (!n) { console.log('Nada vencido.'); process.exit(0); }
await consulta(env, `select sgc.notificar_modulo('compras', 'requisicion_vencida', '${n} solicitudes de compra sin respuesta', 'Hay ${n} solicitudes de compra pendientes hace más de 7 días (generadas por faltantes de requisición). Ciérralas con motivo o conviértelas en orden de compra.', '/compras/solicitudes-vencidas')`);
console.log(`aviso enviado a Compras por ${n} solicitud(es)`);
