-- ════════════════════════════════════════════════════════════════════════════
-- BZ3 — Login de dev con ayuda: panel "usuarios de prueba" alimentado por un RPC
-- que SOLO devuelve datos en dev. Nota #79 (no podía entrar a dev.…/auth).
-- ════════════════════════════════════════════════════════════════════════════
-- Causa (de diseño): el seed anonimiza TODOS los emails y usa una sola contraseña QA;
-- la cuenta real de Tecnología no existía en Auth de dev, y nada lo decía en el login.
-- Fix (parte servidor): (1) el seed conserva el email real para admin/tecnologia/
-- desarrollador (+ lista) — ver scripts/seed-dev.*; (2) este RPC lista las cuentas QA
-- por rol para el panel del login. Gate por config_entorno.entorno='dev': en prod
-- devuelve vacío y el panel no se pinta. La CONTRASEÑA nunca sale del servidor (el panel
-- solo muestra el email; la QA se escribe a mano).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-25-bz3-login-dev.sql --env dev  →  --env prod --yes
-- Rollback: drop function sgc.usuarios_qa_dev();
begin;

-- Cuentas QA por rol para el panel del login de dev. Solo emails (sin contraseña).
-- anon puede ejecutarlo (el login es pre-auth); en prod el gate lo deja vacío.
create or replace function sgc.usuarios_qa_dev()
returns table (email text, nombre text, rol text)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select u.email, u.nombre,
         coalesce(string_agg(distinct r.nombre, ', ' order by r.nombre), '—') as rol
    from sgc.usuarios u
    left join sgc.usuarios_roles ur on ur.usuario_id = u.id
    left join sgc.roles r on r.id = ur.rol_id
   where (select valor from sgc.config_entorno where clave = 'entorno') = 'dev'  -- solo dev
     and coalesce(u.activo, true)
     and u.email is not null
     and (u.email ilike 'qa\_%' escape '\' or coalesce(u.es_prueba, false))
   group by u.email, u.nombre
   order by u.nombre;
$$;
grant execute on function sgc.usuarios_qa_dev() to anon, authenticated, service_role;
comment on function sgc.usuarios_qa_dev() is
  'BZ3 — cuentas QA por rol para el panel "usuarios de prueba" del login de dev. Solo '
  'devuelve datos cuando config_entorno.entorno = ''dev'' (en prod, vacío). No expone '
  'contraseñas (la QA se escribe a mano).';

commit;
