import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log('=== salida en fase emitido/en_transito para probar transferir ===');
console.log(JSON.stringify(await dbQuery(env, `
  select s.id, s.estado, s.conductor_id, sgc.conduce_fase(s.id) as fase
  from sgc.salidas_inventario s
  where sgc.conduce_fase(s.id) in ('emitido','en_transito')
  limit 5;
`)));
console.log('=== conductores activos (con y sin usuario) ===');
console.log(JSON.stringify(await dbQuery(env, `select id, nombre, usuario_id, activo from sgc.conductores where coalesce(activo,true) limit 10;`)));
