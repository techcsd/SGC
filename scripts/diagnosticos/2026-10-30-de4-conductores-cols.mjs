import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `select column_name, data_type from information_schema.columns where table_schema='sgc' and table_name='conductores' order by ordinal_position;`)));
