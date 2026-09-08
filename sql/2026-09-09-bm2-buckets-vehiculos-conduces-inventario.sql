-- ============================================================================
-- PROMPT-40 (BM) FASE 3 — BM2: declarar en `sql/` los buckets que la app usa con
-- upsert:true pero que nacieron desde el dashboard, para que el REPO sea la fuente
-- de verdad y el auditor los cubra.  Ronda 09/09/2026.  Aditivo, idempotente.
--
-- RAÍZ: scripts/audit-buckets-upsert-policy.mjs sólo consideraba buckets DECLARADOS
-- en sql/ (declaredBuckets); `vehiculos` (19 sitios, TODAS las fotos de combustible),
-- `conduces` (21 sitios) e `inventario` se crearon desde el dashboard → el auditor
-- los omitía en silencio y reportaba "todos con política UPDATE".  Punto ciego
-- estructural (la 8ª regla en versión script: "no declarado" ≠ "está bien").
-- Además BJ1 (límite de tamaño) los saltó → seguían SIN techo.
--
-- En PROD estos tres buckets YA tienen INSERT+SELECT+UPDATE (csd_field_buckets_*,
-- csd_inventario_*) — verificado 09-sep.  Esta migración NO cambia prod: reusa los
-- nombres/predicados existentes con guardas `if not exists`, y sólo AÑADE el
-- file_size_limit que faltaba.  El valor real es hacer que `sql/` describa lo que
-- prod ya tiene, de modo que el auditor invertido (BM2b) no rompa el build.
--
-- Un `insert ... values ('X'` por bucket (el regex del auditor captura sólo la 1ª
-- tupla de cada statement).
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-09-bm2-buckets-vehiculos-conduces-inventario.sql
-- ============================================================================

begin;

-- ── Buckets (idempotente) + límite de tamaño de fotos de evidencia (15 MB, BJ1) ──
insert into storage.buckets (id, name, public, file_size_limit)
  values ('vehiculos', 'vehiculos', false, 15728640)
  on conflict (id) do update set file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
  values ('conduces', 'conduces', false, 15728640)
  on conflict (id) do update set file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
  values ('inventario', 'inventario', false, 15728640)
  on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ── Políticas: INSERT + SELECT + UPDATE (idempotentes; reusan los nombres de prod).
--    Sin la UPDATE, un REINTENTO de subida (misma ruta con upsert:true) revienta
--    con "new row violates row-level security policy" (la enfermedad de BI1). ──────
do $$
begin
  -- vehiculos + conduces (comparten política de campo, `csd_field_buckets_*`).
  if not exists (select 1 from pg_policy where polname = 'csd_field_buckets_insert') then
    create policy csd_field_buckets_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = any (array['vehiculos', 'conduces']));
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_field_buckets_select') then
    create policy csd_field_buckets_select on storage.objects
      for select to authenticated
      using (bucket_id = any (array['vehiculos', 'conduces']));
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_field_buckets_update') then
    create policy csd_field_buckets_update on storage.objects
      for update to authenticated
      using (bucket_id = any (array['vehiculos', 'conduces']))
      with check (bucket_id = any (array['vehiculos', 'conduces']));
  end if;

  -- inventario (política propia, `csd_inventario_*`).
  if not exists (select 1 from pg_policy where polname = 'csd_inventario_insert') then
    create policy csd_inventario_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'inventario');
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_inventario_select') then
    create policy csd_inventario_select on storage.objects
      for select to authenticated
      using (bucket_id = 'inventario');
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_inventario_update') then
    create policy csd_inventario_update on storage.objects
      for update to authenticated
      using (bucket_id = 'inventario')
      with check (bucket_id = 'inventario');
  end if;
end
$$;

commit;
