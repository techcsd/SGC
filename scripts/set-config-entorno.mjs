// set-config-entorno.mjs — BU1 F4 — POST-PASO de la migración de crons: fija las
// filas de sgc.config_entorno con los valores del entorno (edge_base_url, web_url,
// app_url, entorno). Necesario tras aplicar bu1-crons-por-entorno.sql en cada env.
//   node scripts/set-config-entorno.mjs --env dev|prod
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const vals = env.entorno === 'prod'
  ? { entorno: 'prod', edge_base_url: `https://${env.ref}.supabase.co`, web_url: 'https://sgcconstructorasd.com', app_url: 'https://app.sgcconstructorasd.com' }
  : { entorno: 'dev', edge_base_url: `https://${env.ref}.supabase.co`, web_url: 'https://dev.sgcconstructorasd.com', app_url: 'https://app-dev.sgcconstructorasd.com' };

const rows = Object.entries(vals).map(([k, v]) => `('${k}','${v}')`).join(',');
const q = `insert into sgc.config_entorno (clave,valor) values ${rows}
  on conflict (clave) do update set valor=excluded.valor`;
const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q }),
});
if (!res.ok) { console.error(`🔴 ${res.status}: ${await res.text()}`); process.exit(1); }
console.log(`✓ config_entorno (${env.entorno}): edge_base_url=${vals.edge_base_url}, web=${vals.web_url}, app=${vals.app_url}`);
