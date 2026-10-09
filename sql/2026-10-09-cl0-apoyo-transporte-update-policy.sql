-- 2026-10-09-cl0-apoyo-transporte-update-policy.sql — CL (regla 5, arreglo pre-CL)
--
-- El bucket privado `apoyo-transporte` (CK12) tenía política SELECT e INSERT pero NO
-- UPDATE en storage.objects. La app (csd-app apoyo.service.ts) sube la evidencia con
-- `upsert:true`; un REINTENTO del mismo archivo (misma ruta) es un UPDATE → sin la
-- política, revienta con "new row violates row-level security policy for table objects".
-- Es exactamente el patrón que cazó BI1 (sgc-bitacora) y que la guarda
-- audit-buckets-upsert-policy.mjs vigila. Aquí añadimos la UPDATE espejo de la INSERT.
--
--   node scripts/apply-migration.mjs sql/2026-10-09-cl0-apoyo-transporte-update-policy.sql --env dev
--   node scripts/apply-migration.mjs sql/2026-10-09-cl0-apoyo-transporte-update-policy.sql --env prod   (tras OK)

begin;

drop policy if exists "apoyo-transporte actualiza" on storage.objects;
create policy "apoyo-transporte actualiza" on storage.objects
  for update to authenticated
  using (bucket_id = 'apoyo-transporte'
         and sgc.puede_ver_apoyo(nullif((storage.foldername(name))[1], '')::uuid))
  with check (bucket_id = 'apoyo-transporte'
              and sgc.puede_ver_apoyo(nullif((storage.foldername(name))[1], '')::uuid));

commit;
