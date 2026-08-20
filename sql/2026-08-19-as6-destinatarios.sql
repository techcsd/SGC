-- ============================================================================
-- AS6 — Correo enriquecido de requisición (resumen + deep-link + PDF adjunto)
-- Destinatarios: NO broadcast. Espeja la lógica de sgc.puede_ver_todas_requisiciones()
--   → módulo inventario (admin, gerencia, dirección, coord_compras, guarda_almacen,
--     logística — todos lo traen) UNION roles de proyecto (gerente_produccion,
--     gerente_proyectos, jefe_ingenieros).
-- Se usa SOLO desde la Edge Function notificar-solicitud con la service_role key
--   (bypassa RLS/grants). Igual que usuarios_con_modulo, NO se otorga a
--   `authenticated`: una sesión normal no puede enumerar correos del personal.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.usuarios_destinatarios_requisicion()
returns table(email text, nombre text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  -- Módulo inventario (incluye admin vía 'admin' = any(modulos)) + logística.
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo
    and u.email is not null
    and ('inventario' = any(r.modulos) or 'admin' = any(r.modulos))
  union
  -- Roles de proyecto que gestionan requisiciones (bandeja global).
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo
    and u.email is not null
    and r.codigo in ('gerente_produccion', 'gerente_proyectos', 'jefe_ingenieros');
$$;

-- NO grant a authenticated (a propósito): solo la Edge Function (service_role).
revoke all on function sgc.usuarios_destinatarios_requisicion() from public;
