-- sql/2026-10-30-de2-documentos-reverso.sql — Ronda DE (PROMPT-126 F3, DE2/DE-05/DE-06)
-- El reverso del marbete/seguro se guarda como segundo documento del vehículo
-- (solo imagen; MARBETES.pdf confirmó que ningún reverso trae placa/póliza/
-- chasis en este lote — ver docs/de-f0-verificacion.md). El emparejado por
-- posición (anverso+1) lo hace el CLIENTE (ve el orden real del archivo); este
-- RPC solo persiste lo que ya viene decidido.
--
--   node scripts/apply-migration.mjs sql/2026-10-30-de2-documentos-reverso.sql --env dev

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
  v_path text; v_reverso_path text;
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
      -- DE2 — 'reverso' huérfano (sin anverso en el lote): solo guarda la imagen,
      -- no toca ningún campo del vehículo.
      if v_tipo not in ('seguro','matricula','marbete_dgii','reverso') then
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

      elsif v_tipo = 'marbete_dgii' then
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

      else -- 'reverso' huérfano: nada que validar/actualizar, solo la imagen de abajo.
        v_aplicado := '{}'::jsonb;
      end if;

      -- Imagen de la página → slot de Documentos del vehículo (tipo seguro|matricula|marbete|reverso)
      v_path := nullif(v_fila->>'imagen_path','');
      if v_omitido is null and v_path is not null then
        insert into sgc.documentos (entidad, entidad_id, tipo, nombre, path, subido_por)
        values ('vehiculo', v_veh_id,
                case v_tipo when 'marbete_dgii' then 'marbete' when 'reverso' then 'reverso' else v_tipo end,
                case v_tipo
                  when 'reverso' then format('Reverso (leído por IA)')
                  else format('%s %s (leído por IA)', initcap(replace(v_tipo,'_dgii','')), coalesce(to_char(v_hasta,'YYYY'), to_char(now(),'YYYY')))
                end,
                v_path, auth.uid());
      end if;

      -- DE2/DE-05 — reverso EMPAREJADO con este anverso (viene como campo aparte,
      -- no como fila propia): segundo documento del vehículo, mismo tipo + etiqueta.
      v_reverso_path := nullif(v_fila->>'reverso_imagen_path','');
      if v_omitido is null and v_reverso_path is not null and v_tipo <> 'reverso' then
        insert into sgc.documentos (entidad, entidad_id, tipo, nombre, path, subido_por)
        values ('vehiculo', v_veh_id,
                case v_tipo when 'marbete_dgii' then 'marbete' else v_tipo end,
                format('%s %s — reverso (leído por IA)', initcap(replace(v_tipo,'_dgii','')), coalesce(to_char(v_hasta,'YYYY'), to_char(now(),'YYYY'))),
                v_reverso_path, auth.uid());
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
