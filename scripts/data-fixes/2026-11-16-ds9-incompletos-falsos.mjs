// 2026-11-16 DS-09 / ADR 14 -- salidas marcadas «entregado_incompleto» solo por tener cantidad_recibida NULL (sin faltante real).
// Dry-run por defecto. --apply las pasa a «entregado» y rellena cantidad_recibida = cantidad en sus lineas NULL (= lo enviado).
// Se conservan INTACTAS las que tienen un faltante real (alguna linea con recibida < enviada).
//   node scripts/data-fixes/2026-11-16-ds9-incompletos-falsos.mjs --env dev [--apply]
//   (prod: solo tras OK explicito de Xaviel y con la migracion ds9 ya en prod; ledger CD10)
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
const apply = argv.includes('--apply');
const falsos = `select s.id from sgc.salidas_inventario s where s.estado='entregado_incompleto'
  and not exists (select 1 from sgc.detalle_salidas d where d.salida_id=s.id and d.cantidad_recibida is not null and d.cantidad_recibida < d.cantidad)`;
const [tot] = await consulta(env, `select count(*) total, (select count(*) from (${falsos}) f) falsos from sgc.salidas_inventario where estado='entregado_incompleto'`);
console.log(`[${env.entorno}] entregado_incompleto: ${tot.total} | sin faltante real (se corrigen): ${tot.falsos} | faltantes reales (se conservan): ${tot.total - tot.falsos}`);
if (!apply) { console.log('(dry-run; usa --apply)'); process.exit(0); }
await consulta(env, `
  update sgc.detalle_salidas set cantidad_recibida = cantidad where cantidad_recibida is null and salida_id in (${falsos});
  update sgc.salidas_inventario set estado='entregado' where id in (${falsos});`);
const [r] = await consulta(env, `select count(*) restantes from sgc.salidas_inventario where estado='entregado_incompleto'`);
console.log(`APLICADO. entregado_incompleto restantes: ${r.restantes}`);
