import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

async function seccion(titulo, sql) {
  console.log(`\n=== ${titulo} ===`);
  try {
    console.log(JSON.stringify(await dbQuery(env, sql), null, 2));
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

await seccion('Felix Manuel Mateo Sanchez — usuario + roles', `
  select u.id, u.nombre, u.cedula, array_agg(r.codigo) as roles
  from sgc.usuarios u
  left join sgc.usuarios_roles ur on ur.usuario_id = u.id
  left join sgc.roles r on r.id = ur.rol_id
  where u.nombre ilike '%Mateo Sanchez%' or u.nombre ilike '%Felix Manuel%'
  group by u.id, u.nombre, u.cedula;
`);

await seccion('¿Cuántos usuarios tienen rol chofer_privado?', `
  select u.id, u.nombre, r.codigo
  from sgc.usuarios_roles ur
  join sgc.roles r on r.id = ur.rol_id
  join sgc.usuarios u on u.id = ur.usuario_id
  where r.codigo = 'chofer_privado';
`);

await seccion('Autorizaciones de vehículo vigentes (vehiculo_autorizaciones)', `
  select va.*, u.nombre
  from sgc.vehiculo_autorizaciones va
  join sgc.usuarios u on u.id = va.usuario_id
  order by va.created_at desc nulls last
  limit 50;
`);

await seccion('Choferes privados SIN ninguna autorización activa', `
  select u.id, u.nombre
  from sgc.usuarios_roles ur
  join sgc.roles r on r.id = ur.rol_id
  join sgc.usuarios u on u.id = ur.usuario_id
  where r.codigo = 'chofer_privado'
    and not exists (
      select 1 from sgc.vehiculo_autorizaciones va
      where va.usuario_id = u.id and va.activa
    );
`);
