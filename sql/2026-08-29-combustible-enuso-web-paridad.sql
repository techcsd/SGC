-- Paridad web↔app del fix «puede echar gas quien tiene el vehículo EN USO».
--
-- La echada se registra por sgc.registrar_combustible_app, COMPARTIDA por app y
-- web. Ambos llaman el overload con p_confirmado (AW3, 20 args), que YA recibió la
-- mejora de en-uso (csd-app/sql/2026-08-29-fuel-enuso-driver.sql): AF18 ahora
-- permite también a quien tenga un uso v2 activo (vehiculo_usos.fin_at is null),
-- no solo al asignado formal. => la web YA quedó arreglada al compartir ese overload.
--
-- Cabo suelto: quedaba un overload VIEJO de 19 args (sin p_confirmado, de
-- af17-af18-af19) con el AF18 antiguo y mojibake. Como el de 20 args tiene
-- p_confirmado con DEFAULT, cualquier llamada de 19 args es AMBIGUA entre ambos
-- (error "is not unique"). La solución limpia es ELIMINAR el de 19 args: así toda
-- llamada resuelve sin ambigüedad al overload de 20 args (con p_confirmado=false
-- por defecto), que ya trae el fix de en-uso. App y web mandan p_confirmado → no
-- se ven afectados; se elimina de paso el mojibake y la ambigüedad.
--
-- Relacionado (ya aplicado a la MISMA BD compartida desde csd-app/sql, cubre web):
--   · 2026-08-29-fuel-enuso-driver.sql        (AF18 en-uso en el overload p_confirmado)
--   · 2026-08-29-un-uso-activo-por-chofer.sql (trigger: 1 vehículo en uso por chofer)
--   · 2026-08-29-alinear-asignaciones-a-uso.sql (realineación puntual de asignaciones)

drop function if exists sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text,
  text, text, text, text, boolean, text, text, uuid
);
