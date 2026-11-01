import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

console.log('=== columnas salidas_inventario ===');
console.log(JSON.stringify(await dbQuery(env, `
  select column_name from information_schema.columns where table_schema='sgc' and table_name='salidas_inventario' order by ordinal_position limit 30;
`), null, 2));

console.log('=== errores_app ultimos 15 dias con conduce/transfer ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, mensaje, created_at from sgc.errores_app
  where created_at > now() - interval '15 days'
    and (mensaje ilike '%transfer%' or mensaje ilike '%conduce%')
  order by created_at desc limit 20;
`), null, 2));

console.log('=== reportes_soporte de Misael recientes ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, titulo, descripcion, created_at, estado from sgc.reportes_soporte
  where usuario_id = 'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7'
  order by created_at desc limit 10;
`), null, 2));

console.log('=== funcion ofrecer_transferencia_conduce definicion ===');
console.log(JSON.stringify(await dbQuery(env, `
  select pg_get_functiondef(oid) as def from pg_proc where proname='ofrecer_transferencia_conduce' and pronamespace='sgc'::regnamespace;
`), null, 2));
