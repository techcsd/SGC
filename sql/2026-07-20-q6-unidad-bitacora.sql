-- ============================================================================
-- Q6 — Unidad de medida del trabajo realizado en bitácora (20/07/2026)
-- ----------------------------------------------------------------------------
-- Migración ADITIVA y RETROCOMPATIBLE.
--
--   1. Columna aditiva `unidad text` en sgc.bitacora_actividades (nullable →
--      filas viejas quedan sin unidad).
--   2. Los RPCs que insertan actividades leen `unidad` del jsonb de actividades
--      SIN cambiar su firma (retrocompatible: la app vieja no envía el campo →
--      queda null): crear_entrada_bitacora (web) y crear_bitacora_app (app).
--
-- Los cuerpos de ambas funciones se toman de la definición vigente en la BD y
-- solo se les añade la columna `unidad` en el insert de actividades.
-- ============================================================================

set search_path = sgc, public;

alter table sgc.bitacora_actividades add column if not exists unidad text;
comment on column sgc.bitacora_actividades.unidad is
  'Unidad de medida del trabajo realizado (código de sgc.unidades); nullable para filas legacy.';

-- ── RPC web: crear_entrada_bitacora (actividades con unidad) ────────────────
CREATE OR REPLACE FUNCTION sgc.crear_entrada_bitacora(p_usuario_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text, p_comentarios text, p_bloque_entrepiso text DEFAULT NULL::text, p_ingeniero_responsable text DEFAULT NULL::text, p_hora_fin_trabajo time without time zone DEFAULT NULL::time without time zone, p_personal_carpinteria smallint DEFAULT 0, p_personal_acero smallint DEFAULT 0, p_trabajadores_casa smallint DEFAULT 0, p_otro_personal text DEFAULT NULL::text, p_actividades jsonb DEFAULT '[]'::jsonb, p_restricciones jsonb DEFAULT '[]'::jsonb, p_visita_tipo_visitante text DEFAULT NULL::text, p_visita_nombre text DEFAULT NULL::text, p_visita_organizacion text DEFAULT NULL::text, p_visita_motivo text DEFAULT NULL::text, p_incidente_tipo text DEFAULT NULL::text, p_incidente_gravedad text DEFAULT NULL::text, p_incidente_subcontratista text DEFAULT NULL::text, p_incidente_lesionados smallint DEFAULT 0, p_incidente_descripcion text DEFAULT NULL::text, p_incidente_acciones text DEFAULT NULL::text, p_weather_snapshot_id uuid DEFAULT NULL::uuid, p_llovio boolean DEFAULT NULL::boolean, p_lluvia_detalle text DEFAULT NULL::text, p_hubo_migracion boolean DEFAULT NULL::boolean, p_migracion_obreros jsonb DEFAULT NULL::jsonb, p_hubo_equipos boolean DEFAULT NULL::boolean, p_equipos_alquilados jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id uuid;
  v_eq jsonb;
begin
  insert into sgc.bitacoras (
    usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista,
    incidente_lesionados, incidente_descripcion, incidente_acciones,
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
    p_weather_snapshot_id,
    p_llovio, nullif(p_lluvia_detalle,''), p_hubo_migracion, p_migracion_obreros,
    p_hubo_equipos
  )
  returning id into v_id;

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(p_actividades) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad, unidad)
      select v_id, i->>'estructura', i->>'actividad', nullif(i->>'cantidad','')::numeric, nullif(i->>'unidad','')
        from jsonb_array_elements(p_actividades) as i;
    end if;
    if jsonb_array_length(p_restricciones) > 0 then
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro)
      select v_id, i->>'tipo_restriccion', i->>'descripcion_otro' from jsonb_array_elements(p_restricciones) as i;
    end if;
  end if;

  -- W2: equipos alquilados (aditivo). Cada equipo alimenta otros_valores (U25).
  if coalesce(p_hubo_equipos, false) and p_equipos_alquilados is not null
     and jsonb_array_length(p_equipos_alquilados) > 0 then
    for v_eq in select * from jsonb_array_elements(p_equipos_alquilados) loop
      if coalesce(trim(v_eq->>'equipo'), '') <> '' then
        insert into sgc.bitacora_equipos_alquilados (bitacora_id, equipo, uso, proveedor)
        values (v_id, trim(v_eq->>'equipo'), nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''));
        perform sgc.registrar_otro_valor('bitacora_equipo_alquilado', trim(v_eq->>'equipo'), v_id);
      end if;
    end loop;
  end if;

  return v_id;
end;
$function$

;

-- ── RPC app: crear_bitacora_app (actividades con unidad) ────────────────────
CREATE OR REPLACE FUNCTION sgc.crear_bitacora_app(p_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text, p_comentarios text DEFAULT NULL::text, p_personal_carpinteria smallint DEFAULT 0, p_personal_acero smallint DEFAULT 0, p_trabajadores_casa smallint DEFAULT 0, p_otro_personal text DEFAULT NULL::text, p_actividades jsonb DEFAULT '[]'::jsonb, p_restricciones jsonb DEFAULT '[]'::jsonb, p_incidente_tipo text DEFAULT NULL::text, p_incidente_gravedad text DEFAULT NULL::text, p_incidente_lesionados smallint DEFAULT 0, p_incidente_descripcion text DEFAULT NULL::text, p_incidente_acciones text DEFAULT NULL::text, p_fotos jsonb DEFAULT '[]'::jsonb, p_capturado_en timestamp with time zone DEFAULT now(), p_llovio boolean DEFAULT NULL::boolean, p_lluvia_detalle text DEFAULT NULL::text, p_hubo_migracion boolean DEFAULT NULL::boolean, p_migracion_obreros jsonb DEFAULT NULL::jsonb, p_hubo_equipos boolean DEFAULT NULL::boolean, p_equipos_alquilados jsonb DEFAULT '[]'::jsonb, p_bloque_entrepiso text DEFAULT NULL::text, p_ingeniero_responsable text DEFAULT NULL::text, p_hora_fin_trabajo time without time zone DEFAULT NULL::time without time zone, p_incidente_subcontratista text DEFAULT NULL::text, p_visita_tipo_visitante text DEFAULT NULL::text, p_visita_nombre text DEFAULT NULL::text, p_visita_organizacion text DEFAULT NULL::text, p_visita_motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_eq  jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;

  if exists (select 1 from sgc.bitacoras where id = p_id) then
    return p_id;
  end if;

  insert into sgc.bitacoras (
    id, usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista, incidente_lesionados,
    incidente_descripcion, incidente_acciones,
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
    p_llovio, p_lluvia_detalle, p_hubo_migracion, p_migracion_obreros,
    p_hubo_equipos
  );

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(coalesce(p_actividades, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad, unidad)
      select p_id, i->>'estructura', i->>'actividad', nullif(i->>'cantidad','')::numeric, nullif(i->>'unidad','')
      from jsonb_array_elements(p_actividades) as i;
    end if;
    if jsonb_array_length(coalesce(p_restricciones, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro)
      select p_id, i->>'tipo_restriccion', i->>'descripcion_otro'
      from jsonb_array_elements(p_restricciones) as i;
    end if;
  end if;

  if jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 0 then
    insert into sgc.bitacora_archivos (bitacora_id, nombre, url, tipo_mime)
    select p_id, coalesce(i->>'nombre', 'foto.jpg'), i->>'path', coalesce(i->>'tipo_mime', 'image/jpeg')
    from jsonb_array_elements(p_fotos) as i;
  end if;

  -- W2 — equipos alquilados (aditivo). Cada equipo alimenta otros_valores (U25).
  if coalesce(p_hubo_equipos, false) and p_equipos_alquilados is not null
     and jsonb_array_length(p_equipos_alquilados) > 0 then
    for v_eq in select * from jsonb_array_elements(p_equipos_alquilados) loop
      if coalesce(trim(v_eq->>'equipo'), '') <> '' then
        insert into sgc.bitacora_equipos_alquilados (bitacora_id, equipo, uso, proveedor)
        values (p_id, trim(v_eq->>'equipo'), nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''));
        begin
          perform sgc.registrar_otro_valor('bitacora_equipo_alquilado', trim(v_eq->>'equipo'), p_id);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;

  return p_id;
end;
$function$

;
