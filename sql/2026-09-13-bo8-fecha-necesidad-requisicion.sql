-- ============================================================================
-- PROMPT-44 (BO) FASE 6 — BO8: fecha de NECESIDAD en la requisición de material.
-- Ronda 13/09/2026.  Aditivo, retrocompatible, idempotente.
--
-- Hoy solicitudes_material sólo tiene fechas de AUDITORÍA (created_at, atendido_en,
-- cerrada_en) y `urgencia ∈ {normal,urgente}`.  No hay forma de decir "para cuándo
-- lo necesito", así que Raykler no puede priorizar por fecha de obra.
--
-- Se añade una columna `fecha_necesidad date` NULLABLE (las requisiciones viejas no
-- la tienen) y un parámetro `p_fecha_necesidad date default null` a las DOS RPCs de
-- creación (web y app).  Con `default null` es retro-compatible: la app que aún no
-- lo envía sigue funcionando (queda null).
--
-- Nota de firma: añadir un argumento crea una función distinta (Postgres identifica
-- por aridad), así que se DROPEA la firma vieja y se recrea con el arg extra + se
-- re-otorgan los grants (antes: authenticated + service_role).  Los cuerpos son
-- copia VERBATIM de bm5c (2026-09-09) — el único cambio es la columna nueva.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-13-bo8-fecha-necesidad-requisicion.sql
-- ============================================================================

begin;

-- 1) Columna (nullable — regla 2: sin NOT NULL porque las viejas no la tienen).
alter table sgc.solicitudes_material
  add column if not exists fecha_necesidad date;

comment on column sgc.solicitudes_material.fecha_necesidad is
  'BO8 — fecha para cuándo se necesita el material (prioridad real de obra). Nullable: las requisiciones previas a BO8 no la tienen.';

-- 2) Requisición (crear, web) — +p_fecha_necesidad.
drop function if exists sgc.crear_solicitud_material(uuid, uuid, text, text, jsonb);
create function sgc.crear_solicitud_material(
  p_proyecto_id uuid, p_solicitante_id uuid, p_urgencia text, p_notas text, p_items jsonb,
  p_fecha_necesidad date default null)
 returns uuid
 language plpgsql
as $function$
declare v_solicitud_id uuid;
begin
  if not sgc.requisicion_permitida(p_proyecto_id, p_solicitante_id) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;
  insert into sgc.solicitudes_material (proyecto_id, solicitante_id, urgencia, notas, fecha_necesidad)
  values (p_proyecto_id, p_solicitante_id, p_urgencia, p_notas, p_fecha_necesidad)
  returning id into v_solicitud_id;
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, talla, unidad_capturada, factor_aplicado)
  select v_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion',
         (i->>'cantidad')::numeric, i->>'unidad', nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;
  return v_solicitud_id;
end;
$function$;
grant execute on function sgc.crear_solicitud_material(uuid, uuid, text, text, jsonb, date)
  to authenticated, service_role;

-- 3) Requisición (crear, app móvil) — +p_fecha_necesidad.
drop function if exists sgc.crear_solicitud_app(uuid, uuid, text, text, jsonb);
create function sgc.crear_solicitud_app(
  p_id uuid, p_proyecto_id uuid, p_urgencia text, p_notas text, p_items jsonb,
  p_fecha_necesidad date default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (
    sgc.tiene_modulo('compras')
    or sgc.tiene_modulo('obra')
    or sgc.puede_operar_submodulo('obra.plan_dia')
  ) then
    raise exception 'Tu usuario no tiene el módulo Solicitudes ni acceso a Obra';
  end if;
  if exists (select 1 from sgc.solicitudes_material where id = p_id) then
    return p_id;
  end if;
  if not sgc.requisicion_permitida(p_proyecto_id, auth.uid()) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;

  insert into sgc.solicitudes_material (id, proyecto_id, solicitante_id, estado, urgencia, notas, fecha_necesidad)
  values (p_id, p_proyecto_id, auth.uid(), 'pendiente', coalesce(p_urgencia, 'normal'), p_notas, p_fecha_necesidad);
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, unidad_capturada, factor_aplicado)
  select p_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion', (i->>'cantidad')::numeric, i->>'unidad',
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;
  return p_id;
end;
$function$;
grant execute on function sgc.crear_solicitud_app(uuid, uuid, text, text, jsonb, date)
  to authenticated, service_role;

commit;
