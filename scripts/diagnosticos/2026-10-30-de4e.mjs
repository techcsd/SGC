import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

console.log('=== app_error_reports ultimos 15 dias conduce/transfer ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, mensaje, error_type, ruta, created_at, usuario_id from sgc.app_error_reports
  where created_at > now() - interval '15 days'
    and (mensaje ilike '%transfer%' or ruta ilike '%transfer%' or mensaje ilike '%conduce%')
  order by created_at desc limit 20;
`), null, 2));

console.log('=== reportes_usuario de Misael recientes ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, titulo, descripcion, created_at, estado from sgc.reportes_usuario
  where usuario_id = 'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7'
  order by created_at desc limit 10;
`), null, 2));

console.log('=== funcion ofrecer_transferencia_conduce definicion ===');
console.log(JSON.stringify(await dbQuery(env, `
  select pg_get_functiondef(oid) as def from pg_proc where proname='ofrecer_transferencia_conduce' and pronamespace='sgc'::regnamespace;
`), null, 2));

console.log('=== conduces recientes (10 dias) con estado despachado/en_ruta ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, estado, conductor_id, created_at, entregado_por, creado_por
  from sgc.salidas_inventario
  where created_at > now() - interval '10 days'
  order by created_at desc limit 15;
`), null, 2));
