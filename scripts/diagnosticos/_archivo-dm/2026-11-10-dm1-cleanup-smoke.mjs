import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
await dbQuery(env, `delete from sgc.claude_skills where slug='smoke-dm1-skill';`);
console.log('limpiado');
