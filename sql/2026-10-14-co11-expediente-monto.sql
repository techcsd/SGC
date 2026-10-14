-- CO11 — PROMPT-98 FASE 9 (14/10/2026): "Monto reclamado" como campo propio
-- (hoy vive enterrado dentro de la descripción). Aditivo, idempotente.
begin;
alter table sgc.expedientes_legales add column if not exists monto_reclamado numeric;
comment on column sgc.expedientes_legales.monto_reclamado is
  'CO11 — monto reclamado del expediente (antes solo texto libre en la descripción).';
commit;
