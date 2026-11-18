-- 2026-11-17 -- #61: el backlog de avisos informativos `reporte_semanal` pendientes (ruido: 65% de los avisos de flota) se marca atendido con nota.
-- Solo los de mas de 7 dias (el resumen semanal vigente se conserva); no toca otros tipos ni borra nada. Idempotente.
-- (Los 56 conduces anulados sin motivo NO se tocan: un UPDATE sobre salidas_inventario re-emitiria eventos al outbox de Odoo y el motivo
--  obligatorio ya rige desde dj7.)
update sgc.avisos_flota
   set estado = 'atendido', atendido_at = now(),
       nota_atencion = coalesce(nota_atencion, 'Cierre automático del backlog informativo (DS, 17-nov-2026): reporte semanal con más de 7 días.')
 where tipo = 'reporte_semanal' and estado = 'pendiente' and created_at < now() - interval '7 days';
