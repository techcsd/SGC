// CY6 -- smoke transaccional (ROLLBACK) del outbox: captura por trigger,
// politica apagada por defecto, reclamar/finalizar, dependencia de revision,
// es_prueba nunca publica, permisos.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_instancia_id uuid;
  v_cat_id integer;
  v_prov_prueba_id uuid;
  v_base_id integer;
  v_ev_count integer;
  v_ev1 record;
  v_ev2 record;
  v_ok boolean;
  v_otro_usuario_id uuid;
begin
  -- categorias_inventario_id_seq esta desincronizada en dev (hallazgo
  -- preexistente, no de esta migracion -- igual que el de folio_seq de otra
  -- ronda): se insertan IDs explicitos fuera del rango de la secuencia para
  -- no chocar, en vez de depender de nextval().
  select coalesce(max(id), 0) + 1000 into v_base_id from sgc.categorias_inventario;

  -- 0 instancias habilitadas: la captura no debe crear eventos (ambiguo).
  insert into sgc.categorias_inventario (id, nombre) values (v_base_id + 1, 'CY6 smoke sin instancia') returning id into v_cat_id;
  perform 1 from sgc.odoo_eventos where agregado_tipo='categoria_inventario' and agregado_id=v_cat_id::text;
  if found then raise exception 'FALLO: capturo un evento sin ninguna instancia habilitada'; end if;
  raise notice 'OK: sin instancia habilitada, no se captura evento (criterio de seguridad)';

  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('CY6 smoke', 'https://smoke.test', 'smoke', 'dev', true) returning id into v_instancia_id;

  -- Insert real -> evento revision 1.
  insert into sgc.categorias_inventario (id, nombre) values (v_base_id + 2, 'CY6 smoke cat') returning id into v_cat_id;
  select count(*) into v_ev_count from sgc.odoo_eventos where agregado_tipo='categoria_inventario' and agregado_id=v_cat_id::text;
  if v_ev_count <> 1 then raise exception 'FALLO: esperaba 1 evento tras el insert, hay %', v_ev_count; end if;
  select * into v_ev1 from sgc.odoo_eventos where agregado_tipo='categoria_inventario' and agregado_id=v_cat_id::text and revision=1;
  if v_ev1.estado <> 'pendiente' or v_ev1.accion <> 'crear' then raise exception 'FALLO: evento 1 mal formado: %', row_to_json(v_ev1); end if;
  raise notice 'OK: insert -> evento revision 1, accion=crear, estado=pendiente';

  -- Update -> evento revision 2 (no pisa el 1).
  update sgc.categorias_inventario set nombre = 'CY6 smoke cat (renombrada)' where id = v_cat_id;
  select * into v_ev2 from sgc.odoo_eventos where agregado_tipo='categoria_inventario' and agregado_id=v_cat_id::text and revision=2;
  if v_ev2.accion <> 'actualizar' then raise exception 'FALLO: evento 2 deberia ser actualizar: %', row_to_json(v_ev2); end if;
  raise notice 'OK: update -> evento revision 2 (accion=actualizar), revision 1 conservada';

  -- Sin politica habilitada: reclamar no devuelve nada (apagado por defecto).
  if (select count(*) from sgc.odoo_v1_reclamar_eventos(v_instancia_id, 'smoke-test', 10, 60)) <> 0 then
    raise exception 'FALLO: reclamo eventos SIN politica habilitada (debe estar apagado por defecto)';
  end if;
  raise notice 'OK: sin fila de politica, nada se reclama (publicacion apagada por defecto)';

  -- Habilitar politica para categoria_inventario.
  insert into sgc.odoo_publicacion_politica (agregado_tipo, habilitada, notas) values ('categoria_inventario', true, 'CY6 smoke');

  -- Dependencia de etapas: debe reclamar la revision 1 (no la 2, que depende de ella).
  select e.id, e.revision into v_ev1 from sgc.odoo_v1_reclamar_eventos(v_instancia_id, 'smoke-test', 10, 60) e;
  if v_ev1.revision <> 1 then raise exception 'FALLO: debia reclamar la revision 1 primero, reclamo %', v_ev1.revision; end if;
  raise notice 'OK: con dependencia, se reclama la revision 1 antes que la 2';

  -- Consumidor concurrente: mientras la 1 esta 'procesando' (lease vigente), un segundo reclamo no la repite y la 2 sigue bloqueada por dependencia.
  if (select count(*) from sgc.odoo_v1_reclamar_eventos(v_instancia_id, 'smoke-test-2', 10, 60)) <> 0 then
    raise exception 'FALLO: un segundo consumidor reclamo algo mientras la revision 1 seguia en procesamiento';
  end if;
  raise notice 'OK: un solo efecto -- segundo consumidor concurrente no reclama nada';

  -- Finalizar con lease incorrecto -> false, no cambia estado.
  v_ok := sgc.odoo_v1_finalizar_evento(v_ev1.id, gen_random_uuid(), 'completado', '{}'::jsonb);
  if v_ok then raise exception 'FALLO: finalizo con un lease incorrecto'; end if;
  perform 1 from sgc.odoo_eventos where id = v_ev1.id and estado = 'procesando';
  if not found then raise exception 'FALLO: el estado cambio pese al lease incorrecto'; end if;
  raise notice 'OK: finalizar con lease incorrecto no tiene efecto';

  -- Finalizar de verdad -> completado; ahora la revision 2 SI se puede reclamar.
  select lease_token into v_ev1 from sgc.odoo_eventos where id = v_ev1.id;
  v_ok := sgc.odoo_v1_finalizar_evento((select id from sgc.odoo_eventos where agregado_tipo='categoria_inventario' and agregado_id=v_cat_id::text and revision=1), (select lease_token from sgc.odoo_eventos where agregado_tipo='categoria_inventario' and agregado_id=v_cat_id::text and revision=1), 'completado', '{"odoo_id": 555}'::jsonb);
  if not v_ok then raise exception 'FALLO: finalizar con el lease correcto devolvio false'; end if;
  select e.revision into v_ev2 from sgc.odoo_v1_reclamar_eventos(v_instancia_id, 'smoke-test', 10, 60) e;
  if v_ev2.revision <> 2 then raise exception 'FALLO: tras completar la 1, debia poder reclamar la 2, reclamo %', v_ev2.revision; end if;
  raise notice 'OK: al completar la revision 1, la 2 queda reclamable (dependencia liberada)';

  -- es_prueba nunca se reclama aunque la politica este habilitada (proveedores SI tiene es_prueba).
  insert into sgc.odoo_publicacion_politica (agregado_tipo, habilitada, notas) values ('proveedor', true, 'CY6 smoke');
  insert into sgc.proveedores (nombre, es_prueba) values ('CY6 smoke prueba', true) returning id into v_prov_prueba_id;
  perform 1 from sgc.odoo_eventos where agregado_tipo='proveedor' and agregado_id=v_prov_prueba_id::text and es_prueba;
  if not found then raise exception 'FALLO_SETUP: no se marco es_prueba en el evento'; end if;
  perform 1 from sgc.odoo_v1_reclamar_eventos(v_instancia_id, 'smoke-test', 50, 60) e where e.agregado_id = v_prov_prueba_id::text;
  if found then raise exception 'FALLO: se reclamo un evento es_prueba (D-16: nunca debe publicarse)'; end if;
  raise notice 'OK: es_prueba nunca se reclama, aunque la politica este habilitada';

  -- Permiso: un usuario sin admin no puede reclamar ni finalizar.
  select id into v_otro_usuario_id from sgc.usuarios u
    where not exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where ur.usuario_id=u.id and 'admin'=any(r.modulos))
    limit 1;
  if v_otro_usuario_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_otro_usuario_id::text, 'role','authenticated')::text, true);
    set local role authenticated;
    begin
      perform sgc.odoo_v1_reclamar_eventos(v_instancia_id, 'smoke-test', 10, 60);
      raise exception 'FALLO: un usuario sin admin SI pudo reclamar eventos';
    exception when others then
      if sqlerrm like '%Solo admin%' then raise notice 'OK: reclamar rechazado a un usuario sin admin (42501)'; else raise; end if;
    end;
    reset role;
  else
    raise notice 'AVISO: no habia usuario no-admin de prueba -- se omitio el check de permiso';
  end if;

  raise notice 'TODO OK -- ROLLBACK';
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY6 outbox: captura por trigger, politica apagada por defecto, dependencia de revision, concurrencia, es_prueba, permisos (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY6 smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
