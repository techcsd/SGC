-- sql/2026-10-29-db8-documentos-flota.sql — Ronda DB (PROMPT-124 F3, DB3)
-- Lector de documentos de flota en lote (MARBETES.pdf: 12 seguros SURA renovados).
-- La edge `leer-documento-flota` extrae por página; estas RPCs EMPAREJAN cada
-- página con un vehículo (placa exacta → VIN → distancia 1 = «Revisar» → sin
-- vehículo) y APLICAN por fila (transaccional: una falla no tumba el lote).
--
-- Reglas de escritura (DB-08):
--   · nunca pisa una vigencia MÁS NUEVA que la leída;
--   · VIN solo se llena si está vacío;
--   · la imagen de la página va al slot de Documentos (seguro/matricula/marbete);
--   · auditoría explícita «leído por IA, confirmado por X» (además del
--     trg_auditoria normal del UPDATE);
--   · al actualizar vigencias, trg_reevaluar_vencimiento reactiva el vehículo
--     solo si fue puesto no_disponible por documentos (act3-p9) — es exactamente
--     lo que dejó la flota invisible a los choferes el 28-oct (F0/DB12).
--
-- Marbete DGII: hoy solo existía en vehiculo_placas_pp (AG8, flujo de placa
-- provisional). El marbete se renueva cada año para TODA la flota → columnas
-- generales nuevas (aditivo).
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db8-documentos-flota.sql --env dev

-- ── 0) Columnas de marbete generales ──────────────────────────────────────────
alter table sgc.vehiculos add column if not exists marbete_numero text;
alter table sgc.vehiculos add column if not exists vencimiento_marbete date;

-- ── 1) Normalización + distancia 1 (para placas leídas con un dígito dudoso) ──
create or replace function sgc._placa_normalizada(p text)
returns text language sql immutable
as $$ select upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Distancia de edición ≤ 1 sin extensiones: misma longitud con exactamente un
-- carácter distinto, o longitudes que difieren en 1 con inserción/borrado único.
create or replace function sgc._texto_distancia1(a text, b text)
returns boolean language plpgsql immutable
as $function$
declare
  la int := length(a); lb int := length(b); i int; dif int := 0;
begin
  if a is null or b is null then return false; end if;
  if a = b then return false; end if; -- igual no es "a 1"
  if la = lb then
    for i in 1..la loop
      if substr(a, i, 1) <> substr(b, i, 1) then dif := dif + 1; end if;
      if dif > 1 then return false; end if;
    end loop;
    return dif = 1;
  elsif abs(la - lb) = 1 then
    -- el corto debe ser el largo con un carácter quitado
    declare corto text := case when la < lb then a else b end;
            largo text := case when la < lb then b else a end;
    begin
      for i in 1..length(largo) loop
        if overlay(largo placing '' from i for 1) = corto then return true; end if;
      end loop;
      return false;
    end;
  end if;
  return false;
end $function$;

-- ── 2) Emparejar páginas leídas con vehículos ─────────────────────────────────
-- Entrada: jsonb array de páginas: [{ "pagina": 1, "tipo": "seguro",
--   "campos": { "placa": "...", "chasis": "...", ... } }, ...]
-- Salida: mismo array con  "match": exacta|vin|revisar|sin_vehiculo,
--   "vehiculo_id", "vehiculo_placa", "vehiculo_alias" y "candidatos" (si revisar).
create or replace function sgc.flota_documentos_emparejar(p_paginas jsonb)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_pag jsonb;
  v_placa text; v_vin text;
  v_veh record;
  v_cand jsonb;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No tienes acceso a Flota.' using errcode = '42501';
  end if;

  for v_pag in select * from jsonb_array_elements(coalesce(p_paginas, '[]'::jsonb))
  loop
    v_placa := sgc._placa_normalizada(v_pag->'campos'->>'placa');
    v_vin   := upper(regexp_replace(coalesce(v_pag->'campos'->>'chasis',''), '[^A-Za-z0-9]', '', 'g'));

    -- reverso/otro: no se empareja
    if coalesce(v_pag->>'tipo','') in ('reverso','otro') then
      v_out := v_out || (v_pag || jsonb_build_object('match', 'sin_vehiculo'));
      continue;
    end if;

    -- (a) placa exacta
    select v.id, v.placa, v.alias into v_veh
    from sgc.vehiculos v
    where v.activo and v_placa <> '' and sgc._placa_normalizada(v.placa) = v_placa
    limit 1;
    if found then
      v_out := v_out || (v_pag || jsonb_build_object('match','exacta','vehiculo_id',v_veh.id,
        'vehiculo_placa',v_veh.placa,'vehiculo_alias',v_veh.alias));
      continue;
    end if;

    -- (b) VIN exacto
    select v.id, v.placa, v.alias into v_veh
    from sgc.vehiculos v
    where v.activo and v_vin <> ''
      and upper(regexp_replace(coalesce(v.vin,''),'[^A-Za-z0-9]','','g')) = v_vin
    limit 1;
    if found then
      v_out := v_out || (v_pag || jsonb_build_object('match','vin','vehiculo_id',v_veh.id,
        'vehiculo_placa',v_veh.placa,'vehiculo_alias',v_veh.alias));
      continue;
    end if;

    -- (c) placa a 1 carácter → «Revisar» con candidatos (caso real F0:
    --     L441680 leída vs L441660/L540986 en el sistema)
    select coalesce(jsonb_agg(jsonb_build_object('vehiculo_id', v.id, 'placa', v.placa, 'alias', v.alias)), '[]'::jsonb)
      into v_cand
    from sgc.vehiculos v
    where v.activo and v_placa <> '' and sgc._texto_distancia1(sgc._placa_normalizada(v.placa), v_placa);
    if jsonb_array_length(v_cand) > 0 then
      v_out := v_out || (v_pag || jsonb_build_object('match','revisar','candidatos',v_cand));
      continue;
    end if;

    v_out := v_out || (v_pag || jsonb_build_object('match','sin_vehiculo'));
  end loop;

  return v_out;
end $function$;
grant execute on function sgc.flota_documentos_emparejar(jsonb) to authenticated;

-- ── 3) Aplicar por fila (transaccional: una falla no tumba el lote) ───────────
-- Entrada: jsonb array: [{ "vehiculo_id": "...", "tipo": "seguro|matricula|marbete_dgii",
--   "campos": {...}, "imagen_path": "ruta/en/bucket-documentos.png"|null, "pagina": 1 }]
-- Salida: [{ "vehiculo_id", "pagina", "ok", "aplicado": {campo: valor...}, "omitido": "motivo"|null, "error": null|texto }]
create or replace function sgc.flota_documentos_aplicar(p_filas jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_fila jsonb;
  v_tipo text; v_veh_id uuid;
  v_desde date; v_hasta date;
  v_aplicado jsonb;
  v_omitido text;
  v_actual record;
  v_num text; v_aseg text; v_vin text;
  v_path text;
  v_nombre_actor text;
begin
  -- DB-16: aplicar = admin o flota elevada (jefe_flota / logistica).
  if not (sgc.is_admin() or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo in ('jefe_flota','logistica')
  )) then
    raise exception 'Solo Flota (jefe de flota / logística) o un administrador puede aplicar documentos.' using errcode = '42501';
  end if;

  select nombre into v_nombre_actor from sgc.usuarios where id = auth.uid();

  for v_fila in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb))
  loop
    v_tipo := v_fila->>'tipo';
    v_veh_id := nullif(v_fila->>'vehiculo_id','')::uuid;
    v_aplicado := '{}'::jsonb;
    v_omitido := null;
    begin
      if v_veh_id is null then raise exception 'Fila sin vehículo.'; end if;
      if v_tipo not in ('seguro','matricula','marbete_dgii') then
        raise exception 'Tipo de documento no soportado: %', coalesce(v_tipo,'(vacío)');
      end if;

      select * into v_actual from sgc.vehiculos where id = v_veh_id for update;
      if not found then raise exception 'Vehículo no encontrado.'; end if;

      v_desde := nullif(v_fila->'campos'->>'vigencia_desde','')::date;
      v_hasta := nullif(v_fila->'campos'->>'vigencia_hasta','')::date;
      v_num   := nullif(trim(coalesce(v_fila->'campos'->>'poliza', v_fila->'campos'->>'numero_matricula', v_fila->'campos'->>'marbete_numero')),'');
      v_aseg  := nullif(trim(coalesce(v_fila->'campos'->>'aseguradora','')),'');
      v_vin   := nullif(trim(coalesce(v_fila->'campos'->>'chasis','')),'');

      if v_tipo = 'seguro' then
        if v_hasta is null then
          raise exception 'El documento de seguro no trae vigencia hasta.';
        elsif v_actual.vencimiento_seguro is not null and v_actual.vencimiento_seguro > v_hasta then
          v_omitido := format('El vehículo ya tiene un seguro con vigencia más nueva (%s).', to_char(v_actual.vencimiento_seguro,'DD/MM/YYYY'));
        else
          update sgc.vehiculos set
            numero_seguro = coalesce(v_num, numero_seguro),
            aseguradora = coalesce(v_aseg, aseguradora),
            vencimiento_seguro = v_hasta,
            vin = coalesce(nullif(vin,''), v_vin),
            updated_at = now()
          where id = v_veh_id;
          v_aplicado := jsonb_strip_nulls(jsonb_build_object(
            'numero_seguro', v_num, 'aseguradora', v_aseg,
            'vencimiento_seguro', v_hasta,
            'vin', case when nullif(v_actual.vin,'') is null then v_vin end));
        end if;

      elsif v_tipo = 'matricula' then
        if v_actual.vencimiento_matricula is not null and v_hasta is not null
           and v_actual.vencimiento_matricula > v_hasta then
          v_omitido := format('El vehículo ya tiene una matrícula con vigencia más nueva (%s).', to_char(v_actual.vencimiento_matricula,'DD/MM/YYYY'));
        elsif v_num is null and v_hasta is null then
          v_omitido := 'El documento no trae número de matrícula ni vigencia.';
        else
          update sgc.vehiculos set
            numero_matricula = coalesce(v_num, numero_matricula),
            vencimiento_matricula = coalesce(v_hasta, vencimiento_matricula),
            vin = coalesce(nullif(vin,''), v_vin),
            updated_at = now()
          where id = v_veh_id;
          v_aplicado := jsonb_strip_nulls(jsonb_build_object(
            'numero_matricula', v_num, 'vencimiento_matricula', v_hasta,
            'vin', case when nullif(v_actual.vin,'') is null then v_vin end));
        end if;

      else -- marbete_dgii
        if v_actual.vencimiento_marbete is not null and v_hasta is not null
           and v_actual.vencimiento_marbete > v_hasta then
          v_omitido := format('El vehículo ya tiene un marbete con vigencia más nueva (%s).', to_char(v_actual.vencimiento_marbete,'DD/MM/YYYY'));
        elsif v_num is null and v_hasta is null then
          v_omitido := 'El documento no trae número de marbete ni vigencia.';
        else
          update sgc.vehiculos set
            marbete_numero = coalesce(v_num, marbete_numero),
            vencimiento_marbete = coalesce(v_hasta, vencimiento_marbete),
            updated_at = now()
          where id = v_veh_id;
          v_aplicado := jsonb_strip_nulls(jsonb_build_object(
            'marbete_numero', v_num, 'vencimiento_marbete', v_hasta));
        end if;
      end if;

      -- Imagen de la página → slot de Documentos del vehículo (tipo seguro|matricula|marbete)
      v_path := nullif(v_fila->>'imagen_path','');
      if v_omitido is null and v_path is not null then
        insert into sgc.documentos (entidad, entidad_id, tipo, nombre, path, subido_por)
        values ('vehiculo', v_veh_id,
                case v_tipo when 'marbete_dgii' then 'marbete' else v_tipo end,
                format('%s %s (leído por IA)', initcap(replace(v_tipo,'_dgii','')), coalesce(to_char(v_hasta,'YYYY'), to_char(now(),'YYYY'))),
                v_path, auth.uid());
      end if;

      -- Auditoría explícita (además del trg_auditoria del UPDATE). `accion` tiene
      -- CHECK (INSERT|UPDATE|DELETE): el marcador «leído por IA» va en origen/cambios.
      if v_omitido is null then
        insert into sgc.auditoria (tabla, registro_id, accion, actor_id, cambios, origen)
        values ('vehiculos', v_veh_id::text, 'UPDATE', auth.uid(),
                jsonb_build_object('tipo', v_tipo, 'aplicado', v_aplicado,
                  'nota', format('%s actualizado desde documento (leído por IA, confirmado por %s)',
                                 initcap(v_tipo), coalesce(v_nombre_actor,'un usuario'))),
                'lector_documentos_flota');
      end if;

      v_out := v_out || jsonb_build_object(
        'vehiculo_id', v_veh_id, 'pagina', v_fila->'pagina',
        'ok', v_omitido is null, 'aplicado', v_aplicado, 'omitido', v_omitido, 'error', null);
    exception when others then
      v_out := v_out || jsonb_build_object(
        'vehiculo_id', v_veh_id, 'pagina', v_fila->'pagina',
        'ok', false, 'aplicado', '{}'::jsonb, 'omitido', null, 'error', SQLERRM);
    end;
  end loop;

  return v_out;
end $function$;
grant execute on function sgc.flota_documentos_aplicar(jsonb) to authenticated;
