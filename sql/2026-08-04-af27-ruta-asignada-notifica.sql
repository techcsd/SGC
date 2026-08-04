-- ============================================================================
-- TRANSPORTE v2 — FASE 5.3 — Push al chofer al asignarle una ruta (AF27)
-- Ronda 03/08/2026 (IDs AF) — PROMPT-3.
--
-- Ni crear_ruta_app ni chofer_crear_ruta notificaban al conductor. Un trigger
-- sobre `rutas` cubre TODAS las vías (web directo, RPCs, app) en un solo lugar:
-- al asignar/ cambiar el conductor de una ruta, notifica a su usuario (in-app +
-- push, vía sgc.notificar de PROMPT-1). No auto-notifica si el chofer creó su
-- propia ruta (self-assign).
--
-- Aditivo, idempotente.
-- ============================================================================

create or replace function sgc.tg_ruta_asignada_notifica()
returns trigger
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_usuario uuid; v_placa text;
begin
  if new.conductor_id is null then return new; end if;
  -- solo cuando el conductor se asigna (insert) o cambia (update)
  if tg_op = 'UPDATE' and not (old.conductor_id is distinct from new.conductor_id) then
    return new;
  end if;

  select usuario_id into v_usuario from sgc.conductores where id = new.conductor_id;
  if v_usuario is null then return new; end if;
  -- no notificar auto-asignación (el chofer creó su propia ruta)
  if v_usuario = new.creado_por then return new; end if;

  select placa into v_placa from sgc.vehiculos where id = new.vehiculo_id;

  perform sgc.notificar(
    v_usuario, 'info',
    'Nueva ruta asignada',
    format('Se te asignó una ruta%s: %s → %s.',
           case when v_placa is not null then ' ('||v_placa||')' else '' end,
           coalesce(new.origen,'—'), coalesce(new.destino,'—')),
    '/transporte/conduces'
  );
  return new;
end;
$$;

drop trigger if exists trg_ruta_asignada_notifica on sgc.rutas;
create trigger trg_ruta_asignada_notifica
  after insert or update of conductor_id on sgc.rutas
  for each row execute function sgc.tg_ruta_asignada_notifica();
