-- ============================================================================
-- Y13 / Y11 — Rol `tecnologia` + helper `es_tecnologia()`
-- Ronda 28/07/2026 · PROMPT-1 · FASE 3
-- ============================================================================
-- Contexto (auditoría de roles, ver ROLES.md):
--   El modelo YA es multi-rol: sgc.usuarios_roles (usuario_id, rol_id) N:N.
--   Los módulos efectivos de un usuario = unión de roles.modulos. No hay campo
--   `rol` único que convertir; no se necesita columna "rol primario".
--
-- Este script es ADITIVO e idempotente:
--   1) Crea el rol `tecnologia` (persona técnica sin ser admin). Le damos el
--      módulo `tecnologia` para que vea también las pantallas de contenido
--      técnico existentes (guía, matriz, inventario TI). El acceso a la sección
--      "Tecnología" de plataforma (versiones, reportes de errores, monitoreo)
--      NO se gatea por módulo sino por ROL (admin | tecnologia) vía
--      `es_tecnologia()`, para NO filtrarse al rol `encargado_tecnologia`
--      (que es solo de contenido/inventario TI).
--   2) Crea `sgc.es_tecnologia()` — espejo en RLS del helper de front
--      `UserService.esTecnologia` (admin O rol tecnologia). Fuente de verdad
--      para las políticas de las tablas del módulo Tecnología (p. ej.
--      app_error_reports en la FASE 5, monitoreo en PROMPT-5).
-- ============================================================================

-- 1) Rol `tecnologia` -----------------------------------------------------------
insert into sgc.roles (codigo, nombre, modulos, descripcion)
values (
  'tecnologia',
  'Tecnología',
  array['tecnologia']::text[],
  'Tecnología / plataforma: historial de versiones, versiones de la app, reportes de errores de la app y monitoreo de infraestructura, más el inventario tecnológico. Da acceso al módulo Tecnología sin ser administrador del sistema.'
)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      -- Garantiza que el rol tenga al menos el módulo 'tecnologia' sin pisar
      -- otros módulos que un admin le haya agregado manualmente.
      modulos = (
        select array(select distinct unnest(sgc.roles.modulos || excluded.modulos))
      ),
      descripcion = coalesce(sgc.roles.descripcion, excluded.descripcion);

-- 2) Helper es_tecnologia() -----------------------------------------------------
-- SECURITY DEFINER: puede leer usuarios_roles/roles saltando RLS (como is_admin
-- y es_flota_elevado). search_path fijado por seguridad.
create or replace function sgc.es_tecnologia()
returns boolean
language sql
stable
security definer
set search_path = sgc, public
as $$
  select exists (
    select 1
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo in ('admin', 'tecnologia')
  );
$$;

grant execute on function sgc.es_tecnologia() to authenticated, service_role;

comment on function sgc.es_tecnologia() is
  'True si el usuario actual es admin o tiene el rol tecnologia. Espejo RLS de UserService.esTecnologia (front). Gatea el módulo Tecnología de plataforma.';
