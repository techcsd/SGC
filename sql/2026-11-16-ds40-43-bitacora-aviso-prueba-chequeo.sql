-- DS-40 (#63) aviso de bitacora sin partes · DS-41 (#64) es_prueba fuera de avisos/KPIs
-- DS-43 (#67) el chequeo semanal de almacenes ya no se calla.
-- Aditiva e idempotente. Parametros editables en sgc.parametros (sin deploy).

-- 1) Parametros (insert-if-absent: no pisa lo que un admin ya ajusto)
insert into sgc.parametros (clave, valor, descripcion) values
  ('bitacora_aviso_activo',         'true',            'DS-40/#63 - activa el aviso diario de obras en progreso sin parte diario reciente'),
  ('bitacora_dias_aviso',           '3',               'DS-40/#63 - dias sin parte diario para avisar (>=)'),
  ('bitacora_aviso_reaviso_dias',   '3',               'DS-40/#63 - cada cuantos dias se repite el aviso mientras siga sin parte'),
  ('bitacora_aviso_roles',          'jefe_ingenieros', 'DS-40/#63 - roles (CSV de codigos) que reciben el aviso ademas del ingeniero de la obra'),
  ('chequeo_semanal_fallback_activo','true',           'DS-43/#67 - si la obra no tiene guarda-almacen vinculado, asigna el chequeo al rol de respaldo'),
  ('chequeo_semanal_fallback_roles','logistica,admin', 'DS-43/#67 - roles (CSV, en orden de prioridad) que reciben el chequeo cuando no hay guarda-almacen')
on conflict (clave) do nothing;

-- 2) DS-40: aviso de obras en progreso sin parte diario (excluye pruebas)
create or replace function sgc.avisar_bitacora_sin_partes()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  r record;
  v_dias int := coalesce(nullif((select valor from sgc.parametros where clave='bitacora_dias_aviso'),'')::int, 3);
  v_re   int := coalesce(nullif((select valor from sgc.parametros where clave='bitacora_aviso_reaviso_dias'),'')::int, 3);
  v_roles text[] := sgc.param_csv('bitacora_aviso_roles', 'jefe_ingenieros');
  v_dest uuid[];
  v_n int := 0;
begin
  if coalesce((select valor from sgc.parametros where clave='bitacora_aviso_activo'), 'true') <> 'true' then
    return 0;
  end if;

  for r in
    select p.id, p.nombre, p.ingeniero_obra_id,
           greatest(0, current_date - coalesce(
             (select max(b.fecha) from sgc.bitacoras b
               where b.proyecto_id = p.id and b.tipo = 'parte_diario' and not coalesce(b.es_prueba,false)),
             p.fecha_inicio, p.created_at::date)) as dias,
           (select max(b.fecha) from sgc.bitacoras b
             where b.proyecto_id = p.id and b.tipo = 'parte_diario' and not coalesce(b.es_prueba,false)) as ultimo
      from sgc.proyectos p
     where coalesce(p.activo, true) and p.estado = 'en_progreso' and not coalesce(p.es_prueba, false)
  loop
    continue when r.dias < v_dias;
    -- no repetir dentro de la ventana de re-aviso
    continue when exists (
      select 1 from sgc.notificaciones n
       where n.referencia_tipo = 'bitacora_sin_partes' and n.referencia_id = r.id
         and n.created_at > now() - make_interval(days => v_re));

    select coalesce(array_agg(distinct q.x), '{}') into v_dest from (
      select r.ingeniero_obra_id as x where r.ingeniero_obra_id is not null
      union
      select u.id from sgc.usuarios u
        join sgc.usuarios_roles ur on ur.usuario_id = u.id
        join sgc.roles ro on ro.id = ur.rol_id
       where coalesce(u.activo, true) and ro.codigo = any(v_roles)
    ) q;
    continue when coalesce(array_length(v_dest,1),0) = 0;

    perform sgc.notificar_usuarios(v_dest, 'warning', 'Obra sin parte diario',
      format('%s lleva %s dia(s) sin parte diario%s.', r.nombre, r.dias,
             case when r.ultimo is null then ' (nunca se ha registrado uno)'
                  else ' (ultimo: ' || to_char(r.ultimo,'DD/MM/YYYY') || ')' end),
      '/bitacora', r.id, 'bitacora_sin_partes');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function sgc.avisar_bitacora_sin_partes() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'sgc-bitacora-sin-partes') then
    perform cron.schedule('sgc-bitacora-sin-partes', '45 11 * * 1-6', 'select sgc.avisar_bitacora_sin_partes();');
  end if;
end $$;

-- 3) DS-43: chequeo semanal ya no se calla (fallback + sin pruebas)
create or replace function sgc.generar_tareas_chequeo_semanal()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
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
    select c.proyecto_id, c.bodega_id, p.nombre as proyecto_nombre, b.nombre as bodega_nombre
    from sgc.cuadre_obra c
    join sgc.proyectos p on p.id = c.proyecto_id and p.activo and p.estado in ('planificacion','en_progreso','pausado')
                        and not coalesce(p.es_prueba, false)
    join sgc.bodegas b on b.id = c.bodega_id
    where c.bodega_id is not null
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
         and t.titulo like 'Chequeo semanal de almac%'
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
$$;

-- 4) DS-41: avisos y KPIs que no excluian proyectos/vehiculos de prueba
create or replace function sgc.evaluar_avisos_proyecto()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No autorizado';
  end if;

  with nuevos as (
    insert into sgc.avisos_proyecto (tipo, proyecto_id, mensaje, severidad, dedup_key)
    select 'pago_mayor_trabajo', a.proyecto_id,
           format('El proyecto %s está pagado al %s%% pero sólo trabajado al %s%%. Revisar: no se debe pagar más de lo ejecutado.',
                  a.nombre, a.porcentaje_pagado, a.avance_trabajado),
           'alta',
           'pago_mayor_trabajo:' || a.proyecto_id || ':' || current_date
      from sgc.v_proyecto_avance a
     where a.pago_excede
       and not exists (select 1 from sgc.proyectos pp where pp.id = a.proyecto_id and coalesce(pp.es_prueba,false))
    on conflict (dedup_key) do nothing
    returning 1
  )
  select count(*) into v_n from nuevos;

  if v_n > 0 then
    perform sgc.notificar_modulo('direccion', 'warning',
      'Pago mayor al avance de obra',
      format('%s proyecto(s) con %% pagado por encima del %% trabajado.', v_n),
      '/proyectos');
  end if;
  return v_n;
end;
$$;

create or replace function sgc.sweep_avisos_reporte_semanal()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_inicio date := date_trunc('week', current_date)::date;
  v_anio   int  := extract(isoyear from current_date)::int;
  v_sem    int  := extract(week from current_date)::int;
  v_dow    int  := extract(dow from current_date)::int;
  v_n      int  := 0;
begin
  if not sgc.envio_automatico_activo('avisos_reporte_semanal') then return 0; end if;

  insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, mensaje, severidad, dedup_key)
  select 'reporte_semanal', v.id, asg.conductor_id,
         format('Hoy toca el reporte semanal de %s. Aún no se ha registrado esta semana.', v.placa),
         'media',
         format('reporte_semanal_dia:%s:%s-%s', v.id, v_anio, v_sem)
    from sgc.vehiculos v
    left join lateral (
      select va.conductor_id from sgc.vehiculo_asignaciones va
       where va.vehiculo_id = v.id and va.activa
       order by va.desde desc limit 1
    ) asg on true
   where coalesce(v.activo, true) and v.estado <> 'baja'
     and not coalesce(v.es_prueba, false)
     and sgc.dia_reporte_dow(v.id) = v_dow
     and not exists (
       select 1 from sgc.checklists_vehiculo c
        join sgc.checklist_plantillas p on p.id = c.plantilla_id
       where c.vehiculo_id = v.id and p.frecuencia = 'semanal'
         and c.fecha >= v_inicio and c.fecha < v_inicio + 7
     )
     and not exists (
       select 1 from sgc.avisos_flota a
       where a.dedup_key = format('reporte_semanal_dia:%s:%s-%s', v.id, v_anio, v_sem)
     );
  get diagnostics v_n = row_count;
  perform sgc.envio_automatico_marcar_enviado('avisos_reporte_semanal');
  return v_n;
end;
$$;

-- 5) DS-41: cumplimiento semanal de flota sin vehiculos de prueba
create or replace view sgc.v_reporte_semanal_cumplimiento as
 WITH semanas AS (
         SELECT ((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date - (n.n * 7)) AS semana_inicio
           FROM generate_series(0, 11) n(n)
        ), veh AS (
         SELECT vehiculos.id,
            vehiculos.placa,
            vehiculos.responsable_id,
            vehiculos.tipo
           FROM sgc.vehiculos
          WHERE (COALESCE(vehiculos.activo, true) AND (vehiculos.estado <> 'baja'::text)
                 AND NOT COALESCE(vehiculos.es_prueba, false))
        ), asignado AS (
         SELECT DISTINCT ON (va.vehiculo_id) va.vehiculo_id,
            va.usuario_id,
            (sgc.nombre_usuario(va.usuario_id))::character varying(150) AS chofer_nombre
           FROM sgc.vehiculo_asignaciones va
          WHERE va.activa
          ORDER BY va.vehiculo_id, va.desde DESC
        )
 SELECT (EXTRACT(isoyear FROM s.semana_inicio))::integer AS anio,
    (EXTRACT(week FROM s.semana_inicio))::integer AS semana,
    s.semana_inicio,
    (s.semana_inicio + 6) AS semana_fin,
    v.id AS vehiculo_id,
    v.placa,
    COALESCE(a.chofer_nombre, (sgc.nombre_usuario(v.responsable_id))::character varying(150)) AS chofer_nombre,
    COALESCE(a.usuario_id, v.responsable_id) AS chofer_usuario_id,
    ck.id AS checklist_id,
    ck.fecha AS reporte_fecha,
    ck.resultado,
    (ck.id IS NOT NULL) AS tiene_reporte,
    (sgc.nombre_usuario(ck.reportado_por_id))::character varying(150) AS reportado_por,
    ck.reportado_por_id,
    ck.reportado_at,
    ck.km_reporte,
    COALESCE(rd.dia_dow, gd.dia_dow, 0) AS dia_reporte_dow,
    ((ck.id IS NOT NULL) AND ((EXTRACT(dow FROM ck.fecha))::integer <> COALESCE(rd.dia_dow, gd.dia_dow, 0))) AS reportado_fuera_de_dia
   FROM (((((semanas s
     CROSS JOIN veh v)
     LEFT JOIN asignado a ON ((a.vehiculo_id = v.id)))
     LEFT JOIN sgc.flota_reporte_dias rd ON ((rd.tipo_vehiculo = v.tipo)))
     LEFT JOIN sgc.flota_reporte_dias gd ON ((gd.tipo_vehiculo = '*'::text)))
     LEFT JOIN LATERAL ( SELECT c.id,
            c.fecha,
            c.resultado,
            c.creado_por AS reportado_por_id,
            COALESCE(c.capturado_en, c.created_at) AS reportado_at,
            c.kilometraje AS km_reporte
           FROM (sgc.checklists_vehiculo c
             JOIN sgc.checklist_plantillas p ON ((p.id = c.plantilla_id)))
          WHERE ((c.vehiculo_id = v.id) AND (p.frecuencia = 'semanal'::text) AND (c.fecha >= s.semana_inicio) AND (c.fecha < (s.semana_inicio + 7)))
          ORDER BY c.fecha DESC, c.created_at DESC
         LIMIT 1) ck ON (true))
  WHERE (sgc.es_flota_elevado() OR (COALESCE(a.usuario_id, v.responsable_id) = auth.uid()) OR (ck.reportado_por_id = auth.uid()));
