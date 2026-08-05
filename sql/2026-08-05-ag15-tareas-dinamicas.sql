-- ============================================================================
-- AG15 — Tareas dinámicas: una tarea puede vincularse a una ENTIDAD del sistema
-- (conduce, ruta, mantenimiento, tarea de cronograma). Al completarse la entidad,
-- la tarea se completa sola y notifica al asignador. Aditivo/retrocompatible: las
-- tareas SIN vínculo funcionan igual que hoy.
--
-- Contrato para la app (PROMPT-6):
--   1. El asignador crea la tarea con linked_tipo + linked_params (ferretería/
--      bodega, obra destino, vehículo…). linked_id queda NULL si la entidad aún
--      no existe (caso conduce: se crea al "iniciar").
--   2. Al "iniciar" una tarea conduce/ruta, la app crea la entidad pre-llenada
--      (crear_conduce_transportista / rutas) y llama vincular_tarea_entidad(...).
--   3. Cuando la entidad llega a su estado "hecho", un trigger completa la tarea
--      (auto_completada=true) y notifica a asignado_por.
-- ============================================================================

set search_path = sgc, public;

-- ── Schema aditivo en sgc.tareas ────────────────────────────────────────────
alter table sgc.tareas add column if not exists linked_tipo    text
  check (linked_tipo in ('conduce','ruta','mantenimiento','cronograma'));
alter table sgc.tareas add column if not exists linked_id       uuid;
alter table sgc.tareas add column if not exists linked_params   jsonb not null default '{}'::jsonb;
alter table sgc.tareas add column if not exists auto_completada boolean not null default false;

create index if not exists idx_tareas_linked on sgc.tareas (linked_tipo, linked_id)
  where linked_tipo is not null;

-- ── Sincronización: completar tareas vinculadas a una entidad "hecha" ───────
create or replace function sgc.sincronizar_tareas_vinculadas(p_tipo text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare r record;
begin
  if p_tipo is null or p_entity_id is null then return; end if;
  for r in
    select id, titulo, asignado_por
    from sgc.tareas
    where linked_tipo = p_tipo and linked_id = p_entity_id
      and estado not in ('completada','cancelada')
  loop
    update sgc.tareas
      set estado='completada', fecha_completada=now(), auto_completada=true
      where id = r.id;
    -- Notificar al asignador (in-app + push).
    if r.asignado_por is not null then
      perform sgc.notificar(r.asignado_por, 'info', 'Tarea completada automáticamente',
        'La tarea "'||coalesce(r.titulo,'(sin título)')||'" se completó al concluir su '||p_tipo||' vinculado.',
        '/tareas');
    end if;
  end loop;
end;
$function$;
grant execute on function sgc.sincronizar_tareas_vinculadas(text, uuid) to authenticated, service_role;

-- ── RPC: vincular una tarea a una entidad (al crearla/iniciarla desde la app) ─
create or replace function sgc.vincular_tarea_entidad(
  p_tarea_id uuid,
  p_tipo text,
  p_entity_id uuid
) returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v sgc.tareas;
begin
  if p_tipo not in ('conduce','ruta','mantenimiento','cronograma') then
    raise exception 'Tipo de vínculo inválido: %', p_tipo;
  end if;
  select * into v from sgc.tareas where id = p_tarea_id;
  if not found then raise exception 'Tarea no encontrada'; end if;
  -- Sólo el asignado, el asignador, admin o el módulo tareas pueden vincular.
  if not (v.asignado_a = auth.uid() or v.asignado_por = auth.uid() or sgc.is_admin()) then
    raise exception 'No autorizado para vincular esta tarea';
  end if;
  update sgc.tareas
    set linked_tipo = coalesce(linked_tipo, p_tipo), linked_id = p_entity_id
    where id = p_tarea_id;
  -- Si la entidad ya está "hecha" al momento de vincular, completar de una vez.
  perform sgc.sincronizar_tareas_vinculadas(p_tipo, p_entity_id);
end;
$function$;
grant execute on function sgc.vincular_tarea_entidad(uuid, text, uuid) to authenticated;

-- ── Triggers de sincronización por entidad (AFTER UPDATE del estado) ────────
-- Conduce = salida de inventario entregada (entregado / entregado_incompleto).
create or replace function sgc.tg_sync_tarea_conduce() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if NEW.estado in ('entregado','entregado_incompleto') and NEW.estado is distinct from OLD.estado then
    perform sgc.sincronizar_tareas_vinculadas('conduce', NEW.id);
  end if;
  return NEW;
end; $function$;
drop trigger if exists trg_sync_tarea_conduce on sgc.salidas_inventario;
create trigger trg_sync_tarea_conduce
  after update of estado on sgc.salidas_inventario
  for each row execute function sgc.tg_sync_tarea_conduce();

-- Ruta completada.
create or replace function sgc.tg_sync_tarea_ruta() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if NEW.estado = 'completada' and NEW.estado is distinct from OLD.estado then
    perform sgc.sincronizar_tareas_vinculadas('ruta', NEW.id);
  end if;
  return NEW;
end; $function$;
drop trigger if exists trg_sync_tarea_ruta on sgc.rutas;
create trigger trg_sync_tarea_ruta
  after update of estado on sgc.rutas
  for each row execute function sgc.tg_sync_tarea_ruta();

-- Mantenimiento completado.
create or replace function sgc.tg_sync_tarea_mant() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if NEW.estado = 'completado' and NEW.estado is distinct from OLD.estado then
    perform sgc.sincronizar_tareas_vinculadas('mantenimiento', NEW.id);
  end if;
  return NEW;
end; $function$;
drop trigger if exists trg_sync_tarea_mant on sgc.mantenimientos;
create trigger trg_sync_tarea_mant
  after update of estado on sgc.mantenimientos
  for each row execute function sgc.tg_sync_tarea_mant();

-- Tarea de cronograma completada.
create or replace function sgc.tg_sync_tarea_crono() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if NEW.estado = 'completada' and NEW.estado is distinct from OLD.estado then
    perform sgc.sincronizar_tareas_vinculadas('cronograma', NEW.id);
  end if;
  return NEW;
end; $function$;
drop trigger if exists trg_sync_tarea_crono on sgc.cronograma_tareas;
create trigger trg_sync_tarea_crono
  after update of estado on sgc.cronograma_tareas
  for each row execute function sgc.tg_sync_tarea_crono();
