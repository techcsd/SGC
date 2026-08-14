-- AQ8 — Bitácora: "Mis bitácoras" (solo del usuario) + "Todas las bitácoras" por rol/obra
--
-- Regla:
--   • "Mis bitácoras" = SOLO las creadas por el usuario (se resuelve en el cliente
--     filtrando por usuario_id; la RLS ya permite ver las propias).
--   • "Todas las bitácoras" = gating server-side en 2 niveles:
--       – roles elevados (admin o módulo 'proyectos') ven TODAS;
--       – un ingeniero responsable de una obra ve TODAS las de ESA(S) obra(s)
--         aunque no tenga el módulo 'proyectos'.
--
-- Antes, la RLS solo daba "ver todas" a admin/módulo-proyectos; un ingeniero
-- responsable sin ese módulo solo veía las suyas. Se añade el OR por responsable.
-- Aditivo/retrocompatible.

-- ── 1) Helper: ¿es el usuario responsable de esta obra? ───────────────────────
-- Responsable = responsable_id del proyecto O una fila activa en proyecto_responsables.
create or replace function sgc.es_responsable_de_proyecto(
  p_proyecto_id uuid, p_usuario uuid default auth.uid()
) returns boolean
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $$
  select p_proyecto_id is not null and p_usuario is not null and (
    exists (select 1 from sgc.proyectos p
            where p.id = p_proyecto_id and p.responsable_id = p_usuario)
    or exists (select 1 from sgc.proyecto_responsables prr
               where prr.proyecto_id = p_proyecto_id and prr.usuario_id = p_usuario
                 and coalesce(prr.activo, true))
  );
$$;
grant execute on function sgc.es_responsable_de_proyecto(uuid, uuid) to authenticated, service_role;

-- ── 2) Helper: ¿puede ver bitácoras más allá de las suyas? (gating "Todas") ───
create or replace function sgc.puede_ver_otras_bitacoras()
returns boolean
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos')
      or exists (select 1 from sgc.proyectos p where p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_responsables prr
                 where prr.usuario_id = auth.uid() and coalesce(prr.activo, true));
$$;
grant execute on function sgc.puede_ver_otras_bitacoras() to authenticated, service_role;

-- ── 3) RLS: el responsable de la obra ve las bitácoras de ESA obra ────────────
drop policy if exists "bitacoras: select" on sgc.bitacoras;
create policy "bitacoras: select" on sgc.bitacoras for select to authenticated
  using (
    usuario_id = auth.uid()
    or sgc.is_admin()
    or sgc.tiene_modulo('proyectos')
    or sgc.es_responsable_de_proyecto(proyecto_id)
  );

-- ── 4) Espejo en el helper de tablas hijas (actividades/restricciones/…) ──────
create or replace function sgc.puede_ver_bitacora(p_bitacora_id uuid)
returns boolean
language sql stable
set search_path to 'sgc','pg_temp'
as $$
  select exists (
    select 1 from sgc.bitacoras b
    where b.id = p_bitacora_id
      and (b.usuario_id = auth.uid()
           or sgc.is_admin()
           or sgc.tiene_modulo('proyectos')
           or sgc.es_responsable_de_proyecto(b.proyecto_id))
  );
$$;
