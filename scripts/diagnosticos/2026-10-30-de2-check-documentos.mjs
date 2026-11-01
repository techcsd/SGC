import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `
  select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'sgc.documentos'::regclass and contype = 'c';
`), null, 2));
