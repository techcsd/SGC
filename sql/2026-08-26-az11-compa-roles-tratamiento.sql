-- AZ11 — Compa con tratamiento por rol (Ing./maestro/usted).
-- El asistente ya recibe nombre + es_admin + módulos; le agregamos los NOMBRES de rol
-- del usuario para poder aplicar el trato del sector construcción ("Ing. <nombre>", usted
-- con roles senior, etc.). Aditivo y retrocompatible: solo añade la clave 'roles'.

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
  m        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select nombre into v_nombre from sgc.usuarios where id = v_uid;
  v_admin := sgc.is_admin();
  foreach m in array array['inventario','compras','rrhh','proyectos','flota',
                           'bitacora','documentos','plantillas','legal','tareas',
                           'tecnologia','direccion','incentivos','admin'] loop
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
