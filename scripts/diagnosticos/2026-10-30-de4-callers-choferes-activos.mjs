import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `
  select p.proname from pg_proc p
  where p.pronamespace='sgc'::regnamespace
    and pg_get_functiondef(p.oid) ilike '%choferes_activos%'
    and p.proname <> 'choferes_activos';
`)));
