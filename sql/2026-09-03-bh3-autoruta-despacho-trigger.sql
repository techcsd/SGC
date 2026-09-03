-- ════════════════════════════════════════════════════════════════════════════
--  BH3 — Cuando un conduce recibe chofer, su ruta se crea sola (lado DESPACHO)
--  ---------------------------------------------------------------------------
--  `conduce_asegurar_ruta` ya existe, es idempotente y marca `derivada_de_conduce`
--  (el incentivo la excluye — "no suma"). Hasta ahora SOLO la llamaba
--  `aceptar_transferencia_conduce`. El despacho (Raykler asigna un chofer a un
--  conduce ya emitido) fija `conductor_id` con un UPDATE CRUDO a la tabla desde la
--  web (salidas.service.ts), esquivando toda RPC → no había punto donde llamar la
--  función. Un TRIGGER lo captura sin importar la vía (web cruda, app, RPC futura).
--
--  Diseño seguro:
--   • Solo `AFTER UPDATE OF conductor_id` + WHEN (conductor recién asignado y sin
--     ruta) → no hay recursión: el UPDATE interno que fija ruta_id NO toca
--     conductor_id, así que no re-dispara.
--   • Errores SWALLOWED (best-effort): la creación de ruta NUNCA debe tumbar un
--     despacho. El botón manual "Iniciar ruta" sigue como red de seguridad.
--   • Idempotente (la función devuelve la ruta existente si ya hay). Aditivo.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function sgc.tg_conduce_autoruta()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  begin
    perform sgc.conduce_asegurar_ruta(new.id);
  exception when others then
    -- best-effort: si algo falla, el despacho sigue; queda el manual "Iniciar ruta".
    raise warning 'tg_conduce_autoruta: no se aseguró la ruta del conduce %: %', new.id, sqlerrm;
  end;
  return null; -- AFTER trigger
end;
$function$;

-- La ruta necesita conductor Y vehículo (rutas.vehiculo_id es NOT NULL). El despacho
-- de la web fija ambos juntos; por si llegan en updates separados, el trigger escucha
-- las DOS columnas y solo procede cuando ambas están presentes (y aún no hay ruta).
drop trigger if exists tg_conduce_autoruta on sgc.salidas_inventario;
create trigger tg_conduce_autoruta
  after update of conductor_id, vehiculo_id on sgc.salidas_inventario
  for each row
  when (
    new.conductor_id is not null
    and new.vehiculo_id is not null
    and new.ruta_id is null
    and (new.conductor_id is distinct from old.conductor_id
         or new.vehiculo_id is distinct from old.vehiculo_id)
  )
  execute function sgc.tg_conduce_autoruta();
