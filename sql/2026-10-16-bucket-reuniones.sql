-- Declara el bucket 'reuniones' (CP8, foto de pizarra en nota de reunión desde la app
-- móvil — csd-app/src/app/core/services/reuniones.service.ts, sube vía outbox con
-- upsert:true) que el auditor cruzado audit-buckets-upsert-policy.mjs (BM2) detectó
-- usado pero no declarado en sql/ de este repo — rompía el build (regla 5 del
-- checklist, BI1: todo bucket con upsert:true nace con política INSERT+SELECT+UPDATE).
-- Privado + mismo patrón que vehiculos/conduces/inventario/conductores.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-10-16-bucket-reuniones.sql --env dev|prod

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('reuniones', 'reuniones', false, 15728640)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'csd_reuniones_bucket_insert') then
    create policy csd_reuniones_bucket_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'reuniones');
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_reuniones_bucket_select') then
    create policy csd_reuniones_bucket_select on storage.objects
      for select to authenticated
      using (bucket_id = 'reuniones');
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_reuniones_bucket_update') then
    create policy csd_reuniones_bucket_update on storage.objects
      for update to authenticated
      using (bucket_id = 'reuniones')
      with check (bucket_id = 'reuniones');
  end if;
end
$$;

commit;
