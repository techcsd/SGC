import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `
  select plataforma, version, titulo, created_at
  from sgc.app_versiones
  where plataforma = 'web'
  order by created_at desc limit 5;
`), null, 2));
