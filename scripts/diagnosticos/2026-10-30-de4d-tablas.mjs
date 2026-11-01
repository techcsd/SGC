import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `
  select table_name from information_schema.tables where table_schema='sgc' and table_name ilike '%error%' or table_name ilike '%reporte%';
`), null, 2));
