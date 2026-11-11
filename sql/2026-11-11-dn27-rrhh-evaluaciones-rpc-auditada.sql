-- DN-27/DN-28 (ronda DN, continuación) — sgc.rrhh_evaluaciones tenía RLS
-- directo (puede_rrhh_sensible) pero sin RPC de lectura auditada -- a
-- diferencia de Contratos, que sí registra cada lectura en
-- sgc.rrhh_accesos_log. Esta migración lo alinea: la pantalla de
-- Evaluaciones usa esta RPC, no el SELECT directo a la tabla.
begin;

create or replace function sgc.rrhh_evaluaciones_de_empleado(p_empleado_id uuid)
returns table(
  id uuid, empleado_id uuid, evaluador_id uuid, periodo text, puntaje numeric,
  comentarios text, created_at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.puede_rrhh_sensible('rrhh.evaluaciones') then
    raise exception 'No tienes permiso para ver evaluaciones de empleados.' using errcode = '42501';
  end if;
  perform sgc.rrhh_registrar_acceso('rrhh.evaluaciones', 'ver_detalle', p_empleado_id);
  return query
    select e.id, e.empleado_id, e.evaluador_id, e.periodo, e.puntaje, e.comentarios, e.created_at
    from sgc.rrhh_evaluaciones e
    where e.empleado_id = p_empleado_id
    order by e.created_at desc;
end;
$function$;
grant execute on function sgc.rrhh_evaluaciones_de_empleado(uuid) to authenticated, service_role;

create or replace function sgc.rrhh_crear_evaluacion(p_empleado_id uuid, p_periodo text, p_puntaje numeric, p_comentarios text)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones') then
    raise exception 'No tienes permiso para registrar evaluaciones.' using errcode = '42501';
  end if;
  insert into sgc.rrhh_evaluaciones (empleado_id, evaluador_id, periodo, puntaje, comentarios)
  values (p_empleado_id, auth.uid(), p_periodo, p_puntaje, p_comentarios)
  returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function sgc.rrhh_crear_evaluacion(uuid, text, numeric, text) to authenticated, service_role;

commit;
