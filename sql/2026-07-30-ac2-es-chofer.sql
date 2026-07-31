-- ============================================================================
-- AC2 — Persona "chofer": helper server-side (fuente de verdad) (30/07/2026)
-- ----------------------------------------------------------------------------
-- El módulo "Tecnología" es público para todos EXCEPTO la persona "chofer"
-- (rol `chofer_transportista`, experiencia reducida por cédula + PIN). Este
-- helper es la fuente de verdad que replican el guard/menú de la web y la app
-- móvil (PROMPT-14). Espeja a `es_flota_elevado()` / `es_tecnologia()`.
--
-- Nota: las secciones sensibles de Tecnología (versiones de app, reportes de
-- errores, monitoreo) ya están gateadas por `es_tecnologia()` en su RLS, así que
-- un chofer nunca podía leer esos datos; esto cierra la parte pública/menú.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.es_chofer()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo = 'chofer_transportista'
  );
$$;

comment on function sgc.es_chofer() is
  'AC2 — true si el usuario actual es la persona "chofer" (rol chofer_transportista). Usado para ocultar el módulo Tecnología (web + app).';

grant execute on function sgc.es_chofer() to authenticated, service_role;
