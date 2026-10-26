-- CY19 [HU-INV-00B] -- extiende el mecanismo de VINCULACION (criterio 1) a
-- articulos y bodegas, que quedaron fuera de cy19-homologacion-vincular.sql
-- porque tienen columnas de identidad con otra forma:
--   articulos: odoo_product_id + odoo_template_id (variante + plantilla)
--   bodegas:   odoo_location_id + odoo_warehouse_id (ubicacion + almacen,
--              SIN asumir 1:1 -- una bodega puede vincular solo a una
--              ubicacion dentro de un almacen, no al almacen completo)
-- Mismas reglas que la pieza anterior: simulacion real, idempotente,
-- conflicto bloquea (nunca sobrescribe en silencio), log por fila, solo
-- admin/service_role. Las ALTAS siguen fuera de alcance (D-08).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $preflight$
begin
  if to_regclass('sgc.odoo_homologacion_log') is null then
    raise exception 'Falta sgc.odoo_homologacion_log -- aplica primero sql/2026-10-26-cy19-homologacion-vincular.sql';
  end if;
  if exists (select 1 from pg_proc where proname = 'odoo_homologacion_vincular_articulo' and pronamespace = 'sgc'::regnamespace) then
    raise exception 'sgc.odoo_homologacion_vincular_articulo ya existe -- revisar antes de reaplicar';
  end if;
end;
$preflight$;

-- ── Articulos: variante (product) + plantilla (template) ────────────────
create or replace function sgc.odoo_homologacion_vincular_articulo(
  p_articulo_id uuid, p_odoo_instancia_id uuid, p_odoo_product_id bigint, p_odoo_template_id bigint,
  p_simular boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_instancia_valida uuid;
  v_actual_product bigint;
  v_actual_template bigint;
  v_accion text;
  v_detalle text;
begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo admin o service_role puede vincular identidades Odoo' using errcode = '42501';
  end if;
  if p_odoo_product_id is null or p_odoo_product_id <= 0 or p_odoo_template_id is null or p_odoo_template_id <= 0 then
    v_accion := 'rechazado'; v_detalle := 'odoo_product_id y odoo_template_id son obligatorios y deben ser > 0';
  else
    select id into v_instancia_valida from sgc.odoo_instancias where id = p_odoo_instancia_id and habilitada;
    if v_instancia_valida is null then
      v_accion := 'rechazado'; v_detalle := 'instancia Odoo no existe o no esta habilitada';
    else
      select odoo_product_id, odoo_template_id into v_actual_product, v_actual_template
        from sgc.articulos where id = p_articulo_id for update;
      if not found then
        v_accion := 'rechazado'; v_detalle := 'sgc_id no existe en articulos';
      elsif v_actual_product is not null and v_actual_template is not null
            and v_actual_product = p_odoo_product_id and v_actual_template = p_odoo_template_id then
        v_accion := 'ya_vinculado'; v_detalle := 'sin cambios (mismo product_id y template_id)';
      elsif (v_actual_product is not null and v_actual_product <> p_odoo_product_id)
            or (v_actual_template is not null and v_actual_template <> p_odoo_template_id) then
        v_accion := 'conflicto_existente';
        v_detalle := format('ya vinculado a product_id=%s/template_id=%s; no se sobrescribe sin resolver el conflicto', v_actual_product, v_actual_template);
      else
        v_accion := 'vinculado';
        v_detalle := case when p_simular then 'simulacion -- no se escribio' else 'escrito' end;
        if not p_simular then
          update sgc.articulos
             set odoo_product_id = p_odoo_product_id, odoo_template_id = p_odoo_template_id,
                 odoo_instancia_id = v_instancia_valida, odoo_ultima_sync = now()
           where id = p_articulo_id;
        end if;
      end if;
    end if;
  end if;

  insert into sgc.odoo_homologacion_log (tabla, sgc_id, odoo_instancia_id, odoo_id, accion, detalle, simulacion, ejecutado_por)
    values ('articulos', p_articulo_id::text, p_odoo_instancia_id, coalesce(p_odoo_product_id, 0), v_accion, v_detalle, p_simular, auth.uid());

  return jsonb_build_object('tabla', 'articulos', 'sgc_id', p_articulo_id, 'odoo_product_id', p_odoo_product_id,
    'odoo_template_id', p_odoo_template_id, 'accion', v_accion, 'detalle', v_detalle, 'simulacion', p_simular);
end;
$fn$;
comment on function sgc.odoo_homologacion_vincular_articulo is 'SGC Odoo foundation v1 (CY19) -- vincula odoo_product_id/odoo_template_id en articulos.';
revoke all on function sgc.odoo_homologacion_vincular_articulo(uuid, uuid, bigint, bigint, boolean) from public, anon;
grant execute on function sgc.odoo_homologacion_vincular_articulo(uuid, uuid, bigint, bigint, boolean) to authenticated, service_role;

-- ── Bodegas: ubicacion (location) y/o almacen (warehouse) -- NO 1:1 ─────
create or replace function sgc.odoo_homologacion_vincular_bodega(
  p_bodega_id uuid, p_odoo_instancia_id uuid, p_odoo_location_id bigint, p_odoo_warehouse_id bigint default null,
  p_simular boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_instancia_valida uuid;
  v_actual_location bigint;
  v_actual_warehouse bigint;
  v_accion text;
  v_detalle text;
begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo admin o service_role puede vincular identidades Odoo' using errcode = '42501';
  end if;
  -- Al menos location_id (una bodega SIEMPRE mapea a una ubicacion fisica;
  -- el almacen completo es opcional -- no se asume 1:1 bodega<->warehouse).
  if p_odoo_location_id is null or p_odoo_location_id <= 0 then
    v_accion := 'rechazado'; v_detalle := 'odoo_location_id es obligatorio y debe ser > 0 (odoo_warehouse_id es opcional)';
  else
    select id into v_instancia_valida from sgc.odoo_instancias where id = p_odoo_instancia_id and habilitada;
    if v_instancia_valida is null then
      v_accion := 'rechazado'; v_detalle := 'instancia Odoo no existe o no esta habilitada';
    else
      select odoo_location_id, odoo_warehouse_id into v_actual_location, v_actual_warehouse
        from sgc.bodegas where id = p_bodega_id for update;
      if not found then
        v_accion := 'rechazado'; v_detalle := 'sgc_id no existe en bodegas';
      elsif v_actual_location is not null and v_actual_location = p_odoo_location_id
            and v_actual_warehouse is not distinct from p_odoo_warehouse_id then
        v_accion := 'ya_vinculado'; v_detalle := 'sin cambios (misma ubicacion/almacen)';
      elsif v_actual_location is not null and v_actual_location <> p_odoo_location_id then
        v_accion := 'conflicto_existente';
        v_detalle := format('ya vinculada a location_id=%s; no se sobrescribe sin resolver el conflicto', v_actual_location);
      elsif v_actual_warehouse is not null and p_odoo_warehouse_id is not null and v_actual_warehouse <> p_odoo_warehouse_id then
        v_accion := 'conflicto_existente';
        v_detalle := format('ya vinculada a warehouse_id=%s; no se sobrescribe sin resolver el conflicto', v_actual_warehouse);
      else
        v_accion := 'vinculado';
        v_detalle := case when p_simular then 'simulacion -- no se escribio' else 'escrito' end;
        if not p_simular then
          update sgc.bodegas
             set odoo_location_id = p_odoo_location_id,
                 odoo_warehouse_id = coalesce(p_odoo_warehouse_id, odoo_warehouse_id),
                 odoo_instancia_id = v_instancia_valida, odoo_ultima_sync = now()
           where id = p_bodega_id;
        end if;
      end if;
    end if;
  end if;

  insert into sgc.odoo_homologacion_log (tabla, sgc_id, odoo_instancia_id, odoo_id, accion, detalle, simulacion, ejecutado_por)
    values ('bodegas', p_bodega_id::text, p_odoo_instancia_id, coalesce(p_odoo_location_id, 0), v_accion, v_detalle, p_simular, auth.uid());

  return jsonb_build_object('tabla', 'bodegas', 'sgc_id', p_bodega_id, 'odoo_location_id', p_odoo_location_id,
    'odoo_warehouse_id', p_odoo_warehouse_id, 'accion', v_accion, 'detalle', v_detalle, 'simulacion', p_simular);
end;
$fn$;
comment on function sgc.odoo_homologacion_vincular_bodega is 'SGC Odoo foundation v1 (CY19) -- vincula odoo_location_id/odoo_warehouse_id en bodegas. NO asume 1:1 bodega<->warehouse.';
revoke all on function sgc.odoo_homologacion_vincular_bodega(uuid, uuid, bigint, bigint, boolean) from public, anon;
grant execute on function sgc.odoo_homologacion_vincular_bodega(uuid, uuid, bigint, bigint, boolean) to authenticated, service_role;

commit;
