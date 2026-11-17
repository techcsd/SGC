-- 2026-11-17 -- #67: el cron chequeo-semanal-almacenes "succeeded" cada lunes pero NO generaba nada: recorria sgc.cuadre_obra, que esta vacia
-- (0 filas), asi que ninguna obra recibia su tarea. Ahora recorre las bodegas de las obras activas (bodegas.proyecto_id), salta las ya contadas
-- esta semana (conteo aplicado) y deduplica por almacen. Misma firma; el resto (guarda-almacen, respaldo DS-43) no cambia.
CREATE OR REPLACE FUNCTION sgc.generar_tareas_chequeo_semanal()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  r record;
  v_uid uuid;
  v_motivo text;
  v_count int := 0;
  v_fb_activo boolean := coalesce((select valor from sgc.parametros where clave='chequeo_semanal_fallback_activo'), 'true') = 'true';
  v_fb_roles text[] := sgc.param_csv('chequeo_semanal_fallback_roles', 'logistica,admin');
  v_fb uuid;
begin
  -- respaldo: primer usuario activo segun el orden de prioridad de los roles
  select u.id into v_fb
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles ro on ro.id = ur.rol_id
   where coalesce(u.activo, true) and ro.codigo = any(v_fb_roles)
   order by array_position(v_fb_roles, ro.codigo), u.created_at
   limit 1;

  for r in
    select b.proyecto_id, b.id as bodega_id, p.nombre as proyecto_nombre, b.nombre as bodega_nombre
    from sgc.bodegas b
    join sgc.proyectos p on p.id = b.proyecto_id and p.activo and p.estado in ('planificacion','en_progreso','pausado')
                        and not coalesce(p.es_prueba, false)
    where coalesce(b.activo, true)
      -- Ya contada esta semana (conteo fisico o chequeo aplicado): no se pide otro.
      and not exists (select 1 from sgc.conteos_inventario ci
                       where ci.bodega_id = b.id and ci.estado = 'aplicado' and ci.aplicado_at > now() - interval '6 days')
  loop
    v_motivo := null;
    -- Guarda-Almacen del proyecto -> usuario
    select e.usuario_id into v_uid
      from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
     where pe.proyecto_id = r.proyecto_id and pe.rol = 'guarda_almacen'
       and e.usuario_id is not null
     limit 1;

    if v_uid is null then
      -- DS-43: antes aqui se hacia "continue" en silencio
      if not v_fb_activo or v_fb is null then continue; end if;
      v_uid := v_fb;
      v_motivo := 'Se te asignó porque esta obra no tiene guarda-almacén vinculado a un usuario. ';
    end if;

    if exists (
      select 1 from sgc.tareas t
       where t.proyecto_id = r.proyecto_id and t.asignado_a = v_uid
         and t.titulo = 'Chequeo semanal de almacén — ' || r.bodega_nombre
         and t.estado in ('pendiente','en_progreso')
         and t.created_at > now() - interval '6 days'
    ) then continue; end if;

    insert into sgc.tareas (titulo, descripcion, estado, prioridad, asignado_a, asignado_por, proyecto_id, fecha_limite)
    values (
      'Chequeo semanal de almacén — ' || r.bodega_nombre,
      coalesce(v_motivo, '') || 'Conteo físico vs sistema del almacén de obra. Registra las diferencias en Inventario → Conteos → Nuevo chequeo semanal.',
      'pendiente', 'media', v_uid, v_uid, r.proyecto_id, (current_date + 2)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
