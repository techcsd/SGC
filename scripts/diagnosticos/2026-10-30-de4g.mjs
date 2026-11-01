import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

console.log('=== app_error_reports 15 dias conduce/transfer ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, message, error_type, context, created_at, user_id, platform, app_version from sgc.app_error_reports
  where created_at > now() - interval '15 days'
    and (message ilike '%transfer%' or context::text ilike '%transfer%' or message ilike '%conduce%')
  order by created_at desc limit 20;
`), null, 2));

console.log('=== reportes_usuario de Misael ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, tipo, asunto, descripcion, created_at, estado from sgc.reportes_usuario
  where usuario_id = 'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7'
  order by created_at desc limit 10;
`), null, 2));

console.log('=== funcion ofrecer_transferencia_conduce ===');
const r = await dbQuery(env, `select pg_get_functiondef(oid) as def from pg_proc where proname='ofrecer_transferencia_conduce' and pronamespace='sgc'::regnamespace;`);
console.log(r?.[0]?.def || JSON.stringify(r));

console.log('=== conduces recientes (10 dias) ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, estado, conductor_id, created_at, entregado_por, creado_por
  from sgc.salidas_inventario
  where created_at > now() - interval '10 days'
  order by created_at desc limit 15;
`), null, 2));
