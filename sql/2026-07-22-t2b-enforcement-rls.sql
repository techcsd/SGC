-- ============================================================================
-- Actualización 4 — T2 (parte B): enforcement server-side de "datos de prueba".
-- ----------------------------------------------------------------------------
-- Política RLS RESTRICTIVA de SELECT en cada tabla operativa: se combina con AND
-- sobre las políticas permisivas existentes (NO las reescribe), así que a los
-- no-admin nunca les llegan filas es_prueba=true — en listados, vistas agregadas
-- (security_invoker) y RPCs que corren como invoker. El admin (is_admin()) las ve
-- siempre y las filtra/oculta desde la UI con el toggle "mostrar datos de prueba".
-- Aditivo/idempotente: es_prueba default false → no afecta la data real.
--
-- Nota: los RPCs security-definer omiten RLS por diseño; un dashboard alimentado
-- 100% por un RPC definer podría aún contar datos de prueba (caso borde).
--
-- Además: RPC genérico marcar_dato_prueba(tabla, id, valor) — SOLO admin — para
-- marcar/desmarcar sin tocar cada formulario de creación.
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
    execute format('drop policy if exists "es_prueba: oculta a no-admin" on sgc.%I', t);
    execute format(
      'create policy "es_prueba: oculta a no-admin" on sgc.%I as restrictive for select to authenticated using (not es_prueba or sgc.is_admin())',
      t
    );
  end loop;
end $$;

-- ── RPC: marcar/desmarcar un registro como dato de prueba (solo admin) ───────
create or replace function sgc.marcar_dato_prueba(p_tabla text, p_id uuid, p_valor boolean)
returns boolean
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_allowed text[] := array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos'
  ];
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede marcar datos de prueba.';
  end if;
  if not (p_tabla = any (v_allowed)) then
    raise exception 'Tabla no permitida: %', p_tabla;
  end if;
  execute format('update sgc.%I set es_prueba = $1 where id = $2', p_tabla)
    using coalesce(p_valor, false), p_id;
  return true;
end;
$function$;

grant execute on function sgc.marcar_dato_prueba(text, uuid, boolean) to authenticated, service_role;
