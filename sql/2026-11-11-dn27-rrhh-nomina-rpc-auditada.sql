-- DN-27/DN-28 (ronda DN, continuación) — RPCs auditadas para Nómina
-- (parámetros + períodos), mismo patrón que Contratos/Evaluaciones: toda
-- lectura/escritura sensible pasa por una función security definer que
-- registra en sgc.rrhh_accesos_log, no por SELECT directo a la tabla.
-- Sigue SIN motor de cálculo -- eso espera la validación del contador.
begin;

create or replace function sgc.rrhh_nomina_parametros_listar()
returns setof sgc.rrhh_nomina_parametros
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.puede_rrhh_sensible('rrhh.nomina') then
    raise exception 'No tienes permiso para ver los parámetros de nómina.' using errcode = '42501';
  end if;
  perform sgc.rrhh_registrar_acceso('rrhh.nomina', 'ver_lista');
  return query select * from sgc.rrhh_nomina_parametros order by clave;
end;
$function$;
grant execute on function sgc.rrhh_nomina_parametros_listar() to authenticated, service_role;

create or replace function sgc.rrhh_nomina_parametro_actualizar(p_clave text, p_valor numeric, p_validado_por_contador boolean)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.puede_operar_rrhh_sensible('rrhh.nomina') then
    raise exception 'No tienes permiso para editar los parámetros de nómina.' using errcode = '42501';
  end if;
  update sgc.rrhh_nomina_parametros
     set valor = p_valor, validado_por_contador = p_validado_por_contador, updated_at = now()
   where clave = p_clave;
end;
$function$;
grant execute on function sgc.rrhh_nomina_parametro_actualizar(text, numeric, boolean) to authenticated, service_role;

create or replace function sgc.rrhh_nomina_periodos_listar()
returns setof sgc.rrhh_nomina_periodos
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.puede_rrhh_sensible('rrhh.nomina') then
    raise exception 'No tienes permiso para ver los períodos de nómina.' using errcode = '42501';
  end if;
  perform sgc.rrhh_registrar_acceso('rrhh.nomina', 'ver_lista');
  return query select * from sgc.rrhh_nomina_periodos order by fecha_desde desc;
end;
$function$;
grant execute on function sgc.rrhh_nomina_periodos_listar() to authenticated, service_role;

create or replace function sgc.rrhh_nomina_periodo_crear(p_nombre text, p_fecha_desde date, p_fecha_hasta date)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not sgc.puede_operar_rrhh_sensible('rrhh.nomina') then
    raise exception 'No tienes permiso para crear períodos de nómina.' using errcode = '42501';
  end if;
  insert into sgc.rrhh_nomina_periodos (nombre, fecha_desde, fecha_hasta, creado_por)
  values (p_nombre, p_fecha_desde, p_fecha_hasta, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function sgc.rrhh_nomina_periodo_crear(text, date, date) to authenticated, service_role;

commit;
