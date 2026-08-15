-- =============================================================================
-- AR1c — Fotos de personal de obra: storage OBRA-SCOPED + política UPDATE (app)
--
-- Hueco de contrato de AR1 detectado al cablear la app (registro EN OBRA por
-- hojas). Las políticas del bucket `personal-obra` eran SOLO por módulo
-- (admin/proyectos/rrhh/direccion/submódulo), NO obra-scoped. Consecuencia:
--
--  (a) Un ingeniero/CAPATAZ (vinculado a su obra por responsable_id /
--      proyecto_responsables / proyecto_empleados, PERO sin el módulo ni el
--      permiso 'proyectos.personal') podía crear el `personal_obra` y sus filas
--      de fotos (la RLS de esas tablas SÍ es obra-scoped), pero NO podía SUBIR
--      los archivos al bucket → el registro en obra (el caso de uso real) moría
--      en la subida de la primera foto.
--
--  (b) Faltaba la política UPDATE del bucket → los re-envíos por outbox con
--      `upsert:true` fallaban RLS al reintentar una op parcial
--      (espeja [[storage-upsert-needs-update-policy]]).
--
-- Fix (aditivo, retrocompatible): alinear las políticas de storage con los
-- helpers obra-scoped `puede_ver_/gestionar_personal_obra`, leyendo el
-- proyecto_id del PATH del objeto (`{proyecto_id}/{personal_id}/{tipo}.jpg` →
-- folder[1]). Se CONSERVA el acceso de los roles elevados (van primero en el OR,
-- así el cast del path ni se evalúa para ellos). La web (usuarios elevados, mismo
-- path) no se afecta y además gana la política UPDATE que su upsert necesitaba.
--
-- ⚠️ SGC (repo padre): trasladar esta migración a SGC/sql y dejarla junto a
--    2026-08-14-ar1-registro-personal-obra.sql (Hard Rule #5 — coordinar).
-- =============================================================================

begin;

-- SELECT: elevados O quien puede VER el personal de la obra del path.
drop policy if exists "personal-obra: leer" on storage.objects;
create policy "personal-obra: leer" on storage.objects for select to authenticated
  using (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_ver_submodulo('proyectos.personal')
    or sgc.puede_ver_personal_obra(nullif((storage.foldername(name))[1], '')::uuid)));

-- INSERT: elevados O quien puede GESTIONAR el personal de la obra del path.
drop policy if exists "personal-obra: subir" on storage.objects;
create policy "personal-obra: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_operar_submodulo('proyectos.personal')
    or sgc.puede_gestionar_personal_obra(nullif((storage.foldername(name))[1], '')::uuid)));

-- UPDATE (NUEVA): upsert:true del outbox necesita INSERT + UPDATE.
drop policy if exists "personal-obra: actualizar" on storage.objects;
create policy "personal-obra: actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_operar_submodulo('proyectos.personal')
    or sgc.puede_gestionar_personal_obra(nullif((storage.foldername(name))[1], '')::uuid)))
  with check (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_operar_submodulo('proyectos.personal')
    or sgc.puede_gestionar_personal_obra(nullif((storage.foldername(name))[1], '')::uuid)));

-- DELETE: elevados O quien puede GESTIONAR el personal de la obra del path.
drop policy if exists "personal-obra: borrar" on storage.objects;
create policy "personal-obra: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_operar_submodulo('proyectos.personal')
    or sgc.puede_gestionar_personal_obra(nullif((storage.foldername(name))[1], '')::uuid)));

commit;
