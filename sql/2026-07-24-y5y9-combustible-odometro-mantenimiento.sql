-- ============================================================================
-- PROMPT-21 · FASE 1 (Y5) + FASE 3 (Y9) — 2026-07-24
-- Una sola fuente de verdad para el kilometraje: el ODÓMETRO (vehiculos.kilometraje).
-- Aditivo/idempotente. Aplicado a prod vía Management API.
--
-- Evidencia del dato corrupto (FASE 1.1):
--   D-Max AB2890340 (id f7bf4913-4357-4c96-a54b-6f87b94c6263): odómetro real = 24 258 km.
--   Echada 55066361-8660-4dbd-822b-d6d514a282ed: km=49 000, SIN galones, fecha 2026-07-03,
--   conductor "TEST Conductor Prueba" (cédula TEST-000-0000000-0) → dato de QA capturado
--   directo por SQL (no vía RPC: km_anterior/km_recorridos/galones NULL). es_prueba=false,
--   por eso contaminaba la validación de no-retroceso (max echada 49 000 bloqueaba echadas
--   reales de ~24 3xx). Se aísla como es_prueba (RLS lo oculta a no-admin y las referencias
--   lo excluyen). El odómetro nunca subió a 49 000 porque avanzar_odometro (P7) solo corre
--   desde el RPC.
--   Mantenimiento (FASE 3): D-Max km_ultimo_mantenimiento=50 000 (mant. preventivo km 50 000,
--   fecha FUTURA 2026-07-30 = QA) y Amarok Z3028392 km_ultimo=50 067 (backfill previo de una
--   'falla' km 50 067 > odómetro 49 800). El "faltan 30 742 km" = 50 000 + 5 000 − 24 258.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- FASE 1.2 — registrar_combustible_app: validar contra el ODÓMETRO, no contra
-- la última echada. km_anterior (para rendimiento/costo-km) excluye es_prueba
-- y usa los mismos filtros que la UI. Error estructurado cita el odómetro (1.5).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sgc.registrar_combustible_app(p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date, p_kilometraje integer, p_galones numeric, p_monto numeric, p_estacion text DEFAULT NULL::text, p_foto_recibo_path text DEFAULT NULL::text, p_foto_tablero_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_id           uuid;
  v_odometro     int;                -- Y5 — fuente de verdad = vehiculos.kilometraje
  v_km_anterior  int;                -- última echada REAL (para km_recorridos/rendimiento)
  v_km_recorridos int;
  v_precio       numeric;
  v_rendimiento  numeric;
  v_costo_km     numeric;
  v_prom         numeric;
  v_n_prev       int;
  v_umbral       numeric;
  v_esperado     numeric;
  v_prom_flota   numeric;
  v_piso         numeric;
  v_ref_valor    numeric;
  v_ref_tipo     text;
  v_alerta       boolean := false;
  v_motivo       text;
  v_placa        text;
  v_es_prueba    boolean := false;   -- W7 — suprimir aviso real de vehículo test
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;
  select coalesce(es_prueba, false), coalesce(kilometraje, 0)
    into v_es_prueba, v_odometro
    from sgc.vehiculos where id = p_vehiculo_id;

  if coalesce(p_kilometraje, 0) <= 0 then raise exception 'El kilometraje debe ser mayor que 0'; end if;
  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if coalesce(p_monto, 0)   <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  -- Y5 — no-retroceso contra el ODÓMETRO (la cifra que el usuario VE en la web/app).
  if p_kilometraje < v_odometro then
    raise exception 'El kilometraje (% km) no puede ser menor al odómetro actual del vehículo (% km).',
      p_kilometraje, v_odometro
      using errcode = '23514';
  end if;

  -- km_anterior para rendimiento/costo-km = última echada REAL (excluye es_prueba, = UI).
  select max(kilometraje) into v_km_anterior
    from sgc.registros_combustible
   where vehiculo_id = p_vehiculo_id and kilometraje is not null
     and coalesce(es_prueba, false) = false;

  v_precio := round(p_monto / p_galones, 2);

  if v_km_anterior is not null then
    v_km_recorridos := p_kilometraje - v_km_anterior;
    if v_km_recorridos > 0 then
      v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
      v_costo_km    := round(p_monto / v_km_recorridos, 2);
    end if;
  end if;

  select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

  -- Promedios de referencia excluyen datos de prueba (DEFINER bypasea RLS).
  select count(*), avg(rendimiento_km_gal)
    into v_n_prev, v_prom
    from sgc.registros_combustible
   where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null
     and coalesce(es_prueba, false) = false;

  select avg(rendimiento_km_gal) into v_prom_flota
    from sgc.registros_combustible
   where rendimiento_km_gal is not null
     and coalesce(es_prueba, false) = false;

  select valor into v_umbral from sgc.flota_config where clave = 'umbral_consumo_pct';
  v_umbral := coalesce(v_umbral, 20);

  select valor into v_piso from sgc.flota_config where clave = 'rendimiento_minimo_km_gal';
  v_piso := coalesce(v_piso, 10);

  if v_rendimiento is not null and coalesce(v_km_recorridos, 0) > 0 then
    if v_esperado is not null and v_esperado > 0
       and v_rendimiento < (1 - v_umbral / 100.0) * v_esperado then
      v_alerta := true; v_ref_tipo := 'esperado'; v_ref_valor := v_esperado;
    elsif v_n_prev >= 3 and v_prom is not null
       and v_rendimiento < (1 - v_umbral / 100.0) * v_prom then
      v_alerta := true; v_ref_tipo := 'propio'; v_ref_valor := v_prom;
    end if;

    if v_rendimiento < v_piso then
      v_alerta := true;
      if v_ref_tipo is null then v_ref_tipo := 'piso'; v_ref_valor := v_piso; end if;
    end if;

    if v_alerta then
      v_motivo := case v_ref_tipo
        when 'esperado' then format('Rinde %s km/gal, %s%% bajo el rendimiento esperado (%s km/gal).',
          v_rendimiento, round((1 - v_rendimiento / nullif(v_ref_valor,0)) * 100), round(v_ref_valor,2))
        when 'propio' then format('Rinde %s km/gal, %s%% bajo el promedio del vehículo (%s km/gal).',
          v_rendimiento, round((1 - v_rendimiento / nullif(v_ref_valor,0)) * 100), round(v_ref_valor,2))
        else format('Rendimiento imposiblemente bajo: %s km/gal (mínimo coherente %s km/gal).',
          v_rendimiento, round(v_piso,2))
      end;
    end if;
  end if;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, alerta_consumo, motivo_alerta, client_uuid
  ) values (
    v_id, p_vehiculo_id, p_conductor_id, coalesce(p_fecha, current_date), p_kilometraje,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), v_alerta, v_motivo, p_client_uuid
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

  -- Aviso/notificación real SOLO si el vehículo NO es de prueba (W7).
  if v_alerta and not v_es_prueba then
    select placa into v_placa from sgc.vehiculos where id = p_vehiculo_id;
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
      format('Consumo anormal en %s: %s Posible fuga, problema mecánico o combustible desviado.',
        coalesce(v_placa,'vehículo'), v_motivo),
      'alta');
    perform sgc.notificar_modulo('flota', 'warning',
      'Consumo anormal de combustible',
      format('%s: %s', coalesce(v_placa,'Un vehículo'), v_motivo),
      '/flota/combustible');
  end if;

  return jsonb_build_object(
    'id', v_id,
    'precio_por_galon', v_precio,
    'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos,
    'rendimiento_km_gal', v_rendimiento,
    'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'motivo_alerta', v_motivo,
    'promedio_rendimiento', case when v_n_prev >= 3 then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- FASE 1.3 — sanear la echada corrupta del D-Max (aislarla como dato de prueba).
-- No se toca el conductor TEST (tiene rutas en vehículos REALES; marcarlo en
-- cascada ocultaría datos reales). Solo la echada malformada.
-- ─────────────────────────────────────────────────────────────────────────
update sgc.registros_combustible
   set es_prueba = true, es_prueba_origen = 'manual'
 where id = '55066361-8660-4dbd-822b-d6d514a282ed'
   and coalesce(es_prueba, false) = false;

-- ═════════════════════════════════════════════════════════════════════════
-- FASE 3 (Y9) — coherencia de km_ultimo_mantenimiento (≤ odómetro).
-- ═════════════════════════════════════════════════════════════════════════

-- 3.1 — Guard de coherencia en vehiculos: km_ultimo_mantenimiento nunca > odómetro.
CREATE OR REPLACE FUNCTION sgc.tg_vehiculo_km_coherencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
begin
  if NEW.km_ultimo_mantenimiento is not null
     and NEW.kilometraje is not null
     and NEW.km_ultimo_mantenimiento > NEW.kilometraje then
    raise exception 'El km del último mantenimiento (% km) no puede ser mayor al odómetro del vehículo (% km).',
      NEW.km_ultimo_mantenimiento, NEW.kilometraje
      using errcode = '23514';
  end if;
  return NEW;
end;
$function$;

-- 3.2 — Sweep: recomputar km_ultimo_mantenimiento con la regla coherente para
-- TODO vehículo incoherente (solo preventivo/incluye_preventivo, no prueba,
-- completado, y km ≤ odómetro). D-Max y Amarok → NULL (sin mant. válido ≤ odómetro).
update sgc.vehiculos v
   set km_ultimo_mantenimiento = (
         select max(m.kilometraje_al_mantenimiento)
           from sgc.mantenimientos m
          where m.vehiculo_id = v.id
            and m.estado = 'completado'
            and (m.tipo = 'preventivo' or coalesce(m.incluye_preventivo, false))
            and coalesce(m.es_prueba, false) = false
            and m.kilometraje_al_mantenimiento <= coalesce(v.kilometraje, m.kilometraje_al_mantenimiento)
       ),
       updated_at = now()
 where v.km_ultimo_mantenimiento is not null
   and v.kilometraje is not null
   and v.km_ultimo_mantenimiento > v.kilometraje;

-- Guard AFTER del sweep (evita rechazar el propio UPDATE de saneo si algo quedara alto).
DROP TRIGGER IF EXISTS trg_vehiculo_km_coherencia ON sgc.vehiculos;
CREATE TRIGGER trg_vehiculo_km_coherencia
  BEFORE INSERT OR UPDATE ON sgc.vehiculos
  FOR EACH ROW EXECUTE FUNCTION sgc.tg_vehiculo_km_coherencia();

-- 3.1 — trigger de mantenimiento: solo mueve el ciclo cuando el km del mant.
-- es COHERENTE con el odómetro (≤ kilometraje). Nunca genera km_ultimo > odómetro.
CREATE OR REPLACE FUNCTION sgc.tg_mant_km_ultimo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare v_odo int;
begin
  if NEW.estado = 'completado'
     and (NEW.tipo = 'preventivo' or coalesce(NEW.incluye_preventivo, false))
     and NEW.kilometraje_al_mantenimiento is not null then

    select kilometraje into v_odo from sgc.vehiculos where id = NEW.vehiculo_id;

    -- Y9 — solo cuando el km del mantenimiento es ≤ odómetro (coherente).
    if NEW.kilometraje_al_mantenimiento::int <= coalesce(v_odo, NEW.kilometraje_al_mantenimiento::int) then
      -- X5 — tomar el más reciente (mayor km); no pisar con retroactivos menores.
      update sgc.vehiculos
         set km_ultimo_mantenimiento = greatest(coalesce(km_ultimo_mantenimiento, 0), NEW.kilometraje_al_mantenimiento::int),
             updated_at = now()
       where id = NEW.vehiculo_id
         and coalesce(km_ultimo_mantenimiento, 0) < NEW.kilometraje_al_mantenimiento::int;

      -- X2 — auto-resolver los avisos de mantenimiento pendientes del vehículo.
      update sgc.avisos_flota
         set estado='resuelto_auto', resuelto_at=now(),
             resuelto_nota=coalesce(resuelto_nota, 'Mantenimiento preventivo registrado a '||NEW.kilometraje_al_mantenimiento||' km')
       where vehiculo_id = NEW.vehiculo_id and estado='pendiente'
         and tipo in ('mantenimiento_vencido','pre_cita');
    end if;
  end if;
  return NEW;
end;
$function$;

-- 3.1 — completar_mantenimiento: avanzar el odómetro ANTES de completar, para que
-- el trigger vea el odómetro ya actualizado y el ciclo quede coherente (km_ultimo ≤ odómetro).
CREATE OR REPLACE FUNCTION sgc.completar_mantenimiento(p_id uuid, p_km integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare v_veh uuid; v_km int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then raise exception 'No autorizado'; end if;

  select vehiculo_id, coalesce(p_km, kilometraje_al_mantenimiento)
    into v_veh, v_km
  from sgc.mantenimientos where id = p_id;
  if v_veh is null then raise exception 'Mantenimiento no encontrado'; end if;

  -- P7 — el km del mantenimiento avanza el odómetro real (no retrocede) ANTES de
  -- completar, para que trg_mant_km_ultimo vea el odómetro ya avanzado.
  if v_km is not null then
    perform sgc.avanzar_odometro(v_veh, v_km);
  end if;

  -- Al pasar a 'completado' el trigger trg_mant_km_ultimo actualiza el ciclo
  -- (solo si es preventivo/incluye_preventivo y km ≤ odómetro) y auto-resuelve avisos.
  update sgc.mantenimientos
     set estado = 'completado',
         kilometraje_al_mantenimiento = coalesce(p_km, kilometraje_al_mantenimiento)
   where id = p_id;
end;
$function$;

-- 3.3 — Contrato defensivo: detectar/avisar km_ultimo_mantenimiento incoherente.
-- Emite un aviso a flota (dedup por vehículo) para cualquier vehículo cuyo dato
-- quede incoherente por cualquier vía. X2 lo resolverá cuando se corrija.
ALTER TABLE sgc.avisos_flota DROP CONSTRAINT IF EXISTS avisos_flota_tipo_chk;
ALTER TABLE sgc.avisos_flota ADD CONSTRAINT avisos_flota_tipo_chk CHECK (tipo = ANY (ARRAY[
  'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido','consumo_anormal',
  'licencia','matricula','seguro','reporte_semanal','conciliacion',
  'licencia_por_vencer','licencia_vencida','matricula_por_vencer','matricula_vencida',
  'seguro_por_vencer','seguro_vencida','mantenimiento_por_revisar']));

CREATE OR REPLACE FUNCTION sgc.detectar_mantenimiento_incoherente()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare v_list jsonb;
begin
  -- Aviso dedup por vehículo (solo si no hay uno pendiente ya).
  insert into sgc.avisos_flota (tipo, vehiculo_id, referencia_id, mensaje, severidad, dedup_key, es_prueba)
  select 'mantenimiento_por_revisar', v.id, v.id,
         format('Dato de mantenimiento por revisar en %s: último mant. %s km supera el odómetro (%s km).',
                v.placa, v.km_ultimo_mantenimiento, v.kilometraje),
         'media', 'mantrev:'||v.id::text, coalesce(v.es_prueba, false)
    from sgc.vehiculos v
   where v.km_ultimo_mantenimiento is not null and v.kilometraje is not null
     and v.km_ultimo_mantenimiento > v.kilometraje
     and not exists (select 1 from sgc.avisos_flota a
                      where a.tipo='mantenimiento_por_revisar' and a.vehiculo_id=v.id and a.estado='pendiente');

  select coalesce(jsonb_agg(jsonb_build_object(
           'placa', placa, 'km_ultimo_mantenimiento', km_ultimo_mantenimiento, 'odometro', kilometraje)), '[]'::jsonb)
    into v_list
    from sgc.vehiculos
   where km_ultimo_mantenimiento is not null and kilometraje is not null
     and km_ultimo_mantenimiento > kilometraje;
  return v_list;  -- [] tras el sweep
end;
$function$;

GRANT EXECUTE ON FUNCTION sgc.detectar_mantenimiento_incoherente() TO authenticated;

-- 3.3 — Vista de stats: exponer mantenimiento_por_revisar y ocultar el cálculo
-- "próximo mantenimiento" (base de "faltan X km") cuando el dato es incoherente.
CREATE OR REPLACE VIEW sgc.v_vehiculo_stats AS
 SELECT v.id AS vehiculo_id,
    v.placa,
    v.kilometraje AS km_actual,
    COALESCE(fc.n_echadas, 0::bigint) AS combustible_echadas,
    COALESCE(fc.total_galones, 0::numeric) AS combustible_galones,
    COALESCE(fc.total_monto, 0::numeric) AS combustible_monto,
    fc.rendimiento_promedio,
    fc.costo_por_km_promedio,
    fc.ultima_echada,
    COALESCE(ck.n_checklists, 0::bigint) AS checklists_total,
    COALESCE(ck.n_bloqueos, 0::bigint) AS checklists_bloqueos,
    ck.ultimo_checklist,
    COALESCE(mt.n_mantenimientos, 0::bigint) AS mantenimientos_total,
    mt.ultimo_mantenimiento,
    v.km_ultimo_mantenimiento,
        CASE
            WHEN v.km_ultimo_mantenimiento IS NOT NULL
             AND (v.kilometraje IS NULL OR v.km_ultimo_mantenimiento <= v.kilometraje)
              THEN v.km_ultimo_mantenimiento + COALESCE(v.intervalo_mantenimiento_km, 5000)
            ELSE NULL::integer
        END AS proximo_mantenimiento_km,
    COALESCE(asg.n_activas, 0::bigint) AS asignaciones_activas,
    GREATEST(fc.ultima_echada, ck.ultimo_checklist, mt.ultimo_mantenimiento) AS ultima_actividad,
    -- Y9 3.3 — flag defensivo (columna nueva al final para CREATE OR REPLACE VIEW).
    (v.km_ultimo_mantenimiento IS NOT NULL AND v.kilometraje IS NOT NULL
       AND v.km_ultimo_mantenimiento > v.kilometraje) AS mantenimiento_por_revisar
   FROM sgc.vehiculos v
     LEFT JOIN ( SELECT registros_combustible.vehiculo_id,
            count(*) AS n_echadas,
            sum(registros_combustible.galones) AS total_galones,
            sum(registros_combustible.monto) AS total_monto,
            round(avg(registros_combustible.rendimiento_km_gal), 2) AS rendimiento_promedio,
            round(avg(registros_combustible.costo_por_km), 2) AS costo_por_km_promedio,
            max(registros_combustible.fecha) AS ultima_echada
           FROM sgc.registros_combustible
          GROUP BY registros_combustible.vehiculo_id) fc ON fc.vehiculo_id = v.id
     LEFT JOIN ( SELECT checklists_vehiculo.vehiculo_id,
            count(*) AS n_checklists,
            count(*) FILTER (WHERE checklists_vehiculo.resultado = 'bloqueado'::text) AS n_bloqueos,
            max(checklists_vehiculo.fecha) AS ultimo_checklist
           FROM sgc.checklists_vehiculo
          GROUP BY checklists_vehiculo.vehiculo_id) ck ON ck.vehiculo_id = v.id
     LEFT JOIN ( SELECT mantenimientos.vehiculo_id,
            count(*) AS n_mantenimientos,
            max(mantenimientos.fecha) AS ultimo_mantenimiento
           FROM sgc.mantenimientos
          GROUP BY mantenimientos.vehiculo_id) mt ON mt.vehiculo_id = v.id
     LEFT JOIN ( SELECT vehiculo_asignaciones.vehiculo_id,
            count(*) AS n_activas
           FROM sgc.vehiculo_asignaciones
          WHERE vehiculo_asignaciones.activa
          GROUP BY vehiculo_asignaciones.vehiculo_id) asg ON asg.vehiculo_id = v.id;
