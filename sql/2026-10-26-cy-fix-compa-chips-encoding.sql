-- Fix de codificación en sgc.compa_chips — encontrado en vivo (Full Review
-- post-ronda-CY, 26-oct-2026) probando Compa como qa_capataz en el teléfono
-- real de Xaviel: la sugerencia "¿Cómo van las rutas de hoy?" se veía como
-- "Â¿CÃ³mo van las rutas de hoy?" (UTF-8 doble-codificado / mojibake clásico:
-- un texto ya en UTF-8 se interpretó como Latin-1 y se volvió a guardar como
-- UTF-8).
--
-- Confirmado leyendo sql/2026-08-31-be2-compa-chips-por-rol.sql: el archivo
-- fuente tiene la codificación CORRECTA ("¿Cómo van las rutas de hoy?"), así
-- que la corrupción ocurrió al aplicar esa migración (probablemente
-- client_encoding mal seteado en la conexión que la corrió), no en el
-- archivo. Confirmado también que SOLO las filas de esa migración están
-- afectadas — las de la migración anterior (be-fase6) están bien.
--
-- Verificado en vivo contra prod (solo lectura): 11 de 30 filas de
-- sgc.compa_chips tienen el mismo patrón de doble-codificación, repartidas en
-- 5 personas (admin, default, ingeniero, jefe, logística). Esta migración
-- corrige las 11, por texto corrupto exacto (no por posición, para no tocar
-- nada que esté bien).
--
-- Entorno: aplicar primero en dev, verificar, luego prod (regla 18) — esto
-- ya está roto en PROD hoy (confirmado), así que no hay "antes/después" que
-- comparar entre dev y prod en cuanto al bug en sí, pero el ciclo de
-- promoción se respeta igual.

begin;
set local search_path = sgc, public;

update sgc.compa_chips set texto = '¿Cómo van las rutas de hoy?'
  where persona = 'admin' and texto = 'Â¿CÃ³mo van las rutas de hoy?';
update sgc.compa_chips set texto = '¿Qué hizo hoy un usuario?'
  where persona = 'admin' and texto = 'Â¿QuÃ© hizo hoy un usuario?';

update sgc.compa_chips set texto = '¿Cómo van las rutas de hoy?'
  where persona = 'default' and texto = 'Â¿CÃ³mo van las rutas de hoy?';

update sgc.compa_chips set texto = '¿Dónde hay puntales disponibles?'
  where persona = 'ingeniero' and texto = 'Â¿DÃ³nde hay puntales disponibles?';

update sgc.compa_chips set texto = '¿Cómo van todas las rutas de hoy?'
  where persona = 'jefe' and texto = 'Â¿CÃ³mo van todas las rutas de hoy?';
update sgc.compa_chips set texto = '¿Qué hizo hoy un chofer?'
  where persona = 'jefe' and texto = 'Â¿QuÃ© hizo hoy un chofer?';
update sgc.compa_chips set texto = '¿Qué vehículos están en uso?'
  where persona = 'jefe' and texto = 'Â¿QuÃ© vehÃ­culos estÃ¡n en uso?';
update sgc.compa_chips set texto = '¿Qué conduces hay por firmar?'
  where persona = 'jefe' and texto = 'Â¿QuÃ© conduces hay por firmar?';

update sgc.compa_chips set texto = '¿Cómo van todas las rutas de hoy?'
  where persona = 'logistica' and texto = 'Â¿CÃ³mo van todas las rutas de hoy?';
update sgc.compa_chips set texto = '¿Qué hizo hoy un chofer?'
  where persona = 'logistica' and texto = 'Â¿QuÃ© hizo hoy un chofer?';
update sgc.compa_chips set texto = '¿Dónde hay un material disponible?'
  where persona = 'logistica' and texto = 'Â¿DÃ³nde hay un material disponible?';

do $$
declare v_restantes int;
begin
  select count(*) into v_restantes from sgc.compa_chips where texto like 'Â%';
  if v_restantes <> 0 then
    raise exception 'FALLO: quedan % filas con el patrón de doble-codificación sin corregir', v_restantes;
  end if;
  raise notice 'OK: 0 filas de compa_chips con mojibake restantes';
end $$;

commit;
