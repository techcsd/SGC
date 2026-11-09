-- DJ (hotfix, app, 05-nov-2026) — garantiza UNA sola versión `publicada=true`
-- por plataforma en sgc.app_versiones (trigger), para que no vuelva a pasar
-- lo que causó el incidente de hoy.
--
-- CONTEXTO: `sgc.app_versiones.publicada` es un boolean plano sin ninguna
-- restricción de unicidad. El admin de SGC ("Historial de versiones") lo usa
-- como si fuera un radio-button ("la versión publicada actual"), pero nada
-- en la base impide que dos filas queden con publicada=true a la vez — pasó
-- hoy (2.50.0 y 2.66.1, la versión que crasheaba, ambas publicada=true), y
-- `sgc.version_publicada()` devolvía la más nueva de las dos marcadas, que
-- resultó ser justo la rota — el aviso "hay una versión nueva" de la app
-- seguía mandando a todos hacia el APK que crashea incluso después de
-- publicar el hotfix 2.66.2 en el bucket. El archivo
-- `2026-11-05-dj-publicar-2.66.2-hotfix-crash.sql` corrige el dato de HOY;
-- este archivo corrige la causa estructural para que no se repita.
--
-- FIX: trigger BEFORE INSERT/UPDATE que, cuando una fila queda con
-- publicada=true, apaga automáticamente publicada en las demás filas de la
-- MISMA plataforma. Así cualquier camino que la ponga en true (el admin de
-- SGC, un SQL de publicación como los de arriba, o cualquier futuro código)
-- queda exclusivo sin tener que acordarse de apagar las demás a mano.
--
-- Regla 19 (CD10, no negociable): el hijo (csd-app) no aplica nada a prod
-- directo — deja el SQL fechado aquí y lo aplica el PADRE (SGC), en dev
-- primero y luego en prod (regla 18). Reversible: `drop trigger` + `drop
-- function` deshacen esto sin tocar ninguna fila existente.
--
-- Aplicar DESPUÉS de 2026-11-05-dj-publicar-2.66.2-hotfix-crash.sql (ese deja
-- el dato limpio primero; este trigger evita que se vuelva a ensuciar).

create or replace function sgc.tg_app_versiones_publicada_unica()
returns trigger
language plpgsql
as $function$
begin
  if new.publicada is true then
    update sgc.app_versiones
       set publicada = false
     where plataforma = new.plataforma
       and id <> new.id
       and publicada is true;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_app_versiones_publicada_unica on sgc.app_versiones;
create trigger trg_app_versiones_publicada_unica
  before insert or update of publicada on sgc.app_versiones
  for each row
  execute function sgc.tg_app_versiones_publicada_unica();

-- Verificación esperada tras aplicar (en dev primero):
--   -- Marcar una versión vieja como publicada de prueba no debe dejar 2 filas:
--   update sgc.app_versiones set publicada = true
--    where plataforma='movil' and version = (select version from sgc.app_versiones where plataforma='movil' order by fecha asc limit 1);
--   select count(*) from sgc.app_versiones where plataforma='movil' and publicada; -- debe dar 1
--   -- Restaurar la publicada real de dev/prod después de probar.
