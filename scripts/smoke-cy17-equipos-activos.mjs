// CY17 (#17) -- smoke transaccional (ROLLBACK). Historia de descubrimiento:
// NO se construye ningún vínculo real con Odoo (ver docs/ODOO-DIAGNOSTICO-
// CONTRATO.md sección CY17 -- ni Maintenance ni Fleet están instalados en el
// Odoo real de la empresa). Esto solo demuestra que la arquitectura de F5
// (columnas odoo_* + trigger odoo_v1_proteger_campos, ya vigente en
// tec_equipos/activos_fijos desde 20261016112524) es segura para un futuro
// vínculo: fijar la identidad Odoo de un equipo NO toca su custodia
// (empleado/ubicación/estado/historial) ni genera movimiento de materiales.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_instancia_id uuid;
  v_empleado_id uuid;
  v_equipo_id uuid;
  v_articulos_antes integer;
  v_articulos_despues integer;
  v_movs_antes integer;
  v_movs_despues integer;
  v_historial_antes integer;
  v_historial_despues integer;
  v_otro_id uuid;
begin
  select id into v_empleado_id from sgc.empleados limit 1;
  if v_empleado_id is null then raise exception 'FALLO_SETUP: falta un empleado de prueba'; end if;

  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('smoke-cy17', 'https://smoke.test', 'db_smoke', 'dev', true)
    returning id into v_instancia_id;

  insert into sgc.tec_equipos (codigo, nombre, tipo, estado, empleado_id, asignado_en, ubicacion)
    values ('SMOKE-CY17', 'Laptop de prueba', 'laptop', 'activo', v_empleado_id, current_date, 'Oficina central')
    returning id into v_equipo_id;
  insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, empleado_id)
    values (v_equipo_id, 'asignacion', 'Asignación inicial (smoke)', v_empleado_id);

  select count(*) into v_articulos_antes from sgc.articulos;
  select count(*) into v_movs_antes from sgc.v_movimientos_inventario;
  select count(*) into v_historial_antes from sgc.tec_equipo_historial where equipo_id = v_equipo_id;

  -- Un rol authenticated normal NO puede fijar la identidad Odoo (trigger de F5).
  select ur.usuario_id into v_otro_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'tecnologia'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  if v_otro_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_otro_id::text, 'role','authenticated')::text, true);
    set local role authenticated;
    begin
      update sgc.tec_equipos set odoo_instancia_id = v_instancia_id, odoo_id = 1, odoo_modelo = 'account.asset' where id = v_equipo_id;
      raise exception 'FALLO: un authenticated normal pudo escribir la identidad Odoo (el trigger de F5 debía bloquearlo)';
    exception when others then
      if sqlerrm like '%Identidades Odoo: escritura reservada al integrador%' then raise notice 'OK: el trigger odoo_v1_proteger_campos sigue bloqueando a authenticated'; else raise; end if;
    end;
    reset role;
  end if;

  -- Fijar la identidad Odoo (solo posible como postgres/service_role, por diseño de F5).
  update sgc.tec_equipos
     set odoo_instancia_id = v_instancia_id, odoo_id = 1, odoo_modelo = 'account.asset'
   where id = v_equipo_id;

  -- Custodia intacta: empleado/ubicación/estado no cambiaron por vincular la identidad.
  perform 1 from sgc.tec_equipos
    where id = v_equipo_id and empleado_id = v_empleado_id and ubicacion = 'Oficina central' and estado = 'activo';
  if not found then raise exception 'FALLO: vincular la identidad Odoo alteró la custodia (empleado/ubicación/estado)'; end if;
  raise notice 'OK: fijar odoo_id/odoo_modelo no toca empleado_id/ubicacion/estado';

  -- Historial NO generó una fila nueva solo por vincular la identidad (eso sería
  -- un cambio de custodia, no de identidad -- son ortogonales).
  select count(*) into v_historial_despues from sgc.tec_equipo_historial where equipo_id = v_equipo_id;
  if v_historial_despues <> v_historial_antes then raise exception 'FALLO: vincular la identidad Odoo generó una fila de historial de custodia sin que nadie la pidiera'; end if;
  raise notice 'OK: el historial de custodia no se tocó (% filas antes y después)', v_historial_antes;

  -- Ningún movimiento de materiales ni cambio de stock: un equipo bajo custodia
  -- nunca es un movimiento de inventario (criterio 3 de CY17).
  select count(*) into v_articulos_despues from sgc.articulos;
  select count(*) into v_movs_despues from sgc.v_movimientos_inventario;
  if v_articulos_despues <> v_articulos_antes then raise exception 'FALLO: el catálogo de artículos cambió'; end if;
  if v_movs_despues <> v_movs_antes then raise exception 'FALLO: se generó un movimiento de inventario'; end if;
  raise notice 'OK: sin efecto en sgc.articulos (%) ni sgc.v_movimientos_inventario (%)', v_articulos_antes, v_movs_antes;

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY17 (#17): identidad Odoo en tec_equipos no interfiere con custodia/historial ni genera movimiento de materiales (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY17 (#17) smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
