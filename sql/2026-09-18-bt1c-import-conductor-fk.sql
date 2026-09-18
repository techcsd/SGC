-- BT1c — Arreglo hallado importando la factura REAL FA26463587:
-- `registros_combustible.conductor_id` referencia **`conductores`**, NO `usuarios`. La versión
-- BT1b resolvía el conductor a un `usuario_id` (del mapa de tarjeta y de `vehiculo_usos`) → 23503
-- en cada fila de persona. Fix: resolver `conductor_id` a un **`conductores.id`** real:
--   · vehículo → conductor por el uso (uso.usuario_id → `conductores.usuario_id`);
--   · tarjeta de persona → `conductores` del usuario del mapa (si el usuario no es conductor, queda null).
-- El `titular` (texto de la factura) SIEMPRE se guarda → la echada dice de quién es aunque la
-- persona no tenga ficha de conductor. `sin_asignacion` = de verdad no se pudo atar (ni vehículo
-- ni tarjeta mapeada a persona/vehículo).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-18-bt1c-import-conductor-fk.sql

begin;

create or replace function sgc.importar_echadas_conciliacion(p_conciliacion_id uuid, p_filas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0;
  v_creadas int := 0; v_kmpend int := 0; v_sinasg int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_veh uuid; v_cond uuid; v_map_usuario uuid; v_resuelto boolean;
  v_km int; v_prueba boolean;
  v_fecha date; v_gal numeric; v_monto numeric; v_precio numeric; v_factura text; v_tarjeta text;
  v_titular text; v_es_persona boolean;
  v_reg uuid;
begin
  if not sgc.es_flota_elevado() then
    raise exception 'No autorizado para importar echadas.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.conciliaciones_combustible where id = p_conciliacion_id) then
    perform sgc.error_campo('conciliacion_id', 'no_existe', 'La conciliación no existe.');
  end if;
  v_prueba := sgc.usuario_actual_es_prueba();

  for v_fila in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    begin
      v_fecha := nullif(v_fila->>'fecha','')::date;
      v_gal   := nullif(v_fila->>'galones','')::numeric;
      v_monto := nullif(v_fila->>'monto','')::numeric;
      v_precio:= nullif(v_fila->>'precio_por_galon','')::numeric;
      v_factura := nullif(btrim(v_fila->>'nro_factura'),'');
      v_tarjeta := nullif(btrim(v_fila->>'tarjeta'),'');
      v_km := nullif(v_fila->>'km','')::int;
      v_titular := nullif(btrim(v_fila->>'titular'),'');
      v_es_persona := coalesce((v_fila->>'titular_es_persona')::boolean, false);

      if v_fecha is null or v_gal is null then
        v_errores := v_errores || jsonb_build_object('i', v_i, 'motivo', 'Falta fecha o galones');
        continue;
      end if;
      if v_factura is not null and exists (
        select 1 from sgc.registros_combustible r
        where r.conciliacion_id = p_conciliacion_id and r.nro_factura = v_factura and r.importada) then
        continue;
      end if;

      -- Vehículo: explícito → mapa de tarjeta.
      v_veh := nullif(v_fila->>'vehiculo_id','')::uuid;
      v_map_usuario := null;
      if v_tarjeta is not null then
        if v_veh is null then
          select vehiculo_id into v_veh from sgc.combustible_tarjeta_map
           where codigo_tarjeta = v_tarjeta and vehiculo_id is not null limit 1;
        end if;
        select usuario_id into v_map_usuario from sgc.combustible_tarjeta_map
         where codigo_tarjeta = v_tarjeta and usuario_id is not null limit 1;
      end if;

      -- Conductor: SIEMPRE un conductores.id (o null). Vehículo → conductor del uso;
      -- tarjeta de persona → conductor del usuario mapeado (si tiene ficha).
      v_cond := null;
      if v_veh is not null then
        select c.id into v_cond
          from sgc.conductores c
          join sgc.vehiculo_usos vu on vu.usuario_id = c.usuario_id
         where vu.vehiculo_id = v_veh and vu.inicio_at::date <= v_fecha
         order by vu.inicio_at desc limit 1;
      end if;
      if v_cond is null and v_map_usuario is not null then
        select id into v_cond from sgc.conductores where usuario_id = v_map_usuario limit 1;
      end if;

      -- Resuelto = atado a un vehículo o a una persona conocida (aunque no sea conductor formal).
      v_resuelto := (v_veh is not null) or (v_map_usuario is not null);

      insert into sgc.registros_combustible (
        vehiculo_id, conductor_id, fecha, galones, monto, precio_por_galon, kilometraje,
        estacion, producto, tarjeta, titular, titular_es_persona, origen, es_prueba,
        es_prueba_origen, importada, conciliacion_id, nro_factura, km_pendiente,
        sin_asignacion, estado, tanque_lleno, alerta_consumo, registrado_por)
      values (
        v_veh, v_cond, v_fecha, v_gal, v_monto, v_precio, v_km,
        nullif(btrim(v_fila->>'estacion'),''), nullif(btrim(v_fila->>'producto'),''),
        v_tarjeta, v_titular, v_es_persona, 'estacion', v_prueba,
        'manual', true, p_conciliacion_id, v_factura, (v_km is null),
        (not v_resuelto), 'datos_insuficientes', false, false, auth.uid())
      returning id into v_reg;

      v_creadas := v_creadas + 1;
      if v_km is null then v_kmpend := v_kmpend + 1; end if;
      if not v_resuelto then v_sinasg := v_sinasg + 1; end if;

      update sgc.combustible_transacciones_proveedor
         set registro_id = v_reg
       where conciliacion_id = p_conciliacion_id and registro_id is null
         and numero_factura is not distinct from v_factura
         and fecha is not distinct from v_fecha;
    exception when others then
      v_errores := v_errores || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'), 160));
    end;
  end loop;

  if v_kmpend > 0 then
    perform sgc.notificar_modulo('flota', 'combustible_km_pendiente',
      'Echadas importadas sin kilometraje',
      format('%s echada(s) importada(s) necesitan que completes el kilometraje.', v_kmpend),
      '/flota/combustible-log');
  end if;

  return jsonb_build_object('creadas', v_creadas, 'con_km_pendiente', v_kmpend,
    'sin_asignacion', v_sinasg, 'errores', v_errores);
end;
$function$;

commit;
