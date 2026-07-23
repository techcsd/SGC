-- ============================================================================
-- X14 — Datos de prueba: propagación retroactiva y en cascada.
-- Al MARCAR un padre (vehículo/conductor) como test → cascada a los derivados
-- EXISTENTES (es_prueba_origen='heredado'). Al DESMARCAR → revierte solo los
-- heredados (lo marcado a mano se queda). Aditivo/retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- ── es_prueba_origen en todas las tablas marcables ──────────────────────────
do $do$
declare t text;
begin
  foreach t in array array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos'
  ] loop
    execute format('alter table sgc.%I add column if not exists es_prueba_origen text not null default ''manual''', t);
    execute format('alter table sgc.%I drop constraint if exists %I', t, t||'_es_prueba_origen_chk');
    execute format('alter table sgc.%I add constraint %I check (es_prueba_origen in (''manual'',''heredado''))', t, t||'_es_prueba_origen_chk');
  end loop;
end;
$do$;

-- ── W7 trigger: los derivados NUEVOS de un padre test nacen 'heredado' ──────
create or replace function sgc.tg_heredar_es_prueba()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  j jsonb := to_jsonb(NEW);
  v_veh uuid  := nullif(j->>'vehiculo_id', '')::uuid;
  v_cond uuid := nullif(j->>'conductor_id', '')::uuid;
  v_parent boolean := false;
begin
  if coalesce((j->>'es_prueba')::boolean, false) then
    return NEW;  -- ya marcado explícitamente (manual)
  end if;
  if v_veh is not null then
    v_parent := v_parent or coalesce((select es_prueba from sgc.vehiculos where id = v_veh), false);
  end if;
  if v_cond is not null then
    v_parent := v_parent or coalesce((select es_prueba from sgc.conductores where id = v_cond), false);
  end if;
  if v_parent then
    NEW.es_prueba := true;
    NEW.es_prueba_origen := 'heredado';
  end if;
  return NEW;
end;
$function$;

-- ── Mapa padre → derivados (tabla, columna FK) ──────────────────────────────
-- Función interna que aplica/reversa la cascada y devuelve el conteo afectado.
create or replace function sgc._cascada_prueba(p_tabla text, p_id uuid, p_valor boolean, p_solo_contar boolean)
returns int
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_pares text[][];  -- {tabla, columna_fk}
  par text[];
  v_total int := 0;
  v_n int;
begin
  if p_tabla = 'vehiculos' then
    v_pares := array[
      array['checklists_vehiculo','vehiculo_id'], array['registros_combustible','vehiculo_id'],
      array['vehiculo_entregas','vehiculo_id'], array['rutas','vehiculo_id'],
      array['mantenimientos','vehiculo_id'], array['vehiculo_accidentes','vehiculo_id'],
      array['vehiculo_danos','vehiculo_id'], array['conductor_multas','vehiculo_id']
    ];
  elsif p_tabla = 'conductores' then
    v_pares := array[
      array['conductor_multas','conductor_id'], array['rutas','conductor_id'],
      array['checklists_vehiculo','conductor_id'], array['registros_combustible','conductor_id']
    ];
  else
    return 0;  -- tablas sin derivados
  end if;

  foreach par slice 1 in array v_pares loop
    if p_valor then
      -- marcar: los que aún NO son test pasan a test heredado
      if p_solo_contar then
        execute format('select count(*) from sgc.%I where %I = $1 and coalesce(es_prueba,false)=false', par[1], par[2])
          into v_n using p_id;
      else
        execute format('update sgc.%I set es_prueba=true, es_prueba_origen=''heredado'' where %I = $1 and coalesce(es_prueba,false)=false', par[1], par[2])
          using p_id;
        get diagnostics v_n = row_count;
      end if;
    else
      -- desmarcar: revertir SOLO los heredados
      if p_solo_contar then
        execute format('select count(*) from sgc.%I where %I = $1 and coalesce(es_prueba,false)=true and es_prueba_origen=''heredado''', par[1], par[2])
          into v_n using p_id;
      else
        execute format('update sgc.%I set es_prueba=false where %I = $1 and coalesce(es_prueba,false)=true and es_prueba_origen=''heredado''', par[1], par[2])
          using p_id;
        get diagnostics v_n = row_count;
      end if;
    end if;
    v_total := v_total + coalesce(v_n, 0);
  end loop;
  return v_total;
end;
$function$;

-- ── Conteo previo para la UI ("Esto marcará también N registros") ───────────
create or replace function sgc.contar_derivados_prueba(p_tabla text, p_id uuid, p_valor boolean)
returns int
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'No autorizado'; end if;
  return sgc._cascada_prueba(p_tabla, p_id, coalesce(p_valor,false), true);
end;
$function$;

-- ── Marcar en cascada (reemplaza a marcar_dato_prueba; retrocompatible) ─────
create or replace function sgc.marcar_prueba_cascada(p_tabla text, p_id uuid, p_valor boolean)
returns int
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_allowed text[] := array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos'
  ];
  v_afectados int := 0;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede marcar datos de prueba.';
  end if;
  if not (p_tabla = any (v_allowed)) then
    raise exception 'Tabla no permitida: %', p_tabla;
  end if;

  -- El padre marcado directamente es SIEMPRE 'manual'.
  execute format('update sgc.%I set es_prueba = $1, es_prueba_origen = ''manual'' where id = $2', p_tabla)
    using coalesce(p_valor, false), p_id;

  -- Cascada a derivados existentes.
  v_afectados := sgc._cascada_prueba(p_tabla, p_id, coalesce(p_valor, false), false);
  return v_afectados;
end;
$function$;

grant execute on function sgc.contar_derivados_prueba(text, uuid, boolean) to authenticated;
grant execute on function sgc.marcar_prueba_cascada(text, uuid, boolean) to authenticated;

-- ── marcar_dato_prueba: delega en la cascada (retrocompat total) ────────────
create or replace function sgc.marcar_dato_prueba(p_tabla text, p_id uuid, p_valor boolean)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  perform sgc.marcar_prueba_cascada(p_tabla, p_id, p_valor);
  return true;
end;
$function$;

-- ── eliminar_dato_prueba: al borrar un padre test, borra también sus
--    derivados marcados como prueba (cubre los heredados). ───────────────────
create or replace function sgc.eliminar_dato_prueba(p_tabla text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_ok boolean;
  v_pares text[][];
  par text[];
  v_allowed text[] := array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos'
  ];
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede eliminar datos de prueba.';
  end if;
  if not (p_tabla = any (v_allowed)) then
    raise exception 'Tabla no permitida para eliminación de datos de prueba: %', p_tabla;
  end if;

  execute format('select exists (select 1 from sgc.%I where id = $1 and coalesce(es_prueba,false))', p_tabla)
    into v_ok using p_id;
  if not v_ok then
    raise exception 'El registro no existe o no está marcado como dato de prueba.';
  end if;

  -- Borrar primero los derivados marcados como prueba (heredados o manuales),
  -- para no chocar con las FK y honrar "cubre los heredados".
  if p_tabla = 'vehiculos' then
    v_pares := array[
      array['checklists_vehiculo','vehiculo_id'], array['registros_combustible','vehiculo_id'],
      array['vehiculo_entregas','vehiculo_id'], array['rutas','vehiculo_id'],
      array['mantenimientos','vehiculo_id'], array['vehiculo_accidentes','vehiculo_id'],
      array['vehiculo_danos','vehiculo_id'], array['conductor_multas','vehiculo_id']
    ];
  elsif p_tabla = 'conductores' then
    v_pares := array[
      array['conductor_multas','conductor_id'], array['rutas','conductor_id'],
      array['checklists_vehiculo','conductor_id'], array['registros_combustible','conductor_id']
    ];
  end if;
  if v_pares is not null then
    foreach par slice 1 in array v_pares loop
      execute format('delete from sgc.%I where %I = $1 and coalesce(es_prueba,false)=true', par[1], par[2]) using p_id;
    end loop;
  end if;

  execute format('delete from sgc.%I where id = $1 and coalesce(es_prueba,false)', p_tabla) using p_id;
  return true;
end;
$function$;

-- ── Cascada por TRIGGER en los padres → cubre TODAS las vías de marcado
--    (formulario de vehículo con update directo, RPC, app, edición directa).
--    marcar_prueba_cascada solo marca el padre + cuenta; el trigger cascada. ──
create or replace function sgc.tg_cascada_prueba() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if TG_OP = 'UPDATE' and (OLD.es_prueba is distinct from NEW.es_prueba) then
    perform sgc._cascada_prueba(TG_TABLE_NAME, NEW.id, NEW.es_prueba, false);
  end if;
  return NEW;
end; $function$;

drop trigger if exists trg_cascada_prueba on sgc.vehiculos;
create trigger trg_cascada_prueba after update of es_prueba on sgc.vehiculos
  for each row execute function sgc.tg_cascada_prueba();
drop trigger if exists trg_cascada_prueba on sgc.conductores;
create trigger trg_cascada_prueba after update of es_prueba on sgc.conductores
  for each row execute function sgc.tg_cascada_prueba();

create or replace function sgc.marcar_prueba_cascada(p_tabla text, p_id uuid, p_valor boolean)
returns int
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
declare
  v_allowed text[] := array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos'];
  v_afectados int := 0;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede marcar datos de prueba.'; end if;
  if not (p_tabla = any (v_allowed)) then raise exception 'Tabla no permitida: %', p_tabla; end if;
  v_afectados := sgc._cascada_prueba(p_tabla, p_id, coalesce(p_valor,false), true);
  execute format('update sgc.%I set es_prueba = $1, es_prueba_origen = ''manual'' where id = $2', p_tabla)
    using coalesce(p_valor, false), p_id;
  return v_afectados;
end; $function$;
