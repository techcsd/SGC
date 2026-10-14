-- ============================================================================
-- CO6 — PROMPT-98 FASE 8 (14/10/2026) — Consultas de Compa
-- "lets check the Consultas de compa and make these thing that the users want
-- to do with it" (#216). De las 14 pendientes, la más repetida y accionable:
-- Hector Alcántara (Ingeniero de Oficina) pidiendo un reporte de requisiciones
-- realizadas por rango/obra/solicitante (#216, 4 variantes del mismo pedido).
--
-- 1) Hector no veía NADA de requisiciones: `puede_ver_todas_requisiciones()`
--    no incluía `ingeniero_oficina` (solo jefe_ingenieros/gerente_*). Se agrega.
-- 2) `requisiciones_bandeja` gana rango de fechas + filtro por solicitante
--    (trailing, retrocompatible) — es la RPC que alimenta el tool nuevo.
-- 3) `reporte_semanal_operaciones_compa(p_anio, p_semana)` — agrega las 7
--    secciones que YA existen como tools individuales (AU1: misma RPC que el
--    correo del lunes) en una sola respuesta; salta con gracia las secciones
--    que el rol del usuario no puede ver (no hace fallar todo el reporte).
-- 4) `parametros.compa_web_search` (default 'true') — apaga/enciende el tool
--    de búsqueda en internet sin tocar código.
--
-- Aditivo e idempotente. Regla 19: funciones recreadas sobre la viva.
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) Hector ve requisiciones (ingeniero_oficina) ──────────────────────────
create or replace function sgc.puede_ver_todas_requisiciones()
returns boolean
language sql stable security definer set search_path = sgc, public
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('inventario')
      or exists (
        select 1 from sgc.usuarios_roles ur
        join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = auth.uid()
          and r.codigo in ('gerente_produccion', 'gerente_proyectos', 'jefe_ingenieros', 'ingeniero_oficina')
      );
$$;
grant execute on function sgc.puede_ver_todas_requisiciones() to authenticated;

-- ── 2) requisiciones_bandeja + rango de fechas + solicitante ────────────────
create or replace function sgc.requisiciones_bandeja(p_estado text DEFAULT NULL::text, p_proyecto_id uuid DEFAULT NULL::uuid, p_urgencia text DEFAULT NULL::text, p_busqueda text DEFAULT NULL::text, p_limite integer DEFAULT 100, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_solicitante_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, estado text, urgencia text, notas text, created_at timestamp with time zone, cerrada_en timestamp with time zone, proyecto_id uuid, proyecto_nombre text, solicitante_id uuid, solicitante_nombre text, items_count integer, tiene_conduce boolean, tiene_compra boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
  select s.id, s.estado, s.urgencia, s.notas, s.created_at, s.cerrada_en,
         s.proyecto_id, p.nombre as proyecto_nombre,
         s.solicitante_id, u.nombre as solicitante_nombre,
         (select count(*)::int from sgc.solicitud_material_items i where i.solicitud_id = s.id) as items_count,
         (s.salida_id is not null) as tiene_conduce,
         (s.solicitud_compra_id is not null) as tiene_compra
  from sgc.solicitudes_material s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.usuarios  u on u.id = s.solicitante_id
  where sgc.puede_ver_todas_requisiciones()
    and (p_estado        is null or s.estado = p_estado)
    and (p_proyecto_id   is null or s.proyecto_id = p_proyecto_id)
    and (p_urgencia      is null or s.urgencia = p_urgencia)
    and (p_desde         is null or s.created_at::date >= p_desde)
    and (p_hasta         is null or s.created_at::date <= p_hasta)
    and (p_solicitante_id is null or s.solicitante_id = p_solicitante_id)
    and (
      p_busqueda is null or p_busqueda = ''
      or p.nombre ilike '%' || p_busqueda || '%'
      or u.nombre ilike '%' || p_busqueda || '%'
      or exists (
        select 1 from sgc.solicitud_material_items i
        where i.solicitud_id = s.id and i.descripcion ilike '%' || p_busqueda || '%'
      )
    )
  order by
    case s.estado when 'pendiente' then 0 when 'aprobada' then 1 else 2 end,
    case s.urgencia when 'urgente' then 0 else 1 end,
    s.created_at desc
  limit coalesce(p_limite, 100);
$function$;
grant execute on function sgc.requisiciones_bandeja(text,uuid,text,text,integer,date,date,uuid) to authenticated;

-- ── 3) Reporte semanal de operaciones, para Compa (agrega las 7 secciones) ──
create or replace function sgc.reporte_semanal_operaciones_compa(p_anio integer default null, p_semana integer default null)
returns jsonb
language plpgsql stable security definer set search_path = sgc, public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_omitidas text[] := array[]::text[];
  v_seccion text;
  v_val jsonb;
begin
  for v_seccion in select unnest(array[
    'resumen_requisiciones_semana', 'resumen_estatus_requisiciones', 'resumen_rutas_semana',
    'resumen_conduces_semana', 'resumen_inventario_semana', 'resumen_flota_carga_semana',
    'resumen_bitacoras_semana'
  ])
  loop
    begin
      execute format('select sgc.%I($1, $2)', v_seccion) into v_val using p_anio, p_semana;
      v_out := v_out || jsonb_build_object(v_seccion, v_val);
    exception when others then
      v_omitidas := v_omitidas || v_seccion; -- sin permiso para esa sección (u otro error) — se salta, no rompe el resto
    end;
  end loop;
  return v_out || jsonb_build_object('secciones_omitidas', to_jsonb(v_omitidas));
end;
$$;
grant execute on function sgc.reporte_semanal_operaciones_compa(integer, integer) to authenticated;

-- ── 4) Interruptor de búsqueda en internet (default encendido) ──────────────
insert into sgc.parametros (clave, valor)
  values ('compa_web_search', 'true')
on conflict (clave) do nothing;

commit;
