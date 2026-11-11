import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
await dbQuery(env, `update sgc.notas set contenido = replace(contenido, '- [ ] [Soporte] "falta af=gwajhwj"', '- [x] [Soporte] "falta af=gwajhwj"') where id='b0257ddf-6db6-4140-95f3-9bf60d5e12e5';`);
console.log('marcado');
