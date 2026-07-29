-- ============================================================================
-- Z26 — Submódulos restringidos de Tecnología visibles también a gerencia/dirección
-- PROMPT-6 · FASE 8
-- ============================================================================
-- Decisión: el módulo Tecnología lo ven todos; los submódulos "Versiones de App",
-- "Reportes de errores" y "Monitoreo" se restringen a: admin, tecnologia,
-- gerencia, direccion (Dirección General). es_tecnologia() es el gate único
-- (RLS de app_error_reports/monitoreo + marcar_version + guard de rutas).
-- ============================================================================
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
      and r.codigo in ('admin', 'tecnologia', 'gerencia', 'direccion')
  );
$$;
