-- sql/2026-10-30-de1-sugerencias-documentos.sql — Ronda DE (PROMPT-126 F1, DE1/DE-02/DE-04)
-- Sugerencias con puntaje para documentos de flota «sin vehículo»/«revisar»
-- (Xaviel: "maybe we can add suggestions based on info that barely match").
-- Nunca asigna sola: siempre devuelve candidatos para que la persona elija.
--
--   node scripts/apply-migration.mjs sql/2026-10-30-de1-sugerencias-documentos.sql --env dev

create extension if not exists fuzzystrmatch with schema extensions;

-- ── 1) Placa "tapada" (DE-04): ≥4 X seguidas o con asterisco → no se compara ──
create or replace function sgc._placa_oculta(p text)
returns boolean language sql immutable
as $$ select coalesce(p,'') ~* 'X{4,}' or coalesce(p,'') like '%*%' $$;

-- ── 2) Sugerir vehículo para una página (DE-02) ───────────────────────────────
-- Entrada: UNA página leída { tipo, campos: {placa, chasis, marca, modelo, anio,
--   color, poliza, aseguradora} }. Salida: jsonb array (≤5) con
--   {vehiculo_id, placa, alias, marca, modelo, anio, color, responsable, puntos,
--    nivel, razones[]}, orden desc por puntos. Menos de 40 puntos no se incluye.
create or replace function sgc.flota_documentos_sugerir(p_pagina jsonb)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_placa_leida text := p_pagina->'campos'->>'placa';
  -- La oculta la puede marcar el lector (campos.placa=null, placa_oculta=true) o,
  -- si viene suelta (caso de uso directo de sugerir), se detecta por patrón.
  v_placa_oculta boolean := coalesce((p_pagina->>'placa_oculta')::boolean, false) or sgc._placa_oculta(v_placa_leida);
  v_placa text := case when v_placa_oculta then '' else sgc._placa_normalizada(v_placa_leida) end;
  v_vin text := upper(regexp_replace(coalesce(p_pagina->'campos'->>'chasis',''), '[^A-Za-z0-9]', '', 'g'));
  v_marca text := lower(trim(coalesce(p_pagina->'campos'->>'marca','')));
  v_modelo text := lower(trim(coalesce(p_pagina->'campos'->>'modelo','')));
  v_anio int := nullif(p_pagina->'campos'->>'anio','')::int;
  v_color text := lower(trim(coalesce(p_pagina->'campos'->>'color','')));
  v_poliza text := nullif(trim(coalesce(p_pagina->'campos'->>'poliza','')),'');
  v_aseg text := lower(trim(coalesce(p_pagina->'campos'->>'aseguradora','')));
  v_out jsonb := '[]'::jsonb;
  v_veh record;
  v_puntos int;
  v_razones text[];
  v_veh_vin text;
  v_dist int;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No tienes acceso a Flota.' using errcode = '42501';
  end if;

  for v_veh in
    select v.id, v.placa, v.alias, v.marca, v.modelo, v.anio, v.color, v.vin,
           v.numero_seguro, v.aseguradora, u.nombre as responsable
    from sgc.vehiculos v
    left join sgc.usuarios u on u.id = v.responsable_id
    where v.activo
  loop
    v_puntos := 0;
    v_razones := array[]::text[];

    -- placa: distancia ≤2 (nunca si está tapada en el documento)
    if v_placa <> '' and v_veh.placa is not null then
      v_dist := extensions.levenshtein(sgc._placa_normalizada(v_veh.placa), v_placa);
      if v_dist = 1 then
        v_puntos := v_puntos + 40; v_razones := v_razones || 'placa difiere en 1 carácter'::text;
      elsif v_dist = 2 then
        v_puntos := v_puntos + 25; v_razones := v_razones || 'placa difiere en 2 caracteres'::text;
      end if;
    end if;

    -- VIN: últimos 6 iguales, o distancia ≤2
    if v_vin <> '' and v_veh.vin is not null and length(v_vin) >= 6 then
      v_veh_vin := upper(regexp_replace(v_veh.vin, '[^A-Za-z0-9]', '', 'g'));
      if length(v_veh_vin) >= 6 and right(v_veh_vin, 6) = right(v_vin, 6) then
        v_puntos := v_puntos + 40; v_razones := v_razones || 'VIN coincide en los últimos 6 caracteres'::text;
      elsif extensions.levenshtein(v_veh_vin, v_vin) <= 2 then
        v_puntos := v_puntos + 35; v_razones := v_razones || 'VIN muy parecido (≤2 caracteres de diferencia)'::text;
      end if;
    end if;

    -- marca + modelo
    if v_marca <> '' and v_modelo <> ''
       and lower(coalesce(v_veh.marca,'')) like '%'||v_marca||'%'
       and lower(coalesce(v_veh.modelo,'')) like '%'||v_modelo||'%' then
      v_puntos := v_puntos + 20; v_razones := v_razones || 'marca y modelo coinciden'::text;
    end if;

    -- año
    if v_anio is not null and v_veh.anio = v_anio then
      v_puntos := v_puntos + 10; v_razones := v_razones || 'año coincide'::text;
    end if;

    -- color (si se leyó)
    if v_color <> '' and lower(coalesce(v_veh.color,'')) = v_color then
      v_puntos := v_puntos + 5; v_razones := v_razones || 'color coincide'::text;
    end if;

    -- póliza ya registrada en el vehículo
    if v_poliza is not null and v_veh.numero_seguro is not null and v_veh.numero_seguro = v_poliza then
      v_puntos := v_puntos + 30; v_razones := v_razones || 'ya tiene esta póliza registrada'::text;
    end if;

    -- aseguradora igual
    if v_aseg <> '' and lower(coalesce(v_veh.aseguradora,'')) = v_aseg then
      v_puntos := v_puntos + 5; v_razones := v_razones || 'misma aseguradora'::text;
    end if;

    if v_puntos >= 40 then
      v_out := v_out || jsonb_build_object(
        'vehiculo_id', v_veh.id, 'placa', v_veh.placa, 'alias', v_veh.alias,
        'marca', v_veh.marca, 'modelo', v_veh.modelo, 'anio', v_veh.anio, 'color', v_veh.color,
        'responsable', v_veh.responsable, 'puntos', v_puntos,
        'nivel', case when v_puntos >= 70 then 'muy_probable' else 'posible' end,
        'razones', to_jsonb(v_razones));
    end if;
  end loop;

  -- top 5 por puntos desc
  select coalesce(jsonb_agg(elem order by (elem->>'puntos')::int desc), '[]'::jsonb)
  into v_out
  from (select elem from jsonb_array_elements(v_out) elem
        order by (elem->>'puntos')::int desc limit 5) s;

  return coalesce(v_out, '[]'::jsonb);
end $function$;
grant execute on function sgc.flota_documentos_sugerir(jsonb) to authenticated;

-- ── 3) Emparejar: usar sugerir() para 'revisar'/'sin_vehiculo' (candidatos ricos) ──
create or replace function sgc.flota_documentos_emparejar(p_paginas jsonb)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_pag jsonb;
  v_placa text; v_vin text; v_oculta boolean;
  v_veh record;
  v_cand jsonb;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No tienes acceso a Flota.' using errcode = '42501';
  end if;

  for v_pag in select * from jsonb_array_elements(coalesce(p_paginas, '[]'::jsonb))
  loop
    v_oculta := coalesce((v_pag->>'placa_oculta')::boolean, false) or sgc._placa_oculta(v_pag->'campos'->>'placa');
    v_placa := case when v_oculta then '' else sgc._placa_normalizada(v_pag->'campos'->>'placa') end;
    v_vin   := upper(regexp_replace(coalesce(v_pag->'campos'->>'chasis',''), '[^A-Za-z0-9]', '', 'g'));

    -- reverso/otro: no se empareja (F3 lo vuelve a juntar con su anverso en el cliente)
    if coalesce(v_pag->>'tipo','') in ('reverso','otro') then
      v_out := v_out || (v_pag || jsonb_build_object('match', 'sin_vehiculo', 'placa_oculta', v_oculta));
      continue;
    end if;

    -- (a) placa exacta (nunca si está tapada)
    if v_placa <> '' then
      select v.id, v.placa, v.alias into v_veh
      from sgc.vehiculos v
      where v.activo and sgc._placa_normalizada(v.placa) = v_placa
      limit 1;
      if found then
        v_out := v_out || (v_pag || jsonb_build_object('match','exacta','vehiculo_id',v_veh.id,
          'vehiculo_placa',v_veh.placa,'vehiculo_alias',v_veh.alias,'placa_oculta',false));
        continue;
      end if;
    end if;

    -- (b) VIN exacto
    if v_vin <> '' then
      select v.id, v.placa, v.alias into v_veh
      from sgc.vehiculos v
      where v.activo
        and upper(regexp_replace(coalesce(v.vin,''),'[^A-Za-z0-9]','','g')) = v_vin
      limit 1;
      if found then
        v_out := v_out || (v_pag || jsonb_build_object('match','vin','vehiculo_id',v_veh.id,
          'vehiculo_placa',v_veh.placa,'vehiculo_alias',v_veh.alias,'placa_oculta',v_oculta));
        continue;
      end if;
    end if;

    -- (c) sugerencias (DE-02): ≥40 puntos → "revisar" con candidatos; si no, "sin_vehiculo"
    v_cand := sgc.flota_documentos_sugerir(v_pag);
    if jsonb_array_length(v_cand) > 0 then
      v_out := v_out || (v_pag || jsonb_build_object('match','revisar','candidatos',v_cand,'placa_oculta',v_oculta));
    else
      v_out := v_out || (v_pag || jsonb_build_object('match','sin_vehiculo','candidatos','[]'::jsonb,'placa_oculta',v_oculta));
    end if;
  end loop;

  return v_out;
end $function$;
grant execute on function sgc.flota_documentos_emparejar(jsonb) to authenticated;
