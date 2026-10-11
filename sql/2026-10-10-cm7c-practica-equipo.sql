-- 2026-10-10-cm7c-practica-equipo.sql — CM7 7c (reglas 18/19) — panel de resultados
--
-- Un JEFE (empleados.jefe_id), RRHH o admin puede ver cómo va su gente en el modo
-- práctica: resumen por persona (intentos, mejor/última nota, aprobadas) + detalle por
-- misión. Misma visibilidad que la RLS de practica_intentos (nada nuevo se expone).
-- Práctica = no cuenta en KPIs/incentivos/avisos: esto es solo para acompañar/entrenar.
--
--   node scripts/apply-migration.mjs sql/2026-10-10-cm7c-practica-equipo.sql --env dev

begin;

-- ¿El usuario actual puede ver el panel de equipo? (admin / RRHH / jefe de alguien)
create or replace function sgc.practica_puede_ver_equipo()
 returns boolean
 language sql
 stable security definer
 set search_path to 'sgc', 'public'
as $function$
  select sgc.is_admin() or sgc.tiene_modulo('rrhh') or exists (
    select 1 from sgc.empleados jefe
     where jefe.usuario_id = auth.uid()
       and exists (select 1 from sgc.empleados sub where sub.jefe_id = jefe.id)
  );
$function$;
grant execute on function sgc.practica_puede_ver_equipo() to authenticated, service_role;

-- Resumen por persona de las personas que el usuario actual puede ver.
create or replace function sgc.practica_resultados_equipo()
 returns table (
   usuario_id uuid, nombre text, intentos int, misiones int,
   mejor_nota numeric, ultima_nota numeric, ultima_fecha timestamptz,
   aprobadas int, promedio numeric
 )
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'public'
as $function$
begin
  if not sgc.practica_puede_ver_equipo() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return query
  with visibles as (
    select distinct i.usuario_id
      from sgc.practica_intentos i
     where sgc.is_admin() or sgc.tiene_modulo('rrhh')
        or exists (
          select 1 from sgc.empleados sub
          join sgc.empleados jefe on jefe.id = sub.jefe_id
          where sub.usuario_id = i.usuario_id and jefe.usuario_id = auth.uid())
  ),
  ult as (
    select distinct on (i.usuario_id) i.usuario_id, i.nota as ultima_nota, i.created_at as ultima_fecha
      from sgc.practica_intentos i
      join visibles v on v.usuario_id = i.usuario_id
     order by i.usuario_id, i.created_at desc
  )
  select v.usuario_id,
         coalesce(u.nombre, 'Usuario')::text as nombre,
         count(i.*)::int as intentos,
         count(distinct i.mision_id)::int as misiones,
         max(i.nota) as mejor_nota,
         ul.ultima_nota,
         ul.ultima_fecha,
         count(*) filter (where i.aprobada)::int as aprobadas,
         round(avg(i.nota), 1) as promedio
    from visibles v
    join sgc.practica_intentos i on i.usuario_id = v.usuario_id
    left join sgc.usuarios u on u.id = v.usuario_id
    left join ult ul on ul.usuario_id = v.usuario_id
   group by v.usuario_id, u.nombre, ul.ultima_nota, ul.ultima_fecha
   order by ul.ultima_fecha desc nulls last;
end;
$function$;
grant execute on function sgc.practica_resultados_equipo() to authenticated, service_role;

-- Detalle por misión de UNA persona (solo si el que pregunta puede verla).
create or replace function sgc.practica_resultados_persona(p_usuario_id uuid)
 returns table (
   mision_id text, titulo text, intentos int,
   mejor_nota numeric, ultima_nota numeric, ultima_fecha timestamptz, aprobada boolean
 )
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'public'
as $function$
begin
  if not (
    p_usuario_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('rrhh')
    or exists (
      select 1 from sgc.empleados sub
      join sgc.empleados jefe on jefe.id = sub.jefe_id
      where sub.usuario_id = p_usuario_id and jefe.usuario_id = auth.uid())
  ) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return query
  with ult as (
    select distinct on (i.mision_id) i.mision_id, i.nota as ultima_nota, i.created_at as ultima_fecha, i.aprobada
      from sgc.practica_intentos i
     where i.usuario_id = p_usuario_id
     order by i.mision_id, i.created_at desc
  )
  select i.mision_id,
         coalesce(m.titulo, i.mision_id)::text as titulo,
         count(*)::int as intentos,
         max(i.nota) as mejor_nota,
         ul.ultima_nota, ul.ultima_fecha, ul.aprobada
    from sgc.practica_intentos i
    left join sgc.practica_misiones m on m.id = i.mision_id
    left join ult ul on ul.mision_id = i.mision_id
   where i.usuario_id = p_usuario_id
   group by i.mision_id, m.titulo, ul.ultima_nota, ul.ultima_fecha, ul.aprobada
   order by ul.ultima_fecha desc nulls last;
end;
$function$;
grant execute on function sgc.practica_resultados_persona(uuid) to authenticated, service_role;

commit;
