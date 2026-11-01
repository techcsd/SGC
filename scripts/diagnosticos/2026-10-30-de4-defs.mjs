import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
for (const fn of ['choferes_activos', 'mis_transferencias_conduce', 'conduce_puede_transferir']) {
  const r = await dbQuery(env, `select pg_get_functiondef(oid) as def from pg_proc where proname='${fn}' and pronamespace='sgc'::regnamespace limit 1;`);
  console.log(`=== ${fn} ===`);
  console.log(r[0]?.def || 'NOT FOUND');
  console.log();
}
console.log('=== conduce_transferencias columns ===');
console.log(JSON.stringify(await dbQuery(env, `select column_name, data_type from information_schema.columns where table_schema='sgc' and table_name='conduce_transferencias' order by ordinal_position;`)));
