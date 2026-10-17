-- CQ4 — importador de vehículos/choferes: plantilla completa (todos los campos del
-- formulario real) + "actualizar no borra" en TODOS los campos nuevos + `accion`/
-- `cambios` por fila para el modal de resultado ("qué cambió"). Reescribe
-- `importar_vehiculos`/`importar_conductores` partiendo de la definición VIVA de
-- prod (regla 19 — ver scratchpad/cq4-defs-vivas.sql), MISMA firma de función.
--
-- Xaviel: "el importador de vehículos y choferes deja casi todo sin mapear y la
-- plantilla no tiene todos los campos del formulario real". Ronda CQ4, inciso e/f.
--
-- Aditiva y retrocompatible: mismos nombres/tipos de parámetros (p_filas jsonb,
-- p_importacion_id uuid), mismas claves de resultado (nuevos/actualizados/errores/
-- filas) + 2 claves nuevas por fila en `filas[]`: `accion` ('creado'|'actualizado')
-- y `cambios` (jsonb, solo poblado en 'actualizado').
--
-- Apply: node scripts/apply-migration.mjs sql/2026-10-16-cq4-importar-vehiculos-conductores-campos.sql --env dev --yes

begin;

-- Helper: número tolerante a separador de miles ("12,345" / "12 345" → 12345).
-- El cliente (importador.service.ts `normNumero`) ya limpia esto antes de llamar
-- al RPC, pero el RPC no debe depender SOLO del cliente (defensa en profundidad —
-- cualquier llamada directa al RPC con una coma debe seguir funcionando).
create or replace function sgc._importar_numero(p text)
 returns numeric language sql immutable
as $function$
  select nullif(regexp_replace(btrim(coalesce(p,'')), '[,\s]', '', 'g'), '')::numeric
$function$;
grant execute on function sgc._importar_numero(text) to authenticated, service_role;

-- ============================================================================
-- sgc.importar_vehiculos — todos los campos del formulario real (vehiculos.html)
-- ============================================================================
create or replace function sgc.importar_vehiculos(p_filas jsonb, p_importacion_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_filas jsonb := '[]'::jsonb;
  v_placa text; v_id uuid; v_prueba boolean := sgc.usuario_actual_es_prueba(); v_anio int;
  v_antes jsonb; v_desp sgc.vehiculos%rowtype; v_cambios jsonb; v_accion text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  for v_fila in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_placa := upper(regexp_replace(coalesce(v_fila->>'placa',''), '[^A-Za-z0-9]', '', 'g'));
      if v_placa = '' then v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta placa'); continue; end if;
      v_anio := coalesce(nullif(btrim(v_fila->>'anio'),'')::int, extract(year from now())::int);
      select id into v_id from sgc.vehiculos where upper(regexp_replace(placa,'[^A-Za-z0-9]','','g')) = v_placa limit 1;

      if v_id is null then
        insert into sgc.vehiculos (
          placa, marca, modelo, anio, color, tipo, estado, uso, medida_uso,
          kilometraje, capacidad_valor, capacidad_unidad,
          numero_matricula, vencimiento_matricula, numero_seguro, aseguradora, vencimiento_seguro,
          km_ultimo_mantenimiento, intervalo_mantenimiento_km, intervalo_mantenimiento_horas,
          rendimiento_esperado_km_gal, notas, vin, alias, odoo_ref,
          activo, es_prueba, importacion_id
        ) values (
          coalesce(nullif(btrim(v_fila->>'placa'),''), v_placa),
          coalesce(nullif(btrim(v_fila->>'marca'),''), 'N/D'),
          coalesce(nullif(btrim(v_fila->>'modelo'),''), 'N/D'),
          v_anio,
          nullif(btrim(v_fila->>'color'),''),
          coalesce(nullif(btrim(v_fila->>'tipo'),''), 'vehiculo'),
          coalesce(nullif(btrim(v_fila->>'estado'),''), 'activo'),
          coalesce(nullif(btrim(v_fila->>'uso'),''), 'obra'),
          coalesce(nullif(btrim(v_fila->>'medida_uso'),''), 'km'),
          coalesce(sgc._importar_numero(v_fila->>'kilometraje')::integer, 0),
          sgc._importar_numero(v_fila->>'capacidad_valor'),
          nullif(btrim(v_fila->>'capacidad_unidad'),''),
          nullif(btrim(v_fila->>'numero_matricula'),''),
          nullif(btrim(v_fila->>'vencimiento_matricula'),'')::date,
          nullif(btrim(v_fila->>'numero_seguro'),''),
          nullif(btrim(v_fila->>'aseguradora'),''),
          nullif(btrim(v_fila->>'vencimiento_seguro'),'')::date,
          sgc._importar_numero(v_fila->>'km_ultimo_mantenimiento')::integer,
          coalesce(sgc._importar_numero(v_fila->>'intervalo_mantenimiento_km')::integer, 5000),
          sgc._importar_numero(v_fila->>'intervalo_mantenimiento_horas')::integer,
          sgc._importar_numero(v_fila->>'rendimiento_esperado_km_gal'),
          nullif(btrim(v_fila->>'notas'),''),
          nullif(btrim(v_fila->>'vin'),''),
          nullif(btrim(v_fila->>'alias'),''),
          nullif(btrim(v_fila->>'odoo_ref'),''),
          true,
          case when v_fila ? 'es_prueba' then (v_fila->>'es_prueba')::boolean else v_prueba end,
          p_importacion_id
        ) returning id into v_id;
        v_nuevos := v_nuevos + 1;
        v_accion := 'creado';
        v_cambios := '{}'::jsonb;
      else
        select row_to_json(v)::jsonb into v_antes from sgc.vehiculos v where id = v_id;

        update sgc.vehiculos set
          marca = coalesce(nullif(btrim(v_fila->>'marca'),''), marca),
          modelo = coalesce(nullif(btrim(v_fila->>'modelo'),''), modelo),
          color = coalesce(nullif(btrim(v_fila->>'color'),''), color),
          tipo = coalesce(nullif(btrim(v_fila->>'tipo'),''), tipo),
          estado = coalesce(nullif(btrim(v_fila->>'estado'),''), estado),
          uso = coalesce(nullif(btrim(v_fila->>'uso'),''), uso),
          medida_uso = coalesce(nullif(btrim(v_fila->>'medida_uso'),''), medida_uso),
          kilometraje = coalesce(sgc._importar_numero(v_fila->>'kilometraje')::integer, kilometraje),
          capacidad_valor = coalesce(sgc._importar_numero(v_fila->>'capacidad_valor'), capacidad_valor),
          capacidad_unidad = coalesce(nullif(btrim(v_fila->>'capacidad_unidad'),''), capacidad_unidad),
          numero_matricula = coalesce(nullif(btrim(v_fila->>'numero_matricula'),''), numero_matricula),
          vencimiento_matricula = coalesce(nullif(btrim(v_fila->>'vencimiento_matricula'),'')::date, vencimiento_matricula),
          numero_seguro = coalesce(nullif(btrim(v_fila->>'numero_seguro'),''), numero_seguro),
          aseguradora = coalesce(nullif(btrim(v_fila->>'aseguradora'),''), aseguradora),
          vencimiento_seguro = coalesce(nullif(btrim(v_fila->>'vencimiento_seguro'),'')::date, vencimiento_seguro),
          km_ultimo_mantenimiento = coalesce(sgc._importar_numero(v_fila->>'km_ultimo_mantenimiento')::integer, km_ultimo_mantenimiento),
          intervalo_mantenimiento_km = coalesce(sgc._importar_numero(v_fila->>'intervalo_mantenimiento_km')::integer, intervalo_mantenimiento_km),
          intervalo_mantenimiento_horas = coalesce(sgc._importar_numero(v_fila->>'intervalo_mantenimiento_horas')::integer, intervalo_mantenimiento_horas),
          rendimiento_esperado_km_gal = coalesce(sgc._importar_numero(v_fila->>'rendimiento_esperado_km_gal'), rendimiento_esperado_km_gal),
          notas = coalesce(nullif(btrim(v_fila->>'notas'),''), notas),
          vin = coalesce(nullif(btrim(v_fila->>'vin'),''), vin),
          alias = coalesce(nullif(btrim(v_fila->>'alias'),''), alias),
          odoo_ref = coalesce(nullif(btrim(v_fila->>'odoo_ref'),''), odoo_ref),
          es_prueba = case when v_fila ? 'es_prueba' then (v_fila->>'es_prueba')::boolean else es_prueba end
        where id = v_id
        returning * into v_desp;

        v_cambios := '{}'::jsonb;
        if coalesce(v_antes->'marca','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.marca),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('marca', jsonb_build_object('antes', v_antes->>'marca', 'despues', v_desp.marca)); end if;
        if coalesce(v_antes->'modelo','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.modelo),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('modelo', jsonb_build_object('antes', v_antes->>'modelo', 'despues', v_desp.modelo)); end if;
        if coalesce(v_antes->'color','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.color),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('color', jsonb_build_object('antes', v_antes->>'color', 'despues', v_desp.color)); end if;
        if coalesce(v_antes->'tipo','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.tipo),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('tipo', jsonb_build_object('antes', v_antes->>'tipo', 'despues', v_desp.tipo)); end if;
        if coalesce(v_antes->'estado','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.estado),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('estado', jsonb_build_object('antes', v_antes->>'estado', 'despues', v_desp.estado)); end if;
        if coalesce(v_antes->'uso','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.uso),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('uso', jsonb_build_object('antes', v_antes->>'uso', 'despues', v_desp.uso)); end if;
        if coalesce(v_antes->'medida_uso','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.medida_uso),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('medida_uso', jsonb_build_object('antes', v_antes->>'medida_uso', 'despues', v_desp.medida_uso)); end if;
        if coalesce(v_antes->'kilometraje','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.kilometraje),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('kilometraje', jsonb_build_object('antes', v_antes->>'kilometraje', 'despues', v_desp.kilometraje)); end if;
        if coalesce(v_antes->'capacidad_valor','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.capacidad_valor),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('capacidad_valor', jsonb_build_object('antes', v_antes->>'capacidad_valor', 'despues', v_desp.capacidad_valor)); end if;
        if coalesce(v_antes->'capacidad_unidad','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.capacidad_unidad),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('capacidad_unidad', jsonb_build_object('antes', v_antes->>'capacidad_unidad', 'despues', v_desp.capacidad_unidad)); end if;
        if coalesce(v_antes->'numero_matricula','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.numero_matricula),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('numero_matricula', jsonb_build_object('antes', v_antes->>'numero_matricula', 'despues', v_desp.numero_matricula)); end if;
        if coalesce(v_antes->'vencimiento_matricula','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.vencimiento_matricula),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('vencimiento_matricula', jsonb_build_object('antes', v_antes->>'vencimiento_matricula', 'despues', v_desp.vencimiento_matricula::text)); end if;
        if coalesce(v_antes->'numero_seguro','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.numero_seguro),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('numero_seguro', jsonb_build_object('antes', v_antes->>'numero_seguro', 'despues', v_desp.numero_seguro)); end if;
        if coalesce(v_antes->'aseguradora','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.aseguradora),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('aseguradora', jsonb_build_object('antes', v_antes->>'aseguradora', 'despues', v_desp.aseguradora)); end if;
        if coalesce(v_antes->'vencimiento_seguro','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.vencimiento_seguro),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('vencimiento_seguro', jsonb_build_object('antes', v_antes->>'vencimiento_seguro', 'despues', v_desp.vencimiento_seguro::text)); end if;
        if coalesce(v_antes->'km_ultimo_mantenimiento','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.km_ultimo_mantenimiento),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('km_ultimo_mantenimiento', jsonb_build_object('antes', v_antes->>'km_ultimo_mantenimiento', 'despues', v_desp.km_ultimo_mantenimiento)); end if;
        if coalesce(v_antes->'intervalo_mantenimiento_km','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.intervalo_mantenimiento_km),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('intervalo_mantenimiento_km', jsonb_build_object('antes', v_antes->>'intervalo_mantenimiento_km', 'despues', v_desp.intervalo_mantenimiento_km)); end if;
        if coalesce(v_antes->'intervalo_mantenimiento_horas','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.intervalo_mantenimiento_horas),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('intervalo_mantenimiento_horas', jsonb_build_object('antes', v_antes->>'intervalo_mantenimiento_horas', 'despues', v_desp.intervalo_mantenimiento_horas)); end if;
        if coalesce(v_antes->'rendimiento_esperado_km_gal','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.rendimiento_esperado_km_gal),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('rendimiento_esperado_km_gal', jsonb_build_object('antes', v_antes->>'rendimiento_esperado_km_gal', 'despues', v_desp.rendimiento_esperado_km_gal)); end if;
        if coalesce(v_antes->'notas','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.notas),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('notas', jsonb_build_object('antes', v_antes->>'notas', 'despues', v_desp.notas)); end if;
        if coalesce(v_antes->'vin','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.vin),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('vin', jsonb_build_object('antes', v_antes->>'vin', 'despues', v_desp.vin)); end if;
        if coalesce(v_antes->'alias','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.alias),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('alias', jsonb_build_object('antes', v_antes->>'alias', 'despues', v_desp.alias)); end if;
        if coalesce(v_antes->'odoo_ref','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.odoo_ref),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('odoo_ref', jsonb_build_object('antes', v_antes->>'odoo_ref', 'despues', v_desp.odoo_ref)); end if;
        if coalesce(v_antes->'es_prueba','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.es_prueba),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('es_prueba', jsonb_build_object('antes', v_antes->>'es_prueba', 'despues', v_desp.es_prueba)); end if;

        v_act := v_act + 1;
        v_accion := 'actualizado';
      end if;
      v_filas := v_filas || jsonb_build_object('i', v_i, 'id', v_id, 'accion', v_accion, 'cambios', v_cambios);
    exception when others then
      v_err := v_err || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'),160));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_err, 'filas', v_filas);
end;
$function$;
grant execute on function sgc.importar_vehiculos(jsonb, uuid) to authenticated, service_role;

-- ============================================================================
-- sgc.importar_conductores — + vehiculo_id (por placa), tags, activo
-- ============================================================================
create or replace function sgc.importar_conductores(p_filas jsonb, p_importacion_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_filas jsonb := '[]'::jsonb;
  v_cedula text; v_id uuid; v_prueba boolean := sgc.usuario_actual_es_prueba();
  v_tipo_veh text; v_placa_veh text; v_vehiculo_id uuid; v_tags_raw text; v_tags text[];
  v_antes jsonb; v_desp sgc.conductores%rowtype; v_cambios jsonb; v_accion text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  for v_fila in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_cedula := regexp_replace(coalesce(v_fila->>'cedula',''), '[^0-9]', '', 'g');
      if v_cedula = '' then v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta cédula'); continue; end if;
      if nullif(btrim(v_fila->>'nombre'),'') is null then
        v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta nombre'); continue;
      end if;
      v_tipo_veh := nullif(btrim(v_fila->>'tipo_vehiculo_autorizado'),'');
      if v_tipo_veh is not null and v_tipo_veh not in ('Liviano','Pesado','Ambos') then v_tipo_veh := 'Ambos'; end if;

      -- CQ4-f — vehículo asignado: el Excel trae la PLACA, se resuelve a id aquí.
      v_vehiculo_id := null;
      v_placa_veh := nullif(btrim(v_fila->>'vehiculo_id'),'');
      if v_placa_veh is not null then
        select id into v_vehiculo_id from sgc.vehiculos
          where upper(regexp_replace(placa,'[^A-Za-z0-9]','','g')) = upper(regexp_replace(v_placa_veh,'[^A-Za-z0-9]','','g'))
          limit 1;
      end if;

      -- CQ4-f — tags: "Chofer, Supervisor" → text[] (vacíos descartados). NULL si no
      -- vino la columna (no se toca en update); array vacío si vino pero en blanco.
      v_tags := null;
      v_tags_raw := null;
      if v_fila ? 'tags' then
        v_tags_raw := coalesce(v_fila->>'tags', '');
        select coalesce(array_agg(t) filter (where t is not null and t <> ''), '{}')
          into v_tags
          from (select nullif(btrim(x), '') as t from unnest(string_to_array(v_tags_raw, ',')) as x) s;
      end if;

      select id into v_id from sgc.conductores where regexp_replace(cedula,'[^0-9]','','g') = v_cedula limit 1;
      if v_id is null then
        insert into sgc.conductores (
          cedula, nombre, telefono, licencia_tipo, licencia_numero, licencia_vencimiento,
          tipo_vehiculo_autorizado, nota, vehiculo_id, tags, activo, es_prueba, importacion_id)
        values (
          coalesce(nullif(btrim(v_fila->>'cedula'),''), v_cedula),
          btrim(v_fila->>'nombre'),
          nullif(btrim(v_fila->>'telefono'),''),
          coalesce(nullif(btrim(v_fila->>'licencia_tipo'),''), '02'),
          nullif(btrim(v_fila->>'licencia_numero'),''),
          nullif(btrim(v_fila->>'licencia_vencimiento'),'')::date,
          coalesce(v_tipo_veh, 'Ambos'),
          nullif(btrim(v_fila->>'nota'),''),
          v_vehiculo_id,
          v_tags,
          case when v_fila ? 'activo' then (v_fila->>'activo')::boolean else true end,
          v_prueba, p_importacion_id)
        returning id into v_id;
        v_nuevos := v_nuevos + 1;
        v_accion := 'creado';
        v_cambios := '{}'::jsonb;
      else
        select row_to_json(c)::jsonb into v_antes from sgc.conductores c where id = v_id;

        update sgc.conductores set
          nombre = coalesce(nullif(btrim(v_fila->>'nombre'),''), nombre),
          telefono = coalesce(nullif(btrim(v_fila->>'telefono'),''), telefono),
          licencia_tipo = coalesce(nullif(btrim(v_fila->>'licencia_tipo'),''), licencia_tipo),
          licencia_numero = coalesce(nullif(btrim(v_fila->>'licencia_numero'),''), licencia_numero),
          licencia_vencimiento = coalesce(nullif(btrim(v_fila->>'licencia_vencimiento'),'')::date, licencia_vencimiento),
          tipo_vehiculo_autorizado = coalesce(v_tipo_veh, tipo_vehiculo_autorizado),
          nota = coalesce(nullif(btrim(v_fila->>'nota'),''), nota),
          vehiculo_id = coalesce(v_vehiculo_id, vehiculo_id),
          tags = coalesce(v_tags, tags),
          activo = case when v_fila ? 'activo' then (v_fila->>'activo')::boolean else activo end
        where id = v_id
        returning * into v_desp;

        v_cambios := '{}'::jsonb;
        if coalesce(v_antes->'nombre','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.nombre),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('nombre', jsonb_build_object('antes', v_antes->>'nombre', 'despues', v_desp.nombre)); end if;
        if coalesce(v_antes->'telefono','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.telefono),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('telefono', jsonb_build_object('antes', v_antes->>'telefono', 'despues', v_desp.telefono)); end if;
        if coalesce(v_antes->'licencia_tipo','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.licencia_tipo),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('licencia_tipo', jsonb_build_object('antes', v_antes->>'licencia_tipo', 'despues', v_desp.licencia_tipo)); end if;
        if coalesce(v_antes->'licencia_numero','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.licencia_numero),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('licencia_numero', jsonb_build_object('antes', v_antes->>'licencia_numero', 'despues', v_desp.licencia_numero)); end if;
        if coalesce(v_antes->'licencia_vencimiento','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.licencia_vencimiento),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('licencia_vencimiento', jsonb_build_object('antes', v_antes->>'licencia_vencimiento', 'despues', v_desp.licencia_vencimiento::text)); end if;
        if coalesce(v_antes->'tipo_vehiculo_autorizado','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.tipo_vehiculo_autorizado),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('tipo_vehiculo_autorizado', jsonb_build_object('antes', v_antes->>'tipo_vehiculo_autorizado', 'despues', v_desp.tipo_vehiculo_autorizado)); end if;
        if coalesce(v_antes->'nota','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.nota),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('nota', jsonb_build_object('antes', v_antes->>'nota', 'despues', v_desp.nota)); end if;
        if coalesce(v_antes->'vehiculo_id','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.vehiculo_id),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('vehiculo_id', jsonb_build_object('antes', v_antes->>'vehiculo_id', 'despues', v_desp.vehiculo_id::text)); end if;
        if coalesce(v_antes->'tags','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.tags),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('tags', jsonb_build_object('antes', array_to_string(coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_antes->'tags','[]'::jsonb)) x),'{}'),', '), 'despues', array_to_string(coalesce(v_desp.tags,'{}'),', '))); end if;
        if coalesce(v_antes->'activo','null'::jsonb) is distinct from coalesce(to_jsonb(v_desp.activo),'null'::jsonb) then v_cambios := v_cambios || jsonb_build_object('activo', jsonb_build_object('antes', v_antes->>'activo', 'despues', v_desp.activo)); end if;

        v_act := v_act + 1;
        v_accion := 'actualizado';
      end if;
      v_filas := v_filas || jsonb_build_object('i', v_i, 'id', v_id, 'accion', v_accion, 'cambios', v_cambios);
    exception when others then
      v_err := v_err || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'),160));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_err, 'filas', v_filas);
end;
$function$;
grant execute on function sgc.importar_conductores(jsonb, uuid) to authenticated, service_role;

commit;
