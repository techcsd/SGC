// CY16 (#16) -- smoke transaccional (ROLLBACK) de la bandeja de sincronización
// con Odoo: odoo_eventos_listar/_resumen/_detalle/_reintentar. Inserta datos
// sintéticos (en dev hoy sgc.odoo_eventos está vacía -- ninguna instancia
// habilitada todavía) para probar la lógica real sin dejar rastro.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_tec_id uuid;
  v_otro_id uuid;
  v_instancia_id uuid;
  v_evento_id uuid;
  v_filas integer;
  v_detalle jsonb;
  v_ok boolean;
begin
  select ur.usuario_id into v_tec_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'tecnologia'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select ur.usuario_id into v_otro_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where not('tecnologia'=any(r.modulos) or 'admin'=any(r.modulos)) limit 1;
  if v_tec_id is null then raise exception 'FALLO_SETUP: falta un usuario de tecnologia/admin de prueba'; end if;

  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('smoke-cy16', 'https://smoke.test', 'db_smoke', 'dev', true)
    returning id into v_instancia_id;

  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, estado, intentos, error)
    values (v_instancia_id, 'proveedor', gen_random_uuid()::text, 'crear', 1, '{"nombre":"Proveedor smoke"}'::jsonb, 'error', 2, 'mock: fallo simulado')
    returning id into v_evento_id;
  insert into sgc.odoo_intentos (evento_id, procesador, lease_token, estado_resultado, error, reclamado_en)
    values (v_evento_id, 'odoo-sync', gen_random_uuid(), 'error', 'mock: fallo simulado', now());

  -- Un usuario sin módulo tecnologia/admin no puede listar.
  if v_otro_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_otro_id::text, 'role','authenticated')::text, true);
    set local role authenticated;
    begin
      perform sgc.odoo_eventos_listar(null, null, 10);
      raise exception 'FALLO: un usuario sin módulo tecnologia pudo listar';
    exception when others then
      if sqlerrm like '%Solo Tecnología%' then raise notice 'OK: gate es_tecnologia() se respeta en listar'; else raise; end if;
    end;
    reset role;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_tec_id::text, 'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_filas from sgc.odoo_eventos_listar('proveedor', 'error', 50) where id = v_evento_id;
  if v_filas <> 1 then raise exception 'FALLO: odoo_eventos_listar no devolvió el evento sintético (esperaba 1, vio %)', v_filas; end if;
  raise notice 'OK: odoo_eventos_listar ve el evento con los filtros correctos';

  select sgc.odoo_evento_detalle(v_evento_id) into v_detalle;
  if v_detalle->'evento'->>'id' <> v_evento_id::text then raise exception 'FALLO: odoo_evento_detalle no devolvió el evento esperado'; end if;
  if v_detalle ? 'intentos' = false or jsonb_array_length(v_detalle->'intentos') <> 1 then raise exception 'FALLO: odoo_evento_detalle no trae el historial de intentos'; end if;
  if v_detalle->'evento' ? 'lease_token' then raise exception 'FALLO: el detalle expone lease_token (detalle interno del procesador)'; end if;
  raise notice 'OK: odoo_evento_detalle trae evento + 1 intento, sin lease_token';

  -- Reintentar un evento 'completado' se rechaza (no se reabre lo ya resuelto).
  reset role;
  update sgc.odoo_eventos set estado = 'completado' where id = v_evento_id;
  set local role authenticated;
  begin
    perform sgc.odoo_evento_reintentar(v_evento_id);
    raise exception 'FALLO: se pudo reintentar un evento completado';
  exception when others then
    if sqlerrm like '%Solo se puede reintentar%' then raise notice 'OK: no se reintenta un evento completado'; else raise; end if;
  end;
  reset role;
  update sgc.odoo_eventos set estado = 'error' where id = v_evento_id;
  set local role authenticated;

  -- Reintento real: re-encola a pendiente y deja traza en odoo_intentos.
  select sgc.odoo_evento_reintentar(v_evento_id) into v_ok;
  if not v_ok then raise exception 'FALLO: odoo_evento_reintentar no reportó éxito'; end if;
  perform count(*) from sgc.odoo_eventos_resumen() where agregado_tipo = 'proveedor' and estado = 'pendiente';
  raise notice 'OK: odoo_eventos_resumen responde sin error';
  reset role;

  perform 1 from sgc.odoo_eventos where id = v_evento_id and estado = 'pendiente' and lease_token is null;
  if not found then raise exception 'FALLO: el evento no quedó pendiente tras reintentar'; end if;
  perform 1 from sgc.odoo_intentos where evento_id = v_evento_id and procesador = 'reintento-manual';
  if not found then raise exception 'FALLO: el reintento manual no dejó traza en odoo_intentos'; end if;
  raise notice 'OK: odoo_evento_reintentar re-encola a pendiente y deja traza de auditoría';

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY16 (#16): bandeja de sincronización Odoo (listar/resumen/detalle/reintentar) verificada (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY16 (#16) smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
