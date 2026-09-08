-- ============================================================================
-- PROMPT-40 (BM) FASE 1 — BM1: separar el canal de NEGOCIO del de INFRAESTRUCTURA
-- en registrar_combustible_app.  Ronda 09/09/2026.  Aditivo, idempotente.
--
-- 9ª REGLA DEL CHECKLIST (estrena esta tanda): un rechazo de NEGOCIO no puede
-- viajar con un SQLSTATE de INFRAESTRUCTURA.  El código de error ES el contrato:
--   · 23514 = "un CHECK de la BD está mal"   → app: "Problema del sistema"
--   · 42501 = "falta una política/grant"      → app: "Problema del sistema"
-- ...y la app (outbox-categoria.ts) los clasifica —correctamente según su tabla—
-- como categoría 'sistema': el usuario ve "ya quedó reportado a Tecnología, podrás
-- reintentarlo cuando se publique la corrección" y el reintento espera un fix que
-- NUNCA va a llegar (no hay nada que corregir).  Encima dispara un reporte falso a
-- la telemetría (BG2).  La echada de la captura (08-sep) era ESTO: el salto de km
-- (1874 > 1000) es un rechazo legítimo, se presentó como avería.
--
-- FIX (de contrato, no parche): los CINCO rechazos de negocio del RPC pasan al
-- CANAL DE DATOS que el cliente YA honra:
--   · los cuatro con un campo que el chofer puede corregir (galones, monto,
--     kilometraje) → sgc.error_campo(campo, motivo, mensaje) = 22023 + detail
--     {campo,motivo}  → app: categoría 'dato' + botón "Corregir" (outbox-categoria
--     :37-40; throwSyncError reconoce 22023).  El chofer ajusta y REENVÍA con sus
--     3 fotos intactas, sin esperar un fix inexistente.
--   · el de autorización ("ese vehículo no es tuyo") → código de dominio DR481
--     (throwSyncError reconoce ^DR\d como permanente y accionable; categoría 'dato'
--     con el mensaje real).  No es corregible tecleando un campo → no lleva error_campo.
--
-- SERVER-SIDE ⇒ paridad automática: app Y web se benefician sin actualizar (patrón BK).
--
-- Además:
--   · BM4 — GRANT explícito de la firma de 20 argumentos (AW3 creó la sobrecarga y
--     sólo otorgó sus ayudantes; hoy vive del EXECUTE TO PUBLIC por defecto de
--     Postgres → si se revoca, 42501 permission denied → la misma tarjeta).
--   · BM1(e) — telemetría: se cierran los reportes 'sistema' que en realidad eran
--     rechazos de negocio (si no, el panel BG2 mide mal).
--
-- NO se toca ninguna regla de negocio ni el flujo: sólo el CÓDIGO con que se
-- anuncia el rechazo.  Los P0001 (galones<=0, monto<=0, vehículo inactivo,
-- lectura<=0, no autenticado, sin módulo Flota) ya caían en 'dato' → intactos.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-09-bm1-combustible-canal-negocio.sql
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────
-- registrar_combustible_app — copia EXACTA de AW3 (2026-08-24-aw3-combustible-rpcs
-- .sql:14-317) con SÓLO los 5 rechazos de negocio reclasificados al canal de datos.
-- ────────────────────────────────────────────────────────────────────────
create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date,
  p_kilometraje integer, p_galones numeric, p_monto numeric,
  p_estacion text default null, p_foto_recibo_path text default null,
  p_foto_tablero_path text default null, p_notas text default null,
  p_foto_bomba_path text default null, p_producto text default null,
  p_tarjeta text default null, p_titular text default null,
  p_titular_es_persona boolean default false, p_subtipo text default null,
  p_origen text default 'estacion', p_proyecto_id uuid default null,
  p_confirmado boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_id           uuid;
  v_odometro     int;
  v_km_anterior  int;
  v_km_recorridos int;
  v_precio       numeric;
  v_rendimiento  numeric;
  v_costo_km     numeric;
  v_prom         numeric;
  v_n_prev       int;
  v_esperado     numeric;
  v_prom_flota   numeric;
  v_ref_valor    numeric;
  v_ref_tipo     text;
  v_alerta       boolean := false;
  v_motivo       text;
  v_estado       text;
  v_direccion    text;
  v_baseline     numeric;
  v_dist_min     numeric;
  v_piso_c       numeric;
  v_techo_c      numeric;
  v_min_reg      int;
  v_placa        text;
  v_es_prueba    boolean := false;
  v_medida       text := 'km';
  v_uni          text := 'km';
  v_ren          text := 'km/gal';
  v_origen       text := lower(coalesce(nullif(p_origen,''),'estacion'));
  v_deposito     boolean;
  v_persona      boolean := coalesce(p_titular_es_persona, false) or p_vehiculo_id is null;
  v_asignado     uuid;
  v_umbral_km    numeric;
  v_km_alerta    boolean := false;
  -- AW3
  v_cap          numeric;
  v_margen_bloq  numeric;
  v_margen_al    numeric;
  v_precio_calc  numeric;
  v_precio_min   numeric;
  v_precio_max   numeric;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  if v_origen not in ('estacion','deposito_obra') then v_origen := 'estacion'; end if;
  v_deposito := (v_origen = 'deposito_obra');
  if v_deposito then v_persona := false; end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if not v_deposito and coalesce(p_monto, 0) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  -- AW3 — TOPE DURO de galones (integridad; el cliente valida por UX).
  v_margen_bloq := coalesce((select valor from sgc.flota_config where clave='tanque_margen_bloqueo'), 1.15);
  v_margen_al   := coalesce((select valor from sgc.flota_config where clave='tanque_margen_alerta'), 0.85);
  if v_persona then
    v_cap := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
  else
    v_cap := sgc.cap_tanque_vehiculo(p_vehiculo_id);
  end if;
  if v_cap is not null and v_cap > 0 and p_galones > v_cap * v_margen_bloq then
    -- BM1 — rechazo de negocio, campo corregible → canal de datos (22023).
    perform sgc.error_campo('galones', 'supera_capacidad',
      format('La cantidad de galones (%s) supera la capacidad estimada del %s (~%s gal). Verifica el valor — ¿sobró un punto o coma?',
        round(p_galones,2),
        case when v_persona then 'depósito' else 'tanque de este vehículo' end,
        round(v_cap,0)));
  end if;

  -- AW3 — banda de precio por galón (bloquea 34,118 gal por partida doble).
  if coalesce(p_monto,0) > 0 and p_galones > 0 then
    v_precio_calc := p_monto / p_galones;
    v_precio_min  := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
    v_precio_max  := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
    if v_precio_calc < v_precio_min or v_precio_calc > v_precio_max then
      -- BM1 — rechazo de negocio, campo corregible → canal de datos (22023).
      perform sgc.error_campo('monto', 'precio_fuera_banda',
        format('El precio por galón resultante (RD$%s) está fuera de la banda plausible (RD$%s–RD$%s). Revisa los galones y el monto.',
          round(v_precio_calc,2), round(v_precio_min,0), round(v_precio_max,0)));
    end if;
  end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;

    -- AF18 — solo el usuario asignado registra en su vehículo (bypass admin).
    if not sgc.is_admin() then
      select coalesce(a.usuario_id, c.usuario_id)
        into v_asignado
        from sgc.vehiculo_asignaciones a
        left join sgc.conductores c on c.id = a.conductor_id
       where a.vehiculo_id = p_vehiculo_id and a.activa
       order by a.desde desc nulls last
       limit 1;
      if v_asignado is null then
        select responsable_id into v_asignado from sgc.vehiculos where id = p_vehiculo_id;
      end if;
      if v_asignado is not null and v_asignado <> v_uid then
        -- BM1 — rechazo de negocio de AUTORIZACIÓN (no corregible tecleando) →
        -- código de dominio DR481 (el cliente lo honra como permanente + accionable,
        -- categoría 'dato' con el mensaje real).  NO es 42501 (eso es "falta un grant").
        raise exception 'Solo el usuario asignado a este vehículo puede registrar su combustible.'
          using errcode = 'DR481';
      end if;
    end if;

    select coalesce(es_prueba, false), coalesce(kilometraje, 0), coalesce(medida_uso, 'km'), placa
      into v_es_prueba, v_odometro, v_medida, v_placa
      from sgc.vehiculos where id = p_vehiculo_id;
    v_uni := case when v_medida = 'horas' then 'h' else 'km' end;
    v_ren := case when v_medida = 'horas' then 'h/gal' else 'km/gal' end;

    if coalesce(p_kilometraje, 0) <= 0 then
      raise exception 'La lectura (%) debe ser mayor que 0', v_uni;
    end if;
    if p_kilometraje < v_odometro then
      -- BM1 — rechazo de negocio, campo corregible → canal de datos (22023).
      -- La lectura VIVA del vehículo va en el mensaje (§D-c) para que el chofer
      -- ajuste y reenvíe sin perder las fotos.
      perform sgc.error_campo('kilometraje', 'menor_que_actual',
        format('La lectura (%s %s) no puede ser menor a la lectura actual del vehículo (%s %s).',
          p_kilometraje, v_uni, v_odometro, v_uni));
    end if;

    -- La echada anterior (excluye invalidadas para no arrastrar km corruptos).
    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false);

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        if coalesce(p_monto,0) > 0 then v_costo_km := round(p_monto / v_km_recorridos, 2); end if;
      end if;

      -- AF19 — salto de km entre echadas.
      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          if sgc.is_admin() then
            v_km_alerta := true;
          else
            -- BM1 — rechazo de negocio, campo corregible → canal de datos (22023).
            -- (Era la tarjeta de la captura: 1874 km > 1000 → "Problema del sistema".)
            perform sgc.error_campo('kilometraje', 'salto_excesivo',
              format('El salto de kilometraje (%s km desde la última echada) supera el máximo permitido (%s km). Verifica la lectura del odómetro.',
                v_km_recorridos, v_umbral_km));
          end if;
        end if;
      end if;
    end if;

    if v_medida = 'horas' then
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_horas'), 3);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_min_horas_gal'), 0.05);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_max_horas_gal'), 1.0);
    else
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_km'), 50);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
    end if;
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);

    select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

    -- Baseline propio: excluye invalidadas (AW3) y datos de otro contexto es_prueba.
    select count(*), avg(rendimiento_km_gal) into v_n_prev, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    select avg(rendimiento_km_gal) into v_prom_flota
      from sgc.registros_combustible
     where rendimiento_km_gal is not null and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n_prev >= v_min_reg then v_prom else null end;
    v_ref_tipo := case when v_esperado is not null and v_esperado > 0 then 'esperado'
                       when v_n_prev >= v_min_reg then 'propio' else null end;
    v_ref_valor := v_baseline;

    select estado, motivo, direccion into v_estado, v_motivo, v_direccion
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true);
    v_alerta := (v_estado = 'anormal');
  end if;

  -- AW3 — confirmación de valores inusuales (soft): valor alto pero no imposible.
  -- No inserta; el cliente re-llama con p_confirmado=true (mismo client_uuid).
  if not coalesce(p_confirmado, false)
     and v_cap is not null and v_cap > 0
     and p_galones > v_cap * v_margen_al then
    return jsonb_build_object(
      'needs_confirm', true,
      'confirm_message', format('%s galones es más de lo habitual para %s (tanque ≈ %s gal). ¿Confirmas la cantidad?',
        trim(to_char(p_galones,'FM999990.00')),
        coalesce(v_placa, 'este destino'), round(v_cap,0)),
      'cap', v_cap, 'galones', p_galones);
  end if;

  v_precio := case when coalesce(p_galones,0) > 0 and coalesce(p_monto,0) > 0
                   then round(p_monto / p_galones, 2) else null end;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, foto_bomba_path,
    alerta_consumo, motivo_alerta, estado, client_uuid,
    producto, subtipo, tarjeta, titular, titular_es_persona,
    origen, proyecto_id, registrado_por, km_alerta
  ) values (
    v_id,
    case when v_persona then null else p_vehiculo_id end,
    p_conductor_id, coalesce(p_fecha, current_date),
    case when v_persona then null else p_kilometraje end,
    p_galones, nullif(p_monto, 0), v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    case when v_deposito then null else nullif(p_estacion,'') end,
    nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), nullif(p_foto_bomba_path,''),
    v_alerta, v_motivo, v_estado, p_client_uuid,
    nullif(p_producto,''), nullif(p_subtipo,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false),
    v_origen, p_proyecto_id, v_uid, v_km_alerta
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

    -- AW2 — aviso CON DIRECCIÓN:
    --  · bajo  → problema mecánico/fuga/desvío → ticket a mantenimiento (Flota).
    --  · alto  → error de dato (echada previa sin registrar, km/galones mal) →
    --            pedir revisar la lectura a quien registró + supervisores; NO mantenimiento.
    if v_alerta and not v_es_prueba then
      if v_direccion = 'alto' then
        insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
        values ('revisar_lectura', p_vehiculo_id, p_conductor_id, v_id,
          format('Posible error de lectura en %s: %s No es falla mecánica: verifica el odómetro y los galones.',
            coalesce(v_placa,'vehículo'), v_motivo),
          'media');
        perform sgc.notificar(v_uid, 'revisar_lectura', 'Revisa la lectura de tu echada',
          format('%s: %s', coalesce(v_placa,'Vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text);
        perform sgc.notificar_flota_elevado('revisar_lectura',
          'Echada con rendimiento inusualmente alto',
          format('%s: %s Revisar la lectura (no es ticket de mantenimiento).', coalesce(v_placa,'Un vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text);
      else
        insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
        values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
          format('Consumo anormal en %s: %s Posible fuga, problema mecánico o combustible desviado.',
            coalesce(v_placa,'vehículo'), v_motivo),
          'alta');
        perform sgc.notificar_modulo('flota', 'consumo_anormal',
          'Consumo anormal de combustible',
          format('%s: %s', coalesce(v_placa,'Un vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'precio_por_galon', v_precio,
    'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos,
    'rendimiento_km_gal', v_rendimiento,
    'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'estado', v_estado,
    'motivo_alerta', v_motivo,
    'direccion_alerta', v_direccion,
    'km_alerta', v_km_alerta,
    'promedio_rendimiento', case when v_n_prev >= v_min_reg then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro,
    'medida_uso', v_medida,
    'titular_es_persona', v_persona,
    'origen', v_origen
  );
end;
$function$;

-- ── BM4 — GRANT explícito de la firma de 20 argumentos (antes vivía del
--    EXECUTE TO PUBLIC por defecto de Postgres; si se revoca → 42501). ──────────
grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text,
  text, text, text, text, boolean, text, text, uuid, boolean
) to authenticated, service_role;

-- ── BM1(e) — Telemetría: cerrar los reportes 'sistema' que en realidad eran
--    rechazos de negocio (si no, el panel BG2 los cuenta como pendientes de
--    sistema esperando un fix inexistente).  Idempotente. ───────────────────────
update sgc.outbox_atascados
   set resuelto     = true,
       resuelto_en  = now(),
       nota         = trim(both ' ' from coalesce(nota,'') ||
                      ' [BM1: rechazo de negocio reclasificado a dato; reenviar tras corregir la lectura]')
 where tipo_op in ('combustible','echada')
   and not resuelto
   and (
     error_code in ('23514','42501')
     or error_msg ~ 'supera la capacidad|fuera de la banda plausible|no puede ser menor a la lectura|salto de kilometraje|usuario asignado a este vehículo'
   );

commit;
