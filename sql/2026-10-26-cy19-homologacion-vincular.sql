-- CY19 [HU-INV-00B] -- mecanismo de VINCULACION (criterio 1 de la aceptacion):
-- dada una equivalencia ya confirmada (ver docs/ODOO-DIAGNOSTICO-CONTRATO.md,
-- CY18), escribe el odoo_id en las columnas de identidad que trajo F5
-- (sql/20261016112524_odoo_identity_fields.sql). Idempotente: vincular lo ya
-- vinculado al MISMO id es no-op; a un id DISTINTO se bloquea como conflicto
-- (nunca se sobrescribe en silencio). Reanudable: el log queda por fila, se
-- puede repetir la llamada sin duplicar efecto.
--
-- Alcance de ESTA migracion: proveedores, categorias_inventario, unidades
-- (las 3 comparten exactamente las columnas odoo_id/odoo_instancia_id/
-- odoo_compania_id). articulos (odoo_product_id/odoo_template_id) y bodegas
-- (odoo_location_id/odoo_warehouse_id) quedan para una migracion siguiente
-- con el mismo patron -- su forma de columnas es distinta y no entran limpio
-- en el mismo RPC generico sin forzarlo.
--
-- Las ALTAS (crear el lado que falta, criterios 2-3 de CY19) NO estan aqui:
-- requieren escribir en el Odoo real, y la cuenta tecnica disponible hoy no
-- es de solo lectura confirmada para un entorno de pruebas (D-08) -- se
-- construyen cuando haya una base de pruebas confirmada u orden escrita de
-- Xaviel. Esta migracion NO ajusta saldos ni importa apertura (no los toca
-- en absoluto).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $preflight$
begin
  if to_regclass('sgc.odoo_instancias') is null then
    raise exception 'Falta sgc.odoo_instancias -- aplica primero sql/20261016112524_odoo_identity_fields.sql';
  end if;
  if to_regclass('sgc.odoo_homologacion_log') is not null then
    raise exception 'sgc.odoo_homologacion_log ya existe -- revisar antes de reaplicar';
  end if;
end;
$preflight$;

create table sgc.odoo_homologacion_log (
  id uuid primary key default gen_random_uuid(),
  -- Sin CHECK de tablas soportadas a proposito: es un log de auditoria, debe
  -- poder registrar tambien el rechazo de una tabla NO soportada (ej. un
  -- intento de vincular "articulos" antes de que exista esa migracion).
  tabla text not null check (length(btrim(tabla)) > 0),
  sgc_id text not null, -- texto: proveedores.id es uuid, categorias/unidades.id es integer
  -- Nullable + sin FK dura: un rechazo por "instancia no existe/no habilitada"
  -- debe poder registrarse tambien (si fuera FK obligatoria, ese mismo caso
  -- de auditoria seria imposible de loguear).
  odoo_instancia_id uuid,
  odoo_id bigint not null check (odoo_id >= 0),
  accion text not null check (accion in ('vinculado', 'ya_vinculado', 'conflicto_existente', 'rechazado')),
  detalle text,
  simulacion boolean not null default true,
  ejecutado_por uuid references auth.users(id),
  ejecutado_en timestamptz not null default now()
);
comment on table sgc.odoo_homologacion_log is 'CY19 -- registro por fila de cada intento de vinculacion (simulada o real).';
create index odoo_homologacion_log_por_fila on sgc.odoo_homologacion_log (tabla, sgc_id, ejecutado_en desc);
alter table sgc.odoo_homologacion_log enable row level security;

create or replace function sgc.odoo_homologacion_vincular(p_vinculos jsonb, p_simular boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_item jsonb;
  v_tabla text;
  v_sgc_id text;
  v_instancia_id uuid; -- la que vino en el payload, tal cual (para el log)
  v_instancia_valida uuid; -- la misma, solo si existe y esta habilitada (para escribir)
  v_odoo_id bigint;
  v_actual bigint;
  v_accion text;
  v_detalle text;
  v_resultados jsonb := '[]'::jsonb;
  v_usuario uuid := auth.uid();
begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo admin o service_role puede vincular identidades Odoo' using errcode = '42501';
  end if;
  if jsonb_typeof(p_vinculos) <> 'array' then
    raise exception 'p_vinculos debe ser un array';
  end if;

  for v_item in select * from jsonb_array_elements(p_vinculos) loop
    v_tabla := v_item->>'tabla';
    v_sgc_id := v_item->>'sgc_id';
    v_instancia_id := (v_item->>'odoo_instancia_id')::uuid;
    v_odoo_id := (v_item->>'odoo_id')::bigint;
    v_accion := null; v_detalle := null;
    select id into v_instancia_valida from sgc.odoo_instancias where id = v_instancia_id and habilitada;

    if v_tabla not in ('proveedores', 'categorias_inventario', 'unidades') then
      v_accion := 'rechazado'; v_detalle := 'tabla no soportada por esta version del mecanismo (articulos/bodegas: siguiente migracion)';
    elsif v_odoo_id is null or v_odoo_id <= 0 then
      v_accion := 'rechazado'; v_detalle := 'odoo_id invalido';
    elsif v_instancia_valida is null then
      v_accion := 'rechazado'; v_detalle := 'instancia Odoo no existe o no esta habilitada';
    else
      if v_tabla = 'proveedores' then
        select odoo_id into v_actual from sgc.proveedores where id = v_sgc_id::uuid for update;
      elsif v_tabla = 'categorias_inventario' then
        select odoo_id into v_actual from sgc.categorias_inventario where id = v_sgc_id::integer for update;
      elsif v_tabla = 'unidades' then
        select odoo_id into v_actual from sgc.unidades where id = v_sgc_id::integer for update;
      end if;

      if not found then
        v_accion := 'rechazado'; v_detalle := 'sgc_id no existe en ' || v_tabla;
      elsif v_actual is not null and v_actual = v_odoo_id then
        v_accion := 'ya_vinculado'; v_detalle := 'sin cambios (mismo odoo_id)';
      elsif v_actual is not null and v_actual <> v_odoo_id then
        v_accion := 'conflicto_existente'; v_detalle := format('ya vinculado a odoo_id=%s; no se sobrescribe sin resolver el conflicto', v_actual);
      else
        v_accion := 'vinculado';
        v_detalle := case when p_simular then 'simulacion -- no se escribio' else 'escrito' end;
        if not p_simular then
          if v_tabla = 'proveedores' then
            update sgc.proveedores set odoo_id = v_odoo_id, odoo_instancia_id = v_instancia_valida, odoo_ultima_sync = now() where id = v_sgc_id::uuid;
          elsif v_tabla = 'categorias_inventario' then
            update sgc.categorias_inventario set odoo_id = v_odoo_id, odoo_instancia_id = v_instancia_valida, odoo_ultima_sync = now() where id = v_sgc_id::integer;
          elsif v_tabla = 'unidades' then
            update sgc.unidades set odoo_id = v_odoo_id, odoo_instancia_id = v_instancia_valida, odoo_ultima_sync = now() where id = v_sgc_id::integer;
          end if;
        end if;
      end if;
    end if;

    insert into sgc.odoo_homologacion_log (tabla, sgc_id, odoo_instancia_id, odoo_id, accion, detalle, simulacion, ejecutado_por)
      values (v_tabla, v_sgc_id, v_instancia_id, coalesce(v_odoo_id, 0), v_accion, v_detalle, p_simular, v_usuario);

    v_resultados := v_resultados || jsonb_build_object('tabla', v_tabla, 'sgc_id', v_sgc_id, 'odoo_id', v_odoo_id, 'accion', v_accion, 'detalle', v_detalle);
  end loop;

  return jsonb_build_object('simulacion', p_simular, 'resultados', v_resultados);
end;
$fn$;
comment on function sgc.odoo_homologacion_vincular is 'SGC Odoo foundation v1 (CY19) -- vincula odoo_id en proveedores/categorias_inventario/unidades. p_simular=true (default) solo previsualiza.';

revoke all on function sgc.odoo_homologacion_vincular(jsonb, boolean) from public, anon, authenticated;
grant execute on function sgc.odoo_homologacion_vincular(jsonb, boolean) to authenticated; -- el propio chequeo is_admin()/service_role adentro gatea de verdad

commit;
