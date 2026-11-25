-- Reversa de EA2 (sql/2026-11-24-ea2-leer-cedulas-lote.sql): quita los 3 parametros sembrados.
-- No hay nada mas que revertir (la migracion es solo datos de configuracion). El registro historico
-- en sgc.uso_ia (funcion = 'leer_cedulas_lote') se conserva a proposito: es auditoria de costo.
delete from sgc.parametros
 where clave in (
   'leer_cedulas_lote_limite_usuario_hora',
   'leer_cedulas_lote_limite_diario',
   'leer_cedulas_confianza_min'
 );
