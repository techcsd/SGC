-- ============================================================================
-- Z5 — Datos de prueba en todas las entidades operativas · PROMPT-6 · FASE 2
-- ============================================================================
-- Agrega es_prueba/es_prueba_origen + RLS restrictiva "oculta a no-admin" a las
-- entidades que faltaban, y las integra a la cascada existente
-- (marcar_prueba_cascada / _cascada_prueba). Aditivo.
--
-- Ya tenían el flag: vehiculos, conductores, checklists_vehiculo,
-- registros_combustible, rutas, mantenimientos, vehiculo_accidentes,
-- entradas/salidas_inventario, bitacoras, avisos_flota (Z1), etc.
-- Faltaban: proyectos, bodegas, empleados, proveedores, ordenes_compra,
-- articulos, activos_fijos, conteos_inventario.
-- ============================================================================

-- 1) Columnas -----------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['proyectos','bodegas','empleados','proveedores','ordenes_compra','articulos','activos_fijos','conteos_inventario'] loop
    execute format('alter table sgc.%I add column if not exists es_prueba boolean not null default false', t);
    execute format('alter table sgc.%I add column if not exists es_prueba_origen text', t);
    execute format('alter table sgc.%I enable row level security', t);
    -- Política restrictiva: los no-admin nunca ven filas de prueba.
    execute format('drop policy if exists "es_prueba: oculta a no-admin" on sgc.%I', t);
    execute format($p$create policy "es_prueba: oculta a no-admin" on sgc.%I as restrictive for select to authenticated using (not es_prueba or sgc.is_admin())$p$, t);
  end loop;
end $$;

-- 2) Cascada: agregar proyectos y bodegas como padres -------------------------
create or replace function sgc._cascada_prueba(p_tabla text, p_id uuid, p_valor boolean, p_solo_contar boolean)
returns integer
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_pares text[][];
  par text[];
  v_total int := 0;
  v_n int;
begin
  if p_tabla = 'vehiculos' then
    v_pares := array[
      array['checklists_vehiculo','vehiculo_id'], array['registros_combustible','vehiculo_id'],
      array['vehiculo_entregas','vehiculo_id'], array['rutas','vehiculo_id'],
      array['mantenimientos','vehiculo_id'], array['vehiculo_accidentes','vehiculo_id'],
      array['vehiculo_danos','vehiculo_id'], array['conductor_multas','vehiculo_id']];
  elsif p_tabla = 'conductores' then
    v_pares := array[
      array['conductor_multas','conductor_id'], array['rutas','conductor_id'],
      array['checklists_vehiculo','conductor_id'], array['registros_combustible','conductor_id']];
  elsif p_tabla = 'proyectos' then
    v_pares := array[
      array['bitacoras','proyecto_id'], array['cronograma_tareas','proyecto_id'],
      array['salidas_inventario','proyecto_id'], array['ordenes_compra','proyecto_id']];
  elsif p_tabla = 'bodegas' then
    v_pares := array[
      array['entradas_inventario','bodega_id'], array['salidas_inventario','bodega_id'],
      array['conteos_inventario','bodega_id']];
  else
    return 0;  -- entidades sin derivados (empleados, proveedores, articulos, activos_fijos, ordenes_compra, conteos)
  end if;

  foreach par slice 1 in array v_pares loop
    if p_valor then
      if p_solo_contar then
        execute format('select count(*) from sgc.%I where %I = $1 and coalesce(es_prueba,false)=false', par[1], par[2]) into v_n using p_id;
      else
        execute format('update sgc.%I set es_prueba=true, es_prueba_origen=''heredado'' where %I = $1 and coalesce(es_prueba,false)=false', par[1], par[2]) using p_id;
        get diagnostics v_n = row_count;
      end if;
    else
      if p_solo_contar then
        execute format('select count(*) from sgc.%I where %I = $1 and coalesce(es_prueba,false)=true and es_prueba_origen=''heredado''', par[1], par[2]) into v_n using p_id;
      else
        execute format('update sgc.%I set es_prueba=false where %I = $1 and coalesce(es_prueba,false)=true and es_prueba_origen=''heredado''', par[1], par[2]) using p_id;
        get diagnostics v_n = row_count;
      end if;
    end if;
    v_total := v_total + coalesce(v_n, 0);
  end loop;
  return v_total;
end;
$function$;

-- 3) Whitelist: permitir marcar las nuevas entidades --------------------------
create or replace function sgc.marcar_prueba_cascada(p_tabla text, p_id uuid, p_valor boolean)
returns integer
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_allowed text[] := array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos',
    'proyectos','bodegas','empleados','proveedores','ordenes_compra','articulos',
    'activos_fijos','conteos_inventario'];
  v_afectados int := 0;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede marcar datos de prueba.'; end if;
  if not (p_tabla = any (v_allowed)) then raise exception 'Tabla no permitida: %', p_tabla; end if;
  v_afectados := sgc._cascada_prueba(p_tabla, p_id, coalesce(p_valor,false), true);
  execute format('update sgc.%I set es_prueba = $1, es_prueba_origen = ''manual'' where id = $2', p_tabla)
    using coalesce(p_valor, false), p_id;
  return v_afectados;
end; $function$;
