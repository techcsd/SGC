-- Falta política UPDATE en storage.objects para el bucket sgc-legal.
-- Causa: la app móvil (legal.service.ts, subirFirmado()) sube el PDF firmado de
-- un contrato con upsert:true (permite re-subir/reemplazar el firmado). Supabase
-- Storage implementa upsert como `INSERT ... ON CONFLICT DO UPDATE`, y Postgres
-- evalúa ese UPDATE contra la política UPDATE de storage.objects — que nunca se
-- creó para este bucket (sql/2026-07-06-legal-module.sql solo trae select/insert/
-- delete). Sin esto la subida falla con 400 (RLS) de forma silenciosa, y el audit
-- `audit-buckets-upsert-policy.mjs` (regla 5) bloquea el build de este repo hasta
-- que se agregue. Encontrado en pruebas en vivo (dev) del hijo csd-app, ronda CO.
--
-- Entorno: dev primero (regla 18/BU1), luego prod. Mismo patrón que las políticas
-- select/insert/delete existentes, solo cambia la operación a UPDATE.

create policy "sgc-legal: scoped update" on storage.objects for update to authenticated
  using (bucket_id = 'sgc-legal' and (sgc.is_admin() or sgc.tiene_modulo('legal')))
  with check (bucket_id = 'sgc-legal' and (sgc.is_admin() or sgc.tiene_modulo('legal')));
