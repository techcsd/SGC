import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

console.log('=== Misael: usuario + conductor ===');
console.log(JSON.stringify(await dbQuery(env, `
  select u.id as usuario_id, u.nombre, u.email, c.id as conductor_id, c.nombre as conductor_nombre, c.activo
  from sgc.usuarios u left join sgc.conductores c on c.usuario_id = u.id
  where u.nombre ilike '%misael%';
`), null, 2));

console.log('=== conduce_transferencias — TODO el historial (sin filtro de fecha) ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, estado, ofrecida_en, resuelta_en, de_conductor_id, a_conductor_id, es_prueba
  from sgc.conduce_transferencias order by ofrecida_en desc limit 20;
`), null, 2));

console.log('=== conduces recientes (ultimos 10 dias) ===');
console.log(JSON.stringify(await dbQuery(env, `
  select s.id, s.numero_salida, s.estado, s.conduce_fase, s.created_at
  from sgc.salidas_inventario s
  where s.created_at > now() - interval '10 days'
  order by s.created_at desc limit 15;
`), null, 2));

console.log('=== errores_app recientes relacionados a transferencia/conduce ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, mensaje, error_type, ruta, created_at from sgc.errores_app
  where created_at > now() - interval '10 days'
    and (mensaje ilike '%transfer%' or ruta ilike '%transfer%' or mensaje ilike '%conduce%')
  order by created_at desc limit 20;
`), null, 2));
