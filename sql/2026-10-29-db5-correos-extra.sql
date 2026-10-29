-- sql/2026-10-29-db5-correos-extra.sql — Ronda DB (PROMPT-124 F2, DB10/DB11)
-- Notas 6 y 7 de Xaviel: Eduardo debe recibir el «Rendimiento de combustible de la
-- flota» (hoy sus roles no están en rendimiento_vehiculos_roles) y Sócrates el
-- «Resumen semanal de operaciones» (sus roles tampoco; Hector YA entra por
-- gerencia, verificado en F0). Cambiar los ROLES metería a terceros (p. ej.
-- jefe_ingenieros también es Wagner y un usuario de prueba) — DB-05: mecanismo
-- único «personas extra» por familia: parámetro `<familia>_correos_extra` (CSV de
-- correos, pueden ser externos) sumado a los roles con dedupe por correo.
--
-- También renombra la familia (DB-06): «Rendimiento de combustible de la flota
-- (semanal, lunes 7:00 a. m.)». La familia sigue APAGADA: la enciende Xaviel en el
-- panel tras ver el «Enviar prueba ahora».
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db5-correos-extra.sql --env dev

-- ── 1) Parámetros nuevos (valores iniciales de DB-05) ─────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('resumen_operaciones_correos_extra', 'srodriguez@constructorasd.com',
   'Personas extra (CSV de correos) que reciben el Resumen semanal de operaciones, además de los roles de resumen_operaciones_roles.'),
  ('rendimiento_vehiculos_correos_extra', 'eduardong@constructorasd.com',
   'Personas extra (CSV de correos) que reciben el Rendimiento de combustible de la flota, además de los roles de rendimiento_vehiculos_roles.')
on conflict (clave) do nothing;

-- ── 2) destinatarios_resumen_operaciones: roles + personas extra, dedupe ──────
create or replace function sgc.destinatarios_resumen_operaciones()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct on (lower(t.email)) t.email, t.nombre
  from (
    select u.email, u.nombre, 0 as pri
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where coalesce(u.activo, true)
      and nullif(trim(coalesce(u.email,'')),'') is not null
      and r.codigo = any (sgc.param_csv('resumen_operaciones_roles','admin,direccion,gerencia,logistica,jefe_flota'))
      and coalesce((select 'email' = any(canales) and activo from sgc.notif_tipo where tipo='resumen_operaciones'), true)
      and sgc.notif_permitida(u.id, 'resumen_operaciones')
    union all
    -- DB11 — personas extra (correo directo, con o sin usuario en el SGC).
    select x, x, 1
    from unnest(sgc.param_csv('resumen_operaciones_correos_extra','')) x
    where x like '%@%'
  ) t
  order by lower(t.email), t.pri;
$function$;

-- ── 3) destinatarios_rendimiento_vehiculos: ídem ──────────────────────────────
create or replace function sgc.destinatarios_rendimiento_vehiculos()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct on (lower(t.email)) t.email, t.nombre
  from (
    select u.email, u.nombre, 0 as pri
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where coalesce(u.activo, true)
      and nullif(trim(coalesce(u.email,'')),'') is not null
      and r.codigo = any (sgc.param_csv('rendimiento_vehiculos_roles','direccion,jefe_flota,logistica'))
      and coalesce((select 'email' = any(canales) and activo from sgc.notif_tipo where tipo='rendimiento_vehiculos'), true)
      and sgc.notif_permitida(u.id, 'rendimiento_vehiculos')
    union all
    -- DB10 — Eduardo entra aquí (sus roles no están en la lista y cambiarla
    -- metería a más gente).
    select x, x, 1
    from unnest(sgc.param_csv('rendimiento_vehiculos_correos_extra','')) x
    where x like '%@%'
  ) t
  order by lower(t.email), t.pri;
$function$;

-- ── 4) Renombrar la familia (DB-06) — sin tocar `activo` ──────────────────────
update sgc.envios_automaticos
   set nombre = 'Rendimiento de combustible de la flota (semanal, lunes 7:00 a. m.)',
       updated_at = now()
 where familia = 'rendimiento_vehiculos';
