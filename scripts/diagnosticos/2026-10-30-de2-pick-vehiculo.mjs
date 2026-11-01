import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `select id, placa, vencimiento_seguro from sgc.vehiculos where activo and placa = 'A631739' limit 1;`)));
