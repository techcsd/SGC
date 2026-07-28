-- ============================================================================
-- Z5b — eliminar_dato_prueba: whitelist + cascada para las nuevas entidades
-- PROMPT-6 · FASE 2
-- ============================================================================
create or replace function sgc.eliminar_dato_prueba(p_tabla text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_ok boolean;
  v_pares text[][];
  par text[];
  v_allowed text[] := array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos',
    'proyectos','bodegas','empleados','proveedores','ordenes_compra','articulos',
    'activos_fijos','conteos_inventario'];
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

  -- Derivados marcados como prueba se borran primero (sus detalles caen por FK cascade).
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
