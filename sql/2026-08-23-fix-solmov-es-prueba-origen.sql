-- Fix: crear_solicitud_movimiento fallaba ("record new has no field es_prueba_origen")
-- cuando el origen/proyecto es una entidad es_prueba. El trigger genérico
-- sgc.tg_heredar_es_prueba asigna NEW.es_prueba_origen al heredar el flag, pero la
-- tabla solicitudes_movimiento se creó solo con `es_prueba` (le faltaba la columna
-- `es_prueba_origen` que sí tienen las demás tablas con ese trigger).
-- Fix mínimo y aditivo: agregar la columna (NO se toca el trigger compartido).
set search_path = sgc, public;

alter table sgc.solicitudes_movimiento
  add column if not exists es_prueba_origen text;

-- verificación
select column_name from information_schema.columns
 where table_schema='sgc' and table_name='solicitudes_movimiento' and column_name like 'es_prueba%'
 order by column_name;
