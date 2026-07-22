-- ============================================================================
-- Actualización 4 · T19 (app) — Incidente de equipo:
--   a) sgc.equipos_de_obra(p_proyecto_id) — lista de equipos ya vistos en la
--      obra (bitacora_equipos_alquilados + incidente_equipo_nombre + valores
--      "Otro" de otros_valores), para un selector que evite nombres
--      inconsistentes. SECURITY DEFINER: el chofer no puede leer otros_valores
--      directamente (RLS admin/tec/dir), pero sí necesita las sugerencias.
--   b) columna incidente_equipo_operativo_comentario + param nuevo en los dos
--      RPCs de bitácora (app: crear_bitacora_app, web: crear_entrada_bitacora)
--      para el comentario de operatividad (obligatorio si quedó fuera de
--      servicio — se valida en la app; la BD lo acepta opcional).
--
-- Aditivo / idempotente / retrocompatible. Se DROPEA la firma exacta previa de
-- cada RPC antes de recrearla para NO dejar overloads (evita "could not choose a
-- candidate function" en PostgREST). El nuevo parámetro va al final con DEFAULT →
-- las llamadas por nombre existentes (app/web vigentes) siguen válidas.
-- DB compartida con SGC: espejado en ambos repos (app + SGC).
-- ============================================================================
set search_path = sgc, public;

-- ── a) Columna del comentario de operatividad ───────────────────────────────
alter table sgc.bitacoras
  add column if not exists incidente_equipo_operativo_comentario text;
comment on column sgc.bitacoras.incidente_equipo_operativo_comentario is
  'Comentario al responder si el equipo queda operativo (obligatorio si NO, en la app).';

-- ── b) equipos_de_obra: sugerencias de equipos ya vistos en la obra ──────────
create or replace function sgc.equipos_de_obra(p_proyecto_id uuid)
returns table(nombre text, veces bigint)
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $function$
  with fuente as (
    -- equipos alquilados registrados en partes de esta obra
    select bea.equipo as nombre
    from sgc.bitacora_equipos_alquilados bea
    join sgc.bitacoras b on b.id = bea.bitacora_id
    where b.proyecto_id = p_proyecto_id
    union all
    -- equipos citados en incidentes de equipo de esta obra
    select b.incidente_equipo_nombre
    from sgc.bitacoras b
    where b.proyecto_id = p_proyecto_id
      and b.incidente_equipo_nombre is not null
    union all
    -- valores "Otro" de equipos alquilados originados en partes de esta obra
    select ov.valor
    from sgc.otros_valores ov
    join sgc.bitacoras b on b.id = ov.referencia_id
    where ov.contexto = 'bitacora_equipo_alquilado'
      and b.proyecto_id = p_proyecto_id
  ),
  norm as (
    select trim(nombre) as nombre,
           lower(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as clave
    from fuente
    where coalesce(trim(nombre), '') <> ''
  )
  select (array_agg(nombre order by nombre))[1] as nombre, count(*) as veces
  from norm
  group by clave
  order by veces desc, nombre asc;
$function$;
grant execute on function sgc.equipos_de_obra(uuid) to authenticated, service_role;

-- ── c) APP: crear_bitacora_app + p_incidente_equipo_operativo_comentario ─────
drop function if exists sgc.crear_bitacora_app(
  uuid,uuid,date,text,text,smallint,smallint,smallint,text,jsonb,jsonb,text,text,
  smallint,text,text,jsonb,timestamp with time zone,boolean,text,boolean,jsonb,
  boolean,jsonb,text,text,time without time zone,text,text,text,text,text,
  text,boolean,boolean,text);

create or replace function sgc.crear_bitacora_app(
  p_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text,
  p_comentarios text default null,
  p_personal_carpinteria smallint default 0, p_personal_acero smallint default 0,
  p_trabajadores_casa smallint default 0, p_otro_personal text default null,
  p_actividades jsonb default '[]'::jsonb, p_restricciones jsonb default '[]'::jsonb,
  p_incidente_tipo text default null, p_incidente_gravedad text default null,
  p_incidente_lesionados smallint default 0, p_incidente_descripcion text default null,
  p_incidente_acciones text default null,
  p_fotos jsonb default '[]'::jsonb, p_capturado_en timestamptz default now(),
  p_llovio boolean default null, p_lluvia_detalle text default null,
  p_hubo_migracion boolean default null, p_migracion_obreros jsonb default null,
  p_hubo_equipos boolean default null, p_equipos_alquilados jsonb default '[]'::jsonb,
  p_bloque_entrepiso text default null, p_ingeniero_responsable text default null,
  p_hora_fin_trabajo time without time zone default null, p_incidente_subcontratista text default null,
  p_visita_tipo_visitante text default null, p_visita_nombre text default null,
  p_visita_organizacion text default null, p_visita_motivo text default null,
  p_incidente_equipo_nombre text default null,
  p_incidente_equipo_alquilado boolean default null,
  p_incidente_equipo_operativo boolean default null,
  p_incidente_suceso text default null,
  -- Nuevo (Act.4 · T19):
  p_incidente_equipo_operativo_comentario text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  c_min_fotos_parte     constant int := 2;
  c_min_fotos_incidente constant int := 1;
  v_uid    uuid := auth.uid();
  v_nfotos int  := jsonb_array_length(coalesce(p_fotos,'[]'::jsonb));
  v_obra   text;
  v_eq     jsonb;
  v_equipo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;

  if exists (select 1 from sgc.bitacoras where id = p_id) then
    return p_id;
  end if;

  if p_tipo = 'parte_diario' and v_nfotos < c_min_fotos_parte then
    raise exception 'Agrega al menos % fotos del trabajo realizado', c_min_fotos_parte;
  end if;
  if p_tipo = 'incidente' and v_nfotos < c_min_fotos_incidente then
    raise exception 'Agrega al menos % foto del incidente', c_min_fotos_incidente;
  end if;

  insert into sgc.bitacoras (
    id, usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista, incidente_lesionados,
    incidente_descripcion, incidente_acciones,
    incidente_equipo_nombre, incidente_equipo_alquilado, incidente_equipo_operativo,
    incidente_equipo_operativo_comentario,
    incidente_suceso,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros,
    hubo_equipos_alquilados
  ) values (
    p_id, v_uid, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    nullif(trim(p_bloque_entrepiso),''), nullif(trim(p_ingeniero_responsable),''), p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0),
    coalesce(p_trabajadores_casa, 0), p_otro_personal,
    nullif(trim(p_visita_tipo_visitante),''), nullif(trim(p_visita_nombre),''),
    nullif(trim(p_visita_organizacion),''), nullif(trim(p_visita_motivo),''),
    p_incidente_tipo, p_incidente_gravedad, nullif(trim(p_incidente_subcontratista),''),
    coalesce(p_incidente_lesionados, 0),
    p_incidente_descripcion, p_incidente_acciones,
    nullif(trim(p_incidente_equipo_nombre),''), p_incidente_equipo_alquilado, p_incidente_equipo_operativo,
    nullif(trim(p_incidente_equipo_operativo_comentario),''),
    nullif(trim(p_incidente_suceso),''),
    p_llovio, p_lluvia_detalle, p_hubo_migracion, p_migracion_obreros,
    p_hubo_equipos
  );

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(coalesce(p_actividades, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad, unidad, bloque)
      select p_id, i->>'estructura', i->>'actividad',
             nullif(i->>'cantidad','')::numeric, nullif(i->>'unidad',''), nullif(trim(i->>'bloque'),'')
      from jsonb_array_elements(p_actividades) as i;

      insert into sgc.bitacora_catalogo_usos (proyecto_id, tipo, valor, usos, ultimo_uso)
      select p_proyecto_id, 'estructura', s.v, s.cnt, now() from (
        select trim(i->>'estructura') v, count(*) cnt
        from jsonb_array_elements(p_actividades) i
        where coalesce(trim(i->>'estructura'),'') <> '' group by trim(i->>'estructura')
      ) s
      on conflict (proyecto_id, tipo, valor)
      do update set usos = sgc.bitacora_catalogo_usos.usos + excluded.usos, ultimo_uso = now();

      insert into sgc.bitacora_catalogo_usos (proyecto_id, tipo, valor, usos, ultimo_uso)
      select p_proyecto_id, 'actividad', s.v, s.cnt, now() from (
        select trim(i->>'actividad') v, count(*) cnt
        from jsonb_array_elements(p_actividades) i
        where coalesce(trim(i->>'actividad'),'') <> '' group by trim(i->>'actividad')
      ) s
      on conflict (proyecto_id, tipo, valor)
      do update set usos = sgc.bitacora_catalogo_usos.usos + excluded.usos, ultimo_uso = now();
    end if;

    if jsonb_array_length(coalesce(p_restricciones, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro)
      select p_id, i->>'tipo_restriccion', i->>'descripcion_otro'
      from jsonb_array_elements(p_restricciones) as i;
    end if;
  end if;

  if v_nfotos > 0 then
    insert into sgc.bitacora_archivos (bitacora_id, nombre, url, tipo_mime)
    select p_id, coalesce(i->>'nombre', 'foto.jpg'), i->>'path', coalesce(i->>'tipo_mime', 'image/jpeg')
    from jsonb_array_elements(p_fotos) as i;
  end if;

  if p_tipo = 'incidente' and coalesce(trim(p_incidente_suceso),'') <> '' then
    if not exists (
      select 1 from sgc.bitacora_catalogos c
      where c.tipo in ('suceso_incidente','suceso_accidente','suceso_equipo')
        and upper(c.valor) = upper(trim(p_incidente_suceso))
    ) then
      begin perform sgc.registrar_otro_valor('bitacora_suceso', trim(p_incidente_suceso), p_id);
      exception when others then null; end;
    end if;
  end if;

  if coalesce(p_hubo_equipos, false) and p_equipos_alquilados is not null
     and jsonb_array_length(p_equipos_alquilados) > 0 then
    select nombre into v_obra from sgc.proyectos where id = p_proyecto_id;
    for v_eq in select * from jsonb_array_elements(p_equipos_alquilados) loop
      v_equipo := trim(v_eq->>'equipo');
      if coalesce(v_equipo, '') <> '' then
        insert into sgc.bitacora_equipos_alquilados
          (bitacora_id, equipo, uso, proveedor, para_retirar, danado, dano_detalle)
        values (p_id, v_equipo, nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''),
                coalesce((v_eq->>'para_retirar')::boolean, false),
                coalesce((v_eq->>'danado')::boolean, false),
                nullif(trim(v_eq->>'dano_detalle'),''));
        begin perform sgc.registrar_otro_valor('bitacora_equipo_alquilado', v_equipo, p_id);
        exception when others then null; end;

        if coalesce((v_eq->>'para_retirar')::boolean, false) then
          perform sgc.notificar_rol('chofer_transportista', 'flota',
            'Retirar ' || v_equipo,
            'Retirar ' || v_equipo || ' de ' || coalesce(v_obra, 'la obra'),
            '/bitacora/historial?item=' || p_id::text);
          perform sgc.notificar_flota_elevado('flota',
            'Equipo para retirar',
            v_equipo || ' — ' || coalesce(v_obra, 'obra'),
            '/bitacora/historial?item=' || p_id::text);
        end if;
        if coalesce((v_eq->>'danado')::boolean, false) then
          perform sgc.notificar_flota_elevado('alerta',
            'Equipo dañado',
            v_equipo || coalesce(': ' || nullif(trim(v_eq->>'dano_detalle'),''), '') || ' — ' || coalesce(v_obra, 'obra'),
            '/bitacora/historial?item=' || p_id::text);
        end if;
      end if;
    end loop;
  end if;

  return p_id;
end;
$function$;

grant execute on function sgc.crear_bitacora_app(
  uuid,uuid,date,text,text,smallint,smallint,smallint,text,jsonb,jsonb,text,text,
  smallint,text,text,jsonb,timestamp with time zone,boolean,text,boolean,jsonb,
  boolean,jsonb,text,text,time without time zone,text,text,text,text,text,
  text,boolean,boolean,text,text) to authenticated, service_role;


-- ── d) WEB: crear_entrada_bitacora + p_incidente_equipo_operativo_comentario ─
drop function if exists sgc.crear_entrada_bitacora(
  uuid,uuid,date,text,text,text,text,time without time zone,smallint,smallint,smallint,text,
  jsonb,jsonb,text,text,text,text,text,text,text,smallint,text,text,uuid,
  boolean,text,boolean,jsonb,boolean,jsonb,
  text,boolean,boolean,text);

create or replace function sgc.crear_entrada_bitacora(
  p_usuario_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text, p_comentarios text,
  p_bloque_entrepiso text default null, p_ingeniero_responsable text default null,
  p_hora_fin_trabajo time without time zone default null,
  p_personal_carpinteria smallint default 0, p_personal_acero smallint default 0,
  p_trabajadores_casa smallint default 0, p_otro_personal text default null,
  p_actividades jsonb default '[]'::jsonb, p_restricciones jsonb default '[]'::jsonb,
  p_visita_tipo_visitante text default null, p_visita_nombre text default null,
  p_visita_organizacion text default null, p_visita_motivo text default null,
  p_incidente_tipo text default null, p_incidente_gravedad text default null,
  p_incidente_subcontratista text default null, p_incidente_lesionados smallint default 0,
  p_incidente_descripcion text default null, p_incidente_acciones text default null,
  p_weather_snapshot_id uuid default null,
  p_llovio boolean default null, p_lluvia_detalle text default null,
  p_hubo_migracion boolean default null, p_migracion_obreros jsonb default null,
  p_hubo_equipos boolean default null, p_equipos_alquilados jsonb default '[]'::jsonb,
  p_incidente_equipo_nombre text default null,
  p_incidente_equipo_alquilado boolean default null,
  p_incidente_equipo_operativo boolean default null,
  p_incidente_suceso text default null,
  -- Nuevo (Act.4 · T19):
  p_incidente_equipo_operativo_comentario text default null
) returns uuid
language plpgsql
as $function$
declare
  v_id     uuid;
  v_obra   text;
  v_eq     jsonb;
  v_equipo text;
begin
  insert into sgc.bitacoras (
    usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista,
    incidente_lesionados, incidente_descripcion, incidente_acciones,
    incidente_equipo_nombre, incidente_equipo_alquilado, incidente_equipo_operativo,
    incidente_equipo_operativo_comentario,
    incidente_suceso,
    weather_snapshot_id,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros,
    hubo_equipos_alquilados
  ) values (
    p_usuario_id, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    p_bloque_entrepiso, p_ingeniero_responsable, p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0), coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_visita_tipo_visitante, p_visita_nombre, p_visita_organizacion, p_visita_motivo,
    p_incidente_tipo, p_incidente_gravedad, p_incidente_subcontratista,
    coalesce(p_incidente_lesionados, 0), p_incidente_descripcion, p_incidente_acciones,
    nullif(trim(p_incidente_equipo_nombre),''), p_incidente_equipo_alquilado, p_incidente_equipo_operativo,
    nullif(trim(p_incidente_equipo_operativo_comentario),''),
    nullif(trim(p_incidente_suceso),''),
    p_weather_snapshot_id,
    p_llovio, nullif(p_lluvia_detalle,''), p_hubo_migracion, p_migracion_obreros,
    p_hubo_equipos
  )
  returning id into v_id;

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(p_actividades) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad, unidad, bloque)
      select v_id, i->>'estructura', i->>'actividad',
             nullif(i->>'cantidad','')::numeric, nullif(i->>'unidad',''), nullif(trim(i->>'bloque'),'')
      from jsonb_array_elements(p_actividades) as i;

      insert into sgc.bitacora_catalogo_usos (proyecto_id, tipo, valor, usos, ultimo_uso)
      select p_proyecto_id, 'estructura', s.v, s.cnt, now() from (
        select trim(i->>'estructura') v, count(*) cnt
        from jsonb_array_elements(p_actividades) i
        where coalesce(trim(i->>'estructura'),'') <> '' group by trim(i->>'estructura')
      ) s
      on conflict (proyecto_id, tipo, valor)
      do update set usos = sgc.bitacora_catalogo_usos.usos + excluded.usos, ultimo_uso = now();

      insert into sgc.bitacora_catalogo_usos (proyecto_id, tipo, valor, usos, ultimo_uso)
      select p_proyecto_id, 'actividad', s.v, s.cnt, now() from (
        select trim(i->>'actividad') v, count(*) cnt
        from jsonb_array_elements(p_actividades) i
        where coalesce(trim(i->>'actividad'),'') <> '' group by trim(i->>'actividad')
      ) s
      on conflict (proyecto_id, tipo, valor)
      do update set usos = sgc.bitacora_catalogo_usos.usos + excluded.usos, ultimo_uso = now();
    end if;

    if jsonb_array_length(p_restricciones) > 0 then
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro)
      select v_id, i->>'tipo_restriccion', i->>'descripcion_otro' from jsonb_array_elements(p_restricciones) as i;
    end if;
  end if;

  if p_tipo = 'incidente' and coalesce(trim(p_incidente_suceso),'') <> '' then
    if not exists (
      select 1 from sgc.bitacora_catalogos c
      where c.tipo in ('suceso_incidente','suceso_accidente','suceso_equipo')
        and upper(c.valor) = upper(trim(p_incidente_suceso))
    ) then
      begin perform sgc.registrar_otro_valor('bitacora_suceso', trim(p_incidente_suceso), v_id);
      exception when others then null; end;
    end if;
  end if;

  if coalesce(p_hubo_equipos, false) and p_equipos_alquilados is not null
     and jsonb_array_length(p_equipos_alquilados) > 0 then
    select nombre into v_obra from sgc.proyectos where id = p_proyecto_id;
    for v_eq in select * from jsonb_array_elements(p_equipos_alquilados) loop
      v_equipo := trim(v_eq->>'equipo');
      if coalesce(v_equipo, '') <> '' then
        insert into sgc.bitacora_equipos_alquilados
          (bitacora_id, equipo, uso, proveedor, para_retirar, danado, dano_detalle)
        values (v_id, v_equipo, nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''),
                coalesce((v_eq->>'para_retirar')::boolean, false),
                coalesce((v_eq->>'danado')::boolean, false),
                nullif(trim(v_eq->>'dano_detalle'),''));
        begin perform sgc.registrar_otro_valor('bitacora_equipo_alquilado', v_equipo, v_id);
        exception when others then null; end;

        if coalesce((v_eq->>'para_retirar')::boolean, false) then
          perform sgc.notificar_rol('chofer_transportista', 'flota',
            'Retirar ' || v_equipo,
            'Retirar ' || v_equipo || ' de ' || coalesce(v_obra, 'la obra'),
            '/bitacora/historial?item=' || v_id::text);
          perform sgc.notificar_flota_elevado('flota',
            'Equipo para retirar',
            v_equipo || ' — ' || coalesce(v_obra, 'obra'),
            '/bitacora/historial?item=' || v_id::text);
        end if;
        if coalesce((v_eq->>'danado')::boolean, false) then
          perform sgc.notificar_flota_elevado('alerta',
            'Equipo dañado',
            v_equipo || coalesce(': ' || nullif(trim(v_eq->>'dano_detalle'),''), '') || ' — ' || coalesce(v_obra, 'obra'),
            '/bitacora/historial?item=' || v_id::text);
        end if;
      end if;
    end loop;
  end if;

  return v_id;
end;
$function$;

grant execute on function sgc.crear_entrada_bitacora(
  uuid,uuid,date,text,text,text,text,time without time zone,smallint,smallint,smallint,text,
  jsonb,jsonb,text,text,text,text,text,text,text,smallint,text,text,uuid,
  boolean,text,boolean,jsonb,boolean,jsonb,
  text,boolean,boolean,text,text) to authenticated, service_role;
