-- BV4 (kill-switch) — bandera para apagar el emparejamiento automático sin desplegar.
-- flota_config.vincular_requisiciones = 0 → el hook de recepción NO llama al motor
-- (ausente o 1 = encendido, default). Cumple la cláusula de rollback del PROMPT-60.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv4e-kill-switch.sql --env dev  →  --env prod
begin;

-- Semilla visible (default = encendido). No pisa un valor ya puesto por un admin.
insert into sgc.flota_config (clave, valor) values ('vincular_requisiciones', 1)
  on conflict (clave) do nothing;

create or replace function sgc.tg_vincular_requisiciones_al_recibir()
 returns trigger language plpgsql security definer set search_path to 'sgc', 'extensions', 'pg_temp'
as $fn$
begin
  -- Kill-switch: si un admin apagó el emparejamiento, no hacemos nada.
  if coalesce((select valor from sgc.flota_config where clave = 'vincular_requisiciones'), 1) = 0 then
    return NEW;
  end if;

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

commit;
