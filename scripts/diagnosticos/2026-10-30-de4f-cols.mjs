import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log('app_error_reports:', JSON.stringify(await dbQuery(env, `select column_name from information_schema.columns where table_schema='sgc' and table_name='app_error_reports' order by ordinal_position;`)));
console.log('reportes_usuario:', JSON.stringify(await dbQuery(env, `select column_name from information_schema.columns where table_schema='sgc' and table_name='reportes_usuario' order by ordinal_position;`)));
