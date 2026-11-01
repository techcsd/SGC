import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
const MISAEL = 'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7';
console.log('=== despachado TOTAL en dev (lo que el badge viejo de la app contaba) ===');
console.log(JSON.stringify(await dbQuery(env, `select count(*) as todo_despachado from sgc.salidas_inventario where estado='despachado';`)));
console.log('=== badges_modulos_app() como Misael (nuevo, correcto) ===');
console.log(JSON.stringify(await dbQuery(env, `
  select set_config('request.jwt.claims', json_build_object('sub','${MISAEL}','role','authenticated')::text, true);
  select set_config('role', 'authenticated', true);
  select * from sgc.badges_modulos_app();
`)));
