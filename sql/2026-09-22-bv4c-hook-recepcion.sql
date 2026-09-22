-- BV4 (enganche) — Cuando una salida LLEGA a la obra (se marca entregada o el receptor
-- la confirma) y NO estaba ligada a una requisición, corremos el motor de emparejamiento
-- para que su material cubra los renglones pendientes de las requisiciones de esa obra.
-- Regla 13: trigger security definer, search_path fijo, idempotente (vincular ya de-dup por
-- movimiento), no toca stock ni estado real. La salida ligada (origen_requisicion_id) se
-- salta sola dentro de vincular (se cuenta como despacho explícito).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv4c-hook-recepcion.sql --env dev  →  --env prod
-- Rollback: drop trigger trg_vincular_requisiciones_al_recibir on sgc.salidas_inventario; drop function sgc.tg_vincular_requisiciones_al_recibir();
begin;

create or replace function sgc.tg_vincular_requisiciones_al_recibir()
 returns trigger language plpgsql security definer set search_path to 'sgc', 'extensions', 'pg_temp'
as $fn$
begin
  if NEW.proyecto_id is not null
     and NEW.origen_requisicion_id is null
     and NEW.anulado_por is null
     and (
          (NEW.estado = 'entregado'   and OLD.estado      is distinct from 'entregado')
       or (NEW.recibido_por is not null and OLD.recibido_por is null)
     )
  then
    perform sgc.vincular_movimiento_requisiciones('salida', NEW.id);
  end if;
  return NEW;
end $fn$;

drop trigger if exists trg_vincular_requisiciones_al_recibir on sgc.salidas_inventario;
create trigger trg_vincular_requisiciones_al_recibir
  after update of estado, recibido_por on sgc.salidas_inventario
  for each row execute function sgc.tg_vincular_requisiciones_al_recibir();

commit;
