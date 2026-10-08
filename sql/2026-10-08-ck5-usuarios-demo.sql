-- 2026-10-08-ck5-usuarios-demo.sql  (SOLO DEV)
-- CK5 — helper es_usuario_demo() = rol `revisor_tiendas` O flag `tutorial_demo` en
-- usuarios.preferencias. Para grabar los videos de "cómo hacer" con usuarios que SOLO
-- ven la OBRA DEMO. La restricción de datos la dan las 51 policies `revisor_solo_demo`
-- (todas: `(NOT es_revisor_tiendas()) OR es_prueba`): a los usuarios demo se les da el
-- ROL `revisor_tiendas` (+ un rol funcional para navegar), así quedan restringidos sin
-- tocar ninguna policy. Este helper lo usa el candado de privacidad del grabador y queda
-- disponible por si luego se prefiere el flag. NUNCA a prod (el flag no existe en prod).
--   node scripts/apply-migration.mjs sql/2026-10-08-ck5-usuarios-demo.sql --env dev

begin;

create or replace function sgc.es_usuario_demo(p_uid uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = p_uid and r.codigo = 'revisor_tiendas'
  ) or coalesce(
    (select (u.preferencias->>'tutorial_demo')::boolean from sgc.usuarios u where u.id = p_uid),
    false);
$function$;
grant execute on function sgc.es_usuario_demo(uuid) to authenticated, service_role;

commit;
