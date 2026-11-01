import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `
  select polname, pg_get_expr(polqual, polrelid) as using_expr
  from pg_policy where polrelid = 'sgc.solicitudes_material'::regclass;
`), null, 2));
