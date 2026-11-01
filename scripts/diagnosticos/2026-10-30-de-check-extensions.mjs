import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `select extname from pg_extension order by 1;`)));
