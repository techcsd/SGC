-- ============================================================================
-- Actualización 4 — T2: datos de prueba (marcar / ocultar / eliminar).
-- ----------------------------------------------------------------------------
-- 1) Columna es_prueba (default false) en las tablas operativas que el admin usa
--    para testear. Aditivo: no cambia el comportamiento de la data existente.
-- 2) Índices parciales para localizar rápido los datos de prueba (admin).
-- 3) RPC security-definer eliminar_dato_prueba(tabla, id): SOLO admin, SOLO sobre
--    registros marcados es_prueba; borra el registro (los hijos caen por FK
--    cascade donde está definido). El filtrado en vistas/listados para no-admins
--    se hace en la capa de servicio (ver notas del PROMPT).
-- Idempotente.
-- ============================================================================

set search_path = sgc, public;

do $$
declare t text;
begin
  foreach t in array array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos'
  ] loop
    execute format('alter table sgc.%I add column if not exists es_prueba boolean not null default false', t);
    execute format('create index if not exists idx_%s_es_prueba on sgc.%I (es_prueba) where es_prueba', t, t);
  end loop;
end $$;

-- ── RPC: eliminar un registro marcado como prueba (solo admin) ───────────────
create or replace function sgc.eliminar_dato_prueba(p_tabla text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_ok boolean;
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

  -- Solo elimina si el registro está marcado como prueba (nunca data real).
  execute format('select exists (select 1 from sgc.%I where id = $1 and coalesce(es_prueba,false))', p_tabla)
    into v_ok using p_id;
  if not v_ok then
    raise exception 'El registro no existe o no está marcado como dato de prueba.';
  end if;

  execute format('delete from sgc.%I where id = $1 and coalesce(es_prueba,false)', p_tabla) using p_id;
  return true;
end;
$function$;

grant execute on function sgc.eliminar_dato_prueba(text, uuid) to authenticated, service_role;
