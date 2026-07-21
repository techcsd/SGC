-- ============================================================================
-- Actualización 3 · PROMPT-9 · S16 — Rutas asignadas por el jefe de flota.
-- ----------------------------------------------------------------------------
-- 1) Versiona `mis_rutas_hoy()` (ya vivía en la BD sin migración): filtra por el
--    conductor vinculado al usuario autenticado (conductores.usuario_id).
-- 2) Trigger: al asignar/cambiar el conductor de una ruta, notifica al chofer
--    ("Te asignaron una ruta: {origen} → {destino}", deep-link ?item=).
-- RLS de rutas ya es R14-coherente (select: es_flota_elevado OR creado_por OR
--    conductor_id IN mis_conductor_ids) — no se toca.
-- Aditivo / idempotente / retrocompatible.
-- ============================================================================
set search_path = sgc, public;

-- ── 1) mis_rutas_hoy() — versionada (cuerpo vigente en la BD) ────────────────
create or replace function sgc.mis_rutas_hoy()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'origen', r.origen, 'destino', r.destino,
    'estado', r.estado, 'fecha', r.fecha, 'notas', r.notas) order by r.fecha desc), '[]'::jsonb)
  from sgc.rutas r
  where r.fecha = current_date
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$function$;
grant execute on function sgc.mis_rutas_hoy() to authenticated, service_role;

-- ── 2) Notificación dirigida al chofer al asignar/cambiar conductor ──────────
create or replace function sgc.tg_ruta_notificar_conductor()
returns trigger
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid uuid;
begin
  -- Solo si hay conductor y (alta con conductor) o cambió el conductor asignado.
  if new.conductor_id is not null
     and (tg_op = 'INSERT' or new.conductor_id is distinct from old.conductor_id) then
    select usuario_id into v_uid from sgc.conductores where id = new.conductor_id;
    if v_uid is not null then
      insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
      values (
        v_uid, 'info',
        'Te asignaron una ruta',
        coalesce(new.origen, '?') || ' → ' || coalesce(new.destino, '?')
          || coalesce(' · ' || to_char(new.fecha, 'DD/MM/YYYY'), ''),
        '/flota/rutas?item=' || new.id::text
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ruta_notificar_conductor on sgc.rutas;
create trigger trg_ruta_notificar_conductor
  after insert or update on sgc.rutas
  for each row execute function sgc.tg_ruta_notificar_conductor();
