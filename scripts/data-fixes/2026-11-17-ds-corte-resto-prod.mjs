// 2026-11-17 -- CORTE del resto de bodegas homologadas en PROD (opcion A: Odoo manda), autorizado por Xaviel (17-nov: "sigue con las demas bodegas").
// Por cada bodega activa con ubicacion Odoo (menos Central, ya cortada): respaldo del stock SGC, fecha de corte = hoy, apertura marcada sin
// ajustes en Odoo y Odoo como fuente. Revertir: --apagar (quita la fuente a esas bodegas; la fase corte queda para Central).
//   node scripts/data-fixes/2026-11-17-ds-corte-resto-prod.mjs --env prod --yes [--apply | --apagar]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
const sql = (s) => consulta(env, s);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const [admin] = await sql(`select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre='Xaviel Terrero' limit 1`);
const as = (q) => sql(`select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: admin.id, role: 'authenticated' }))}, true); ${q}`);
const hoy = (await sql(`select (now() at time zone 'America/Santo_Domingo')::date::text d`))[0].d;
const MOTIVO = 'Corte resto opcion A 2026-11-17';
const bodegas = await sql(`select id, nombre, codigo_odoo from sgc.bodegas where activo and odoo_location_id is not null and codigo_odoo <> 'WH' order by nombre`);
console.log(`${bodegas.length} bodegas: ${bodegas.map((b) => b.codigo_odoo).join(', ')}`);
if (argv.includes('--apagar')) { for (const b of bodegas) await as(`select sgc.odoo_corte_fuente_set(${lit(b.id)}, false)`); console.log('fuente apagada en el resto'); process.exit(0); }
if (!argv.includes('--apply')) { console.log('dry-run (usa --apply)'); process.exit(0); }
await as(`select sgc.odoo_fase_set('corte', true)`).catch(() => {}); // ya encendida
for (const b of bodegas) {
  await sql(`insert into sgc.odoo_corte_respaldo_stock (bodega_id, articulo_id, cantidad, motivo) select bodega_id, articulo_id, cantidad, ${lit(MOTIVO)} from sgc.stock_por_bodega where bodega_id=${lit(b.id)} and not exists (select 1 from sgc.odoo_corte_respaldo_stock r where r.bodega_id=${lit(b.id)} and r.motivo=${lit(MOTIVO)})`);
  await as(`select sgc.odoo_corte_configurar(${lit(b.id)}, ${lit(hoy)}::date, true)`);
  await sql(`update sgc.odoo_corte_bodega set apertura_en=now(), apertura_resultado='{"modo":"odoo_manda","ajustes":0,"nota":"Opcion A: SGC se alinea a Odoo; no se escribio apertura en Odoo"}'::jsonb where bodega_id=${lit(b.id)}`);
  await as(`select sgc.odoo_corte_fuente_set(${lit(b.id)}, true)`);
  console.log(`  ${b.codigo_odoo}: corte con fuente Odoo`);
}
console.log(JSON.stringify(await sql(`select count(*) filter (where fuente_odoo) con_fuente, count(*) total from sgc.odoo_corte_bodega`)));
