-- ⛑️ RECONSTRUIDA (CD10 / regla 19) — ver sql/_recuperadas/README.md
-- Original corrida desde scratchpad el 2026-08-29, nunca versionada ni en ledger.
-- Reconstruida por introspección de la definición viva en prod (pg_get_functiondef)
-- el 2026-09-30. Ya está aplicada en prod; este archivo es solo trazabilidad
-- (idempotente: create or replace).
--
-- Qué hace: un chofer solo puede tener UN vehículo en uso a la vez. Al abrir un uso
-- nuevo (fin_at is null), cierra automáticamente cualquier otro uso abierto del
-- mismo chofer (mismo es_prueba) con una nota. Refuerza `mi_uso_activo()` = 1 fila.
--
-- ⚠️ Cabo suelto que este trigger NO cubre (y que corrige CD3): si el chofer nunca
-- abre otro uso, el uso viejo queda abierto para siempre (Edward Mota: uso de MT 03
-- abierto desde el 2026-08-14 sin cerrar). CD3 añade el cron que cierra usos > 24 h
-- sin actividad (`sgc-cerrar-usos-huerfanos`).

create or replace function sgc.tg_uso_unico_por_chofer()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if new.fin_at is null then
    update sgc.vehiculo_usos
       set fin_at = coalesce(new.inicio_at, now()),
           notas  = concat_ws(' · ', notas, 'Cerrado: el chofer pasó a otro vehículo')
     where usuario_id = new.usuario_id
       and fin_at is null
       and coalesce(es_prueba, false) = coalesce(new.es_prueba, false);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_uso_unico_por_chofer on sgc.vehiculo_usos;
create trigger trg_uso_unico_por_chofer
  before insert on sgc.vehiculo_usos
  for each row execute function sgc.tg_uso_unico_por_chofer();
