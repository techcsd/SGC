import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

console.log('=== 1. Ofertas de transferencia recientes ===');
console.log(JSON.stringify(await dbQuery(env, `
  select t.id, t.estado, t.ofrecida_en, t.resuelta_en, t.salida_id,
         t.de_conductor_id, dc.nombre as de_cond, dc.usuario_id as de_usuario,
         t.a_conductor_id,  ac.nombre as a_cond,  ac.usuario_id as a_usuario, ac.activo as a_activo,
         t.es_prueba, t.ofrecida_por, t.notas
  from sgc.conduce_transferencias t
  left join sgc.conductores dc on dc.id=t.de_conductor_id
  left join sgc.conductores ac on ac.id=t.a_conductor_id
  where t.ofrecida_en > now() - interval '10 days' order by t.ofrecida_en desc;
`), null, 2));

console.log('=== 2. Registro de chofer de Xaviel / "Xaviel" ===');
console.log(JSON.stringify(await dbQuery(env, `
  select c.id, c.nombre, c.usuario_id, c.activo, u.nombre as usuario, u.email
  from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id
  where c.usuario_id = '4b19cc4b-3dbe-40dc-8631-ef489cad0f45' or c.nombre ilike '%xaviel%' or u.nombre ilike '%xaviel%';
`), null, 2));

console.log('=== 3. Conductores activos sin usuario (selector los deja elegir, nunca reciben) ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, nombre from sgc.conductores where coalesce(activo,true) and usuario_id is null;
`), null, 2));

console.log('=== 4. Notificaciones de conduce a Xaviel ===');
console.log(JSON.stringify(await dbQuery(env, `
  select id, titulo, created_at, leida from sgc.notificaciones where usuario_id='4b19cc4b-3dbe-40dc-8631-ef489cad0f45'
    and titulo ilike '%conduce%' order by created_at desc limit 10;
`), null, 2));
