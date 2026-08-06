-- ============================================================================
-- AG16b · Gestión de Producción de Obra — cierre de gaps de la APP (PROMPT-8).
-- Aditivo/retrocompatible. Tres RPCs SECURITY DEFINER que faltaban para que la
-- app cierre las rutinas de campo:
--   1) entradas_programadas_obra  — Logística (FASE 5): OC con fecha programada.
--   2) mis_pedidos_obra           — seguimiento del estado del pedido urgente (FASE 3).
--   3) asignar_tarea_obra         — armar el plan del día desde la app (FASE 1),
--                                    gated por obra.plan_dia, notifica al capataz.
-- ============================================================================
set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Entradas programadas de materiales/equipos de la obra (Logística)
--    Fuente: ordenes_compra.fecha_programada (añadida en FASE 4). Grano = OC.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sgc.entradas_programadas_obra(p_proyecto_id uuid)
returns table (id uuid, numero text, proveedor text, estado text, fecha_programada date, total numeric)
language sql security definer set search_path to 'sgc','pg_temp' as $$
  select oc.id, oc.numero, p.nombre as proveedor, oc.estado, oc.fecha_programada, oc.total
  from sgc.ordenes_compra oc
  left join sgc.proveedores p on p.id = oc.proveedor_id
  where oc.proyecto_id = p_proyecto_id
    and oc.fecha_programada is not null
    and coalesce(oc.es_prueba, false) = false
  order by oc.fecha_programada asc, oc.numero asc
  limit 60;
$$;
grant execute on function sgc.entradas_programadas_obra(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Mis pedidos (urgentes) de la obra — seguimiento del estado
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sgc.mis_pedidos_obra(p_proyecto_id uuid)
returns table (id uuid, urgencia text, estado text, notas text, created_at timestamptz)
language sql security definer set search_path to 'sgc','pg_temp' as $$
  select s.id, s.urgencia, s.estado, s.notas, s.created_at
  from sgc.solicitudes_material s
  where s.proyecto_id = p_proyecto_id
    and s.solicitante_id = auth.uid()
  order by s.created_at desc
  limit 30;
$$;
grant execute on function sgc.mis_pedidos_obra(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Asignar una tarea del plan del día (gerente/capataz → capataz + brigada).
--    Crea una sgc.tareas (reusa Tareas + AG15), gated por obra.plan_dia, y
--    notifica al asignado (best-effort). Idempotente por client-UUID.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sgc.asignar_tarea_obra(
  p_id           uuid,
  p_proyecto_id  uuid,
  p_titulo       text,
  p_descripcion  text  default null,
  p_asignado_a   uuid  default null,
  p_brigada      text  default null,
  p_prioridad    text  default 'media',
  p_fecha_limite date  default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid := coalesce(p_id, gen_random_uuid());
  v_asignado uuid := coalesce(p_asignado_a, auth.uid());
begin
  if not sgc.puede_operar_submodulo('obra.plan_dia') then
    raise exception 'No tienes permiso para asignar tareas de obra.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_titulo), '') = '' then
    raise exception 'La tarea necesita un título.';
  end if;

  insert into sgc.tareas (id, titulo, descripcion, estado, prioridad, asignado_a, asignado_por, proyecto_id, fecha_limite, brigada)
  values (v_id, btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), 'pendiente',
          coalesce(p_prioridad, 'media'), v_asignado, v_uid, p_proyecto_id, p_fecha_limite,
          nullif(btrim(coalesce(p_brigada, '')), ''))
  on conflict (id) do nothing;

  -- Notificar al capataz asignado (no a uno mismo). Best-effort: un fallo de
  -- notificación no debe romper la asignación.
  begin
    if v_asignado is not null and v_asignado <> v_uid then
      perform sgc.notificar(v_asignado, 'tarea', 'Nueva tarea de obra', btrim(p_titulo), '/tareas');
    end if;
  exception when others then null;
  end;

  return v_id;
end $$;
grant execute on function sgc.asignar_tarea_obra(uuid, uuid, text, text, uuid, text, text, date) to authenticated, service_role;

-- ============================================================================
-- Verificación rápida
-- ============================================================================
do $$ begin
  raise notice 'AG16b gaps: entradas_programadas_obra / mis_pedidos_obra / asignar_tarea_obra OK';
end $$;
