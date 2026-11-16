// 2026-11-16 W3 (DS-06) -- rellena proyecto_odoo_analiticas.odoo_analytic_nombre en DEV leyendo Odoo STAGING (SOLO LECTURA de Odoo).
// Dry-run por defecto; --apply escribe SOLO en dev. Resuelve por id de cuenta (ya vinculado), nunca por nombre.
//   node scripts/data-fixes/2026-11-16-w3-cuenta-analitica-nombres-dev.mjs --env dev [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Solo dev (staging de Odoo). Prod: tras OK explicito y ledger.'); process.exit(1); }
const apply = argv.includes('--apply');
const { kw } = await conectar(); // sin escritura: solo search_read

const filas = await consulta(env, 'select id, odoo_analytic_id, odoo_analytic_nombre from sgc.proyecto_odoo_analiticas');
const ids = [...new Set(filas.map((f) => Number(f.odoo_analytic_id)))];
const cuentas = ids.length ? await kw('account.analytic.account', 'read', [ids], { fields: ['name'] }) : [];
const nombre = new Map(cuentas.map((c) => [c.id, String(c.name ?? '').trim()]));
let cambios = 0, sinCuenta = 0;
for (const f of filas) {
  const n = nombre.get(Number(f.odoo_analytic_id));
  if (!n) { sinCuenta++; console.log(`cuenta #${f.odoo_analytic_id}: no existe en staging, se deja sin nombre`); continue; }
  if (f.odoo_analytic_nombre === n) continue;
  cambios++;
  console.log(`#${f.odoo_analytic_id} -> ${n}${apply ? '' : ' (dry-run)'}`);
  if (apply) await consulta(env, `update sgc.proyecto_odoo_analiticas set odoo_analytic_nombre = '${n.replace(/'/g, "''")}' where id = '${f.id}'`);
}
console.log(`\n${apply ? 'APLICADO' : 'dry-run'}: ${cambios} nombres, ${sinCuenta} sin cuenta en staging, ${filas.length} filas.`);
