import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `
  select proname, pg_get_function_arguments(oid) as args, pg_get_function_result(oid) as ret
  from pg_proc where pronamespace='sgc'::regnamespace
   and proname in ('puede_ver_todas_requisiciones','es_usuario_demo','es_flota_elevado','mis_conductor_ids','usuario_actual_es_prueba','submodulo_nivel_explicito')
  order by proname;
`), null, 2));
