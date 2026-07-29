-- ============================================================================
-- Z22 — Foto opcional por equipo dañado (paso 8c de la bitácora / parte diario)
-- PROMPT-7 · FASE 2.3b · ADITIVO / RETROCOMPATIBLE
-- ============================================================================
-- Añade sgc.bitacora_equipos_alquilados.foto_path y hace que crear_bitacora_app
-- lea v_eq->>'foto_path' de cada elemento de p_equipos_alquilados (retrocompat:
-- llega nulo desde clientes viejos). Mismo patrón que la foto de restricción
-- (Z21, bitacora_restricciones.foto_path). El resto del cuerpo del RPC es idéntico
-- al dump de Z21; SOLO cambió el INSERT del loop de equipos alquilados.
--
-- NO APLICADA — la aplica Xavier.
-- ============================================================================

alter table sgc.bitacora_equipos_alquilados add column if not exists foto_path text;

CREATE OR REPLACE FUNCTION sgc.crear_bitacora_app(p_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text, p_comentarios text DEFAULT NULL::text, p_personal_carpinteria smallint DEFAULT 0, p_personal_acero smallint DEFAULT 0, p_trabajadores_casa smallint DEFAULT 0, p_otro_personal text DEFAULT NULL::text, p_actividades jsonb DEFAULT '[]'::jsonb, p_restricciones jsonb DEFAULT '[]'::jsonb, p_incidente_tipo text DEFAULT NULL::text, p_incidente_gravedad text DEFAULT NULL::text, p_incidente_lesionados smallint DEFAULT 0, p_incidente_descripcion text DEFAULT NULL::text, p_incidente_acciones text DEFAULT NULL::text, p_fotos jsonb DEFAULT '[]'::jsonb, p_capturado_en timestamp with time zone DEFAULT now(), p_llovio boolean DEFAULT NULL::boolean, p_lluvia_detalle text DEFAULT NULL::text, p_hubo_migracion boolean DEFAULT NULL::boolean, p_migracion_obreros jsonb DEFAULT NULL::jsonb, p_hubo_equipos boolean DEFAULT NULL::boolean, p_equipos_alquilados jsonb DEFAULT '[]'::jsonb, p_bloque_entrepiso text DEFAULT NULL::text, p_ingeniero_responsable text DEFAULT NULL::text, p_hora_fin_trabajo time without time zone DEFAULT NULL::time without time zone, p_incidente_subcontratista text DEFAULT NULL::text, p_visita_tipo_visitante text DEFAULT NULL::text, p_visita_nombre text DEFAULT NULL::text, p_visita_organizacion text DEFAULT NULL::text, p_visita_motivo text DEFAULT NULL::text, p_incidente_equipo_nombre text DEFAULT NULL::text, p_incidente_equipo_alquilado boolean DEFAULT NULL::boolean, p_incidente_equipo_operativo boolean DEFAULT NULL::boolean, p_incidente_suceso text DEFAULT NULL::text, p_incidente_equipo_operativo_comentario text DEFAULT NULL::text, p_sin_actividad boolean DEFAULT false, p_motivo_sin_actividad text DEFAULT NULL::text, p_motivo_sin_actividad_detalle text DEFAULT NULL::text, p_horas_lluvia numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
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

  if coalesce(p_sin_actividad, false) and coalesce(trim(p_motivo_sin_actividad), '') = '' then
    raise exception 'Indica el motivo de por qué no se trabajó en obra';
  end if;

  -- Un parte "sin actividad" no exige fotos mínimas.
  if not coalesce(p_sin_actividad, false) then
    if p_tipo = 'parte_diario' and v_nfotos < c_min_fotos_parte then
      raise exception 'Agrega al menos % fotos del trabajo realizado', c_min_fotos_parte;
    end if;
    if p_tipo = 'incidente' and v_nfotos < c_min_fotos_incidente then
      raise exception 'Agrega al menos % foto del incidente', c_min_fotos_incidente;
    end if;
  end if;

  insert into sgc.bitacoras (
    id, usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista, incidente_lesionados,
    incidente_descripcion, incidente_acciones,
    incidente_equipo_nombre, incidente_equipo_alquilado, incidente_equipo_operativo,
    incidente_equipo_operativo_comentario, incidente_suceso,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros, hubo_equipos_alquilados,
    sin_actividad, motivo_sin_actividad, motivo_sin_actividad_detalle, horas_lluvia
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
    nullif(trim(p_incidente_equipo_operativo_comentario),''), nullif(trim(p_incidente_suceso),''),
    p_llovio, p_lluvia_detalle, p_hubo_migracion, p_migracion_obreros, p_hubo_equipos,
    coalesce(p_sin_actividad, false), nullif(trim(p_motivo_sin_actividad),''),
    nullif(trim(p_motivo_sin_actividad_detalle),''),
    case when coalesce(p_llovio,false) then p_horas_lluvia else null end
  );

  if p_tipo = 'parte_diario' and not coalesce(p_sin_actividad, false) then
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
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro, foto_path)
      select p_id, i->>'tipo_restriccion', i->>'descripcion_otro', i->>'foto_path'
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
        -- Z22 — foto_path opcional del equipo dañado (retrocompatible: nulo desde clientes viejos).
        insert into sgc.bitacora_equipos_alquilados
          (bitacora_id, equipo, uso, proveedor, para_retirar, danado, dano_detalle, foto_path)
        values (p_id, v_equipo, nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''),
                coalesce((v_eq->>'para_retirar')::boolean, false),
                coalesce((v_eq->>'danado')::boolean, false),
                nullif(trim(v_eq->>'dano_detalle'),''),
                nullif(trim(v_eq->>'foto_path'),''));
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
