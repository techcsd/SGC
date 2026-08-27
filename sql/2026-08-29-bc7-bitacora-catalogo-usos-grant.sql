-- ============================================================================
-- PROMPT-21 (BC) FASE 1 — BC7 🔴: ingeniero de campo bloqueado en bitácora web
--   "permission denied for table bitacora_catalogo_usos".
--
-- RAÍZ (confirmada en prod):
--   · `crear_bitacora_app` (ruta APP)  = SECURITY DEFINER  → escribe como owner,
--      no necesita grants por rol.  ✓ nunca falló.
--   · `crear_entrada_bitacora` (ruta WEB) = SECURITY INVOKER → escribe como el
--      usuario del JWT (rol `authenticated`).  `authenticated` sólo tiene SELECT
--      sobre `sgc.bitacora_catalogo_usos` (no INSERT/UPDATE) → el
--      `insert ... on conflict do update` de usos de catálogo revienta con
--      "permission denied for table bitacora_catalogo_usos".
--   Antes no saltaba porque la bitácora WEB la usaban roles amplios; con AY5 el
--   ingeniero de campo (Juan Ocsena) ya la usa y pega en el grant que falta.
--
-- FIX (paridad con la ruta APP, "vía la matriz, no un grant suelto"):
--   El único camino de escritura es el RPC. Lo pasamos a SECURITY DEFINER con el
--   MISMO gate de la app: exige `auth.uid()` + `tiene_modulo('bitacora')` (la
--   matriz de permisos gobierna el acceso, no un GRANT de tabla a un rol suelto,
--   que además permitiría escribir la tabla por fuera del RPC).  Así ningún rol
--   necesita INSERT directo sobre los catálogos de bitácora.
--
-- De paso:
--   (1) Se ELIMINA el overload 35-arg redundante de `crear_entrada_bitacora`
--       (lo dejó AW4 en paralelo al 40-arg vivo → riesgo de ambigüedad AY6). El
--       cliente web llama SIEMPRE con los 40 args (p_sin_actividad, p_horas_lluvia…).
--   (2) Se cierra un DRIFT: AW1 añadió `es_aproximada` sólo al 35-arg muerto; el
--       40-arg vivo NO lo guardaba. Ahora la bitácora WEB registra `es_aproximada`
--       igual que la APP (paridad AW1).
--   (3) Se fuerza el autor = `auth.uid()` (salvo admin actuando-por): un
--       SECURITY DEFINER NO debe confiar en el `p_usuario_id` del cliente.
--
-- Aditivo / retrocompatible (misma firma 40-arg). Idempotente.
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-29-bc7-bitacora-catalogo-usos-grant.sql
-- ============================================================================
set search_path = sgc, public;

-- ── 1) Eliminar el overload 35-arg redundante (AY6-style) ───────────────────
drop function if exists sgc.crear_entrada_bitacora(
  uuid, uuid, date, text, text, text, text, time without time zone,
  smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, text, text, text, text, text, smallint, text, text,
  uuid, boolean, text, boolean, jsonb, boolean, jsonb,
  text, boolean, boolean, text);

-- ── 2) Recrear el 40-arg como SECURITY DEFINER + gate de módulo + es_aproximada ─
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
  p_incidente_equipo_operativo_comentario text default null,
  p_sin_actividad boolean default false,
  p_motivo_sin_actividad text default null,
  p_motivo_sin_actividad_detalle text default null,
  p_horas_lluvia numeric default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_obra   text;
  v_eq     jsonb;
  v_equipo text;
begin
  -- Gate por matriz (paridad con crear_bitacora_app). SECURITY DEFINER exige
  -- validar el acceso en código, ya que la RLS de tabla queda bypasseada.
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;

  -- Autor = usuario autenticado. No confiar en p_usuario_id del cliente salvo
  -- que un admin actúe explícitamente por otro (impersonación auditada, BC6).
  if p_usuario_id is null or (p_usuario_id <> v_uid and not sgc.is_admin()) then
    p_usuario_id := v_uid;
  end if;

  if coalesce(p_sin_actividad, false) and coalesce(trim(p_motivo_sin_actividad), '') = '' then
    raise exception 'Indica el motivo de por qué no se trabajó en obra';
  end if;

  insert into sgc.bitacoras (
    usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista,
    incidente_lesionados, incidente_descripcion, incidente_acciones,
    incidente_equipo_nombre, incidente_equipo_alquilado, incidente_equipo_operativo,
    incidente_equipo_operativo_comentario, incidente_suceso, weather_snapshot_id,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros, hubo_equipos_alquilados,
    sin_actividad, motivo_sin_actividad, motivo_sin_actividad_detalle, horas_lluvia
  ) values (
    p_usuario_id, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    p_bloque_entrepiso, p_ingeniero_responsable, p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0), coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_visita_tipo_visitante, p_visita_nombre, p_visita_organizacion, p_visita_motivo,
    p_incidente_tipo, p_incidente_gravedad, p_incidente_subcontratista,
    coalesce(p_incidente_lesionados, 0), p_incidente_descripcion, p_incidente_acciones,
    nullif(trim(p_incidente_equipo_nombre),''), p_incidente_equipo_alquilado, p_incidente_equipo_operativo,
    nullif(trim(p_incidente_equipo_operativo_comentario),''), nullif(trim(p_incidente_suceso),''),
    p_weather_snapshot_id,
    p_llovio, nullif(p_lluvia_detalle,''), p_hubo_migracion, p_migracion_obreros, p_hubo_equipos,
    coalesce(p_sin_actividad, false), nullif(trim(p_motivo_sin_actividad),''),
    nullif(trim(p_motivo_sin_actividad_detalle),''),
    case when coalesce(p_llovio,false) then p_horas_lluvia else null end
  )
  returning id into v_id;

  -- Un parte "sin actividad" no registra actividades ni restricciones.
  if p_tipo = 'parte_diario' and not coalesce(p_sin_actividad, false) then
    if jsonb_array_length(p_actividades) > 0 then
      -- S4 bloque por línea + AW1 es_aproximada (paridad con crear_bitacora_app).
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad, unidad, bloque, es_aproximada)
      select v_id, i->>'estructura', i->>'actividad',
             nullif(i->>'cantidad','')::numeric, nullif(i->>'unidad',''), nullif(trim(i->>'bloque'),''),
             coalesce((i->>'es_aproximada')::boolean, false)
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
  boolean,text,boolean,jsonb,boolean,jsonb,text,boolean,boolean,text,
  text,boolean,text,text,numeric) to authenticated, service_role;
