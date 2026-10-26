-- CY21 punto 3 -- capacidades_asistente() deriva la lista de modulos de
-- sgc.roles en vez de una lista fija de 14 (le faltaban transporte, obra,
-- ingenieria, plataforma, reuniones). Union de todos los modulos usados en
-- CUALQUIER rol (unnest(modulos) distinct) -- por la convencion de la casa
-- (regla "nuevo modulo -> array_append al rol admin"), eso siempre coincide
-- con MODULOS_DISPONIBLES del frontend sin tener que duplicar la lista aqui.
begin;

create or replace function sgc.capacidades_asistente()
returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_nombre text;
  v_admin  boolean;
  v_mods   text[] := '{}';
  v_roles  text[] := '{}';
  v_todos  text[];
  m        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select nombre into v_nombre from sgc.usuarios where id = v_uid;
  v_admin := sgc.is_admin();

  select coalesce(array_agg(distinct modulo order by modulo), '{}')
    into v_todos
    from sgc.roles, unnest(modulos) as modulo;

  foreach m in array v_todos loop
    if v_admin or sgc.tiene_modulo(m) then v_mods := v_mods || m; end if;
  end loop;

  -- Nombres de rol del usuario (para el tratamiento por rol de Compa).
  select coalesce(array_agg(r.nombre order by r.nombre), '{}')
    into v_roles
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
   where ur.usuario_id = v_uid;

  return jsonb_build_object(
    'usuario_id', v_uid,
    'nombre', coalesce(v_nombre, 'Usuario'),
    'es_admin', v_admin,
    'modulos', to_jsonb(v_mods),
    'roles', to_jsonb(v_roles),
    'puede_ver_todas_requisiciones', sgc.puede_ver_todas_requisiciones()
  );
end;
$function$;

commit;
