-- =============================================================================
-- PROMPT-32 (BI1b) — Completar las políticas UPDATE que la auditoría de buckets
-- encontró faltantes/no-declaradas. Ronda 03/09/2026. Aditivo, idempotente.
--
-- El auditor scripts/audit-buckets-upsert-policy.mjs (regla 5) encontró, al cruzar
-- los buckets usados con upsert:true contra las políticas UPDATE, dos casos además
-- de sgc-bitacora (bi1):
--   · sgc-documentos: recibe subidas de expediente con upsert:true
--     (proyectos.service.ts:uploadExpedienteArchivo, EXPEDIENTE_BUCKET) pero SÓLO
--     tenía INSERT/SELECT/DELETE → un REINTENTO de una subida de expediente moriría
--     con "new row violates row-level security policy". MISMO bug que sgc-bitacora,
--     latente. Se le da UPDATE con el mismo scope que su DELETE.
--   · sgc-mensajes: SÍ tiene UPDATE en prod ("sgc-mensajes: scoped update", con
--     es_participante) pero NUNCA se declaró en sql/ → el auditor estático no la ve.
--     Se re-declara idempotente para que sql/ sea la fuente de verdad.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-03-bi1b-storage-update-policies-completar.sql
-- =============================================================================
begin;

-- ── sgc-documentos: UPDATE (faltaba de verdad) ───────────────────────────────
drop policy if exists "sgc-documentos: scoped update" on storage.objects;
create policy "sgc-documentos: scoped update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sgc-documentos' and (sgc.is_admin() or sgc.tiene_modulo('proyectos')))
  with check (bucket_id = 'sgc-documentos' and (sgc.is_admin() or sgc.tiene_modulo('proyectos')));

-- ── sgc-mensajes: UPDATE (existe en prod, se declara en sql/ por trazabilidad) ─
drop policy if exists "sgc-mensajes: scoped update" on storage.objects;
create policy "sgc-mensajes: scoped update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sgc-mensajes' and sgc.es_participante((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'sgc-mensajes' and sgc.es_participante((storage.foldername(name))[1]::uuid));

-- ── sgc-cronograma: UPDATE (existe en prod, se declara en sql/ por trazabilidad) ─
--    El outbox sube evidencia de tareas (bucket: BUCKET, upsert:true).
drop policy if exists "sgc-cronograma: authenticated update" on storage.objects;
create policy "sgc-cronograma: authenticated update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sgc-cronograma')
  with check (bucket_id = 'sgc-cronograma');

-- ── sgc-rrhh: UPDATE (faltaba de verdad) ─────────────────────────────────────
--    El outbox sube fotos de asignaciones (bucket: AUDIT_BUCKET_RRHH, upsert:true).
--    Sin UPDATE, un reintento moriría con RLS. Scope = igual que su read/delete.
drop policy if exists "sgc-rrhh: scoped update" on storage.objects;
create policy "sgc-rrhh: scoped update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sgc-rrhh' and (sgc.is_admin() or sgc.tiene_modulo('rrhh')))
  with check (bucket_id = 'sgc-rrhh' and (sgc.is_admin() or sgc.tiene_modulo('rrhh')));

commit;
