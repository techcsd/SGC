-- ============================================================================
-- Q2 — Notificaciones que señalan el ítem concreto (?item={id}) (20/07/2026)
-- ----------------------------------------------------------------------------
-- Patrón: las notificaciones con un registro concreto apuntan a la lista destino
-- con `?item={id}`; la lista lo resalta (directiva web `appHighlightItem`).
--
-- Migración ADITIVA (solo cambia el texto de la ruta generada). Se actualiza el
-- generador in-app confirmado que apunta a una lista ya resaltable: el aviso al
-- solicitante cuando cambia el estado de su requisición.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.trg_notif_requisicion() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if NEW.estado is distinct from OLD.estado and NEW.estado in ('aprobada','entregada','cerrada','rechazada') then
    perform sgc.notificar(
      NEW.solicitante_id,
      case when NEW.estado='rechazada' then 'warning' else 'success' end,
      'Requisición ' || NEW.estado,
      'Tu requisición cambió a "' || NEW.estado || '".',
      -- Q2 — apunta al ítem concreto para resaltarlo en la lista destino.
      '/bitacora/solicitudes-material?item=' || NEW.id
    );
  end if;
  return NEW;
end;
$function$;
