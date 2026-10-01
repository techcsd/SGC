-- CE12 — Especificación de combustible POR VEHÍCULO (Raykler)
-- ---------------------------------------------------------------------------------
-- Hoy el rango de rendimiento es GLOBAL (flota_config). Aquí cada vehículo puede
-- tener su propia especificación (esperado/mín/máx/tolerancia/capacidad/tipo); si
-- están vacíos hereda de la clase → del global. Las banderas BY1 ("imposiblemente
-- alto/bajo") y el recálculo usan el rango resuelto del vehículo (regla 14: una sola
-- resolución en rango_rendimiento_vehiculo, usada por registrar_combustible_app,
-- recalcular_estados_combustible y guardar_spec_combustible).
-- Unidad = medida_uso (km → km/gal, horas → h/gal); las columnas rendimiento_*_km_gal
-- guardan el valor en la unidad del vehículo (igual que rendimiento_esperado_km_gal).
-- Copias VIVAS de prod con el cambio mínimo (regla 19).
-- ---------------------------------------------------------------------------------

-- ── (1) Columnas aditivas por vehículo ─────────────────────────────────────────
alter table sgc.vehiculos
  add column if not exists rendimiento_min_km_gal     numeric,
  add column if not exists rendimiento_max_km_gal     numeric,
  add column if not exists rendimiento_tolerancia_pct numeric,
  add column if not exists combustible_tipo           text;

-- ── (2) Resolución única del rango: vehículo → global (clase = global hoy) ──────
create or replace function sgc.rango_rendimiento_vehiculo(p_vehiculo uuid, p_medida text)
returns table(dist_min numeric, piso numeric, techo numeric)
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  with v as (select rendimiento_min_km_gal, rendimiento_max_km_gal from sgc.vehiculos where id = p_vehiculo),
  g as (
    select
      coalesce((select valor from sgc.flota_config where clave = case when p_medida='horas' then 'dist_min_horas' else 'dist_min_km' end), case when p_medida='horas' then 3 else 50 end) as dmin,
      coalesce((select valor from sgc.flota_config where clave = case when p_medida='horas' then 'rendimiento_min_horas_gal' else 'rendimiento_minimo_km_gal' end), case when p_medida='horas' then 0.05 else 10 end) as piso_g,
      coalesce((select valor from sgc.flota_config where clave = case when p_medida='horas' then 'rendimiento_max_horas_gal' else 'rendimiento_maximo_km_gal' end), case when p_medida='horas' then 1.0 else 35 end) as techo_g
  )
  select g.dmin,
         coalesce((select rendimiento_min_km_gal from v), g.piso_g),
         coalesce((select rendimiento_max_km_gal from v), g.techo_g)
  from g;
$function$;
grant execute on function sgc.rango_rendimiento_vehiculo(uuid, text) to authenticated;

-- ── (3) spec_combustible: valores resueltos + de DÓNDE viene cada uno ───────────
create or replace function sgc.spec_combustible(p_vehiculo uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v sgc.vehiculos%rowtype; v_medida text; v_unidad text; v_rng record; v_tol_g numeric; v_cap numeric;
begin
  select * into v from sgc.vehiculos where id = p_vehiculo;
  if not found then return '{}'::jsonb; end if;
  v_medida := coalesce(v.medida_uso,'km');
  v_unidad := case when v_medida='horas' then 'h_gal' else 'km_gal' end;
  select * into v_rng from sgc.rango_rendimiento_vehiculo(p_vehiculo, v_medida);
  v_tol_g := coalesce((select valor from sgc.flota_config where clave='umbral_consumo_pct'), 20);
  v_cap := sgc.cap_tanque_vehiculo(p_vehiculo);
  return jsonb_build_object(
    'unidad', v_unidad,
    'medida_uso', v_medida,
    'combustible_tipo', v.combustible_tipo,
    'esperado', jsonb_build_object('valor', v.rendimiento_esperado_km_gal,
        'origen', case when v.rendimiento_esperado_km_gal is not null then 'vehiculo' else 'sin_definir' end),
    'min', jsonb_build_object('valor', v_rng.piso,
        'origen', case when v.rendimiento_min_km_gal is not null then 'vehiculo' else 'global' end),
    'max', jsonb_build_object('valor', v_rng.techo,
        'origen', case when v.rendimiento_max_km_gal is not null then 'vehiculo' else 'global' end),
    'tolerancia_pct', jsonb_build_object('valor', coalesce(v.rendimiento_tolerancia_pct, v_tol_g),
        'origen', case when v.rendimiento_tolerancia_pct is not null then 'vehiculo' else 'global' end),
    'capacidad', jsonb_build_object('valor', v_cap,
        'origen', case when v.capacidad_tanque_gal is not null and v.capacidad_tanque_gal > 0 then 'vehiculo' else 'clase' end)
  );
end;
$function$;
grant execute on function sgc.spec_combustible(uuid) to authenticated;

-- ── (4) baseline aprendido: mediana de las últimas echadas válidas del vehículo ─
create or replace function sgc.vehiculo_baseline_sugerido(p_vehiculo uuid)
returns numeric
language plpgsql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_medida text; v_rng record; v_min int; v_vals numeric[]; v_med numeric;
begin
  select coalesce(medida_uso,'km') into v_medida from sgc.vehiculos where id = p_vehiculo;
  if v_medida is null then return null; end if;
  select * into v_rng from sgc.rango_rendimiento_vehiculo(p_vehiculo, v_medida);
  v_min := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);
  select array_agg(r order by k desc) into v_vals from (
    select rendimiento_km_gal r, kilometraje k
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo and rendimiento_km_gal is not null
       and not coalesce(invalidada,false) and revision <> 'en_espera'
       and km_recorridos >= v_rng.dist_min
       and rendimiento_km_gal between v_rng.piso and v_rng.techo
     order by kilometraje desc
     limit greatest(v_min,3) * 4
  ) s;
  if v_vals is null or array_length(v_vals,1) < v_min then return null; end if;
  select percentile_cont(0.5) within group (order by x) into v_med from unnest(v_vals) x;
  return round(v_med, 2);
end;
$function$;
grant execute on function sgc.vehiculo_baseline_sugerido(uuid) to authenticated;

-- ── (5) clasificar_rendimiento: acepta piso/techo del vehículo (defaults = global)
-- Se recrea con 2 args nuevos con DEFAULT null: las llamadas de 6-arg existentes
-- siguen válidas (caen al global); las nuevas pasan el rango del vehículo.
drop function if exists sgc.clasificar_rendimiento(text,numeric,numeric,numeric,numeric,boolean);

CREATE OR REPLACE FUNCTION sgc.clasificar_rendimiento(p_medida text, p_km_rec numeric, p_galones numeric, p_rend numeric, p_baseline numeric, p_tanque_lleno boolean, p_piso numeric DEFAULT NULL, p_techo numeric DEFAULT NULL)
 RETURNS TABLE(estado text, motivo text, direccion text)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_horas    boolean := (p_medida = 'horas');
  v_uni      text := case when v_horas then 'h'     else 'km'     end;
  v_ren      text := case when v_horas then 'h/gal' else 'km/gal' end;
  v_dist_min numeric; v_piso numeric; v_techo numeric; v_consumo numeric; v_anormal numeric;
begin
  select coalesce((select valor from sgc.flota_config where clave = case when v_horas then 'dist_min_horas' else 'dist_min_km' end),
                  case when v_horas then 3 else 50 end) into v_dist_min;
  v_piso := coalesce(p_piso, (select valor from sgc.flota_config where clave = case when v_horas then 'rendimiento_min_horas_gal' else 'rendimiento_minimo_km_gal' end), case when v_horas then 0.05 else 10 end);
  v_techo := coalesce(p_techo, (select valor from sgc.flota_config where clave = case when v_horas then 'rendimiento_max_horas_gal' else 'rendimiento_maximo_km_gal' end), case when v_horas then 1.0 else 35 end);
  select coalesce((select valor from sgc.flota_config where clave = 'umbral_consumo_pct'), 20) into v_consumo;
  select coalesce((select valor from sgc.flota_config where clave = 'umbral_anormal_pct'), 40) into v_anormal;

  -- 1) Datos insuficientes.
  if p_km_rec is null then
    return query select 'datos_insuficientes'::text,
      format('Primera echada registrada — todavía sin %s para comparar el rendimiento.',
             case when v_horas then 'horas' else 'distancia' end), null::text;
    return;
  end if;
  if coalesce(p_galones,0) <= 0 or p_rend is null then
    return query select 'datos_insuficientes'::text, 'No hay galones/lectura suficientes para calcular el rendimiento.'::text, null::text;
    return;
  end if;
  if coalesce(p_tanque_lleno, true) = false then
    return query select 'datos_insuficientes'::text,
      'Esta echada (o la anterior) no fue a tanque lleno; el rendimiento solo es confiable entre llenados completos.'::text, null::text;
    return;
  end if;
  if p_km_rec < v_dist_min then
    return query select 'datos_insuficientes'::text,
      format('Solo %s %s desde la última echada (se necesitan al menos %s %s entre tanques llenos). El rendimiento real solo es medible de tanque lleno a tanque lleno.',
             round(p_km_rec), v_uni, round(v_dist_min), v_uni), null::text;
    return;
  end if;

  -- 2) Anormal por rango físico. Bajo → mantenimiento · Alto → error de dato.
  if p_rend < v_piso then
    return query select 'anormal'::text,
      format('Rendimiento imposiblemente bajo: %s %s (mínimo coherente %s %s). Posible fuga, falla mecánica, combustible desviado o error de lectura.',
             p_rend, v_ren, round(v_piso,2), v_ren), 'bajo'::text;
    return;
  end if;
  if p_rend > v_techo then
    return query select 'anormal'::text,
      format('Rendimiento imposiblemente alto: %s %s (máximo coherente %s %s). Probable error de odómetro o una echada anterior sin registrar.',
             p_rend, v_ren, round(v_techo,2), v_ren), 'alto'::text;
    return;
  end if;
  -- Anormal por desviación del baseline (dirección según el signo).
  if p_baseline is not null and p_baseline > 0 and abs(p_rend - p_baseline) / p_baseline > v_anormal/100.0 then
    return query select 'anormal'::text,
      format('Rendimiento fuera de rango: %s %s vs. lo esperado ≈ %s %s (desviación mayor al %s%%). Revisar el vehículo o la lectura.',
             p_rend, v_ren, round(p_baseline,2), v_ren, round(v_anormal)),
      case when p_rend < p_baseline then 'bajo' else 'alto' end::text;
    return;
  end if;

  -- 3) Bajo explicable.
  if p_baseline is not null and p_baseline > 0
     and p_rend < p_baseline * (1 - v_consumo/100.0)
     and p_rend >= p_baseline * (1 - v_anormal/100.0) then
    return query select 'bajo'::text,
      format('Rinde %s %s, por debajo de lo normal (≈ %s %s) pero dentro de un margen explicable. Vale la pena vigilarlo.',
             p_rend, v_ren, round(p_baseline,2), v_ren), 'bajo'::text;
    return;
  end if;

  -- 4) Óptimo.
  return query select 'optimo'::text,
    case when p_baseline is not null and p_baseline > 0
      then format('Rendimiento dentro de lo esperado para este vehículo (≈ %s %s ± %s%%). Consumo normal.',
                  round(p_baseline,2), v_ren, round(v_consumo))
      else format('Rendimiento de %s %s dentro de rangos coherentes. Aún sin baseline propio suficiente para comparar.', p_rend, v_ren)
    end, null::text;
end;
$function$;

-- ── (6) recalcular_estados_combustible: usa el rango por vehículo ──────────────
CREATE OR REPLACE FUNCTION sgc.recalcular_estados_combustible()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_count int := 0; r record;
  v_medida text; v_esperado numeric; v_baseline numeric; v_n int; v_prom numeric;
  v_dist_min numeric; v_piso_c numeric; v_techo_c numeric; v_min_reg int;
  v_estado text; v_motivo text; v_dir text; v_ep boolean;
begin
  if not sgc.es_flota_elevado() then raise exception 'Tu rol no puede recalcular el histórico de combustible' using errcode = '22023'; end if;
  for r in
    select id, vehiculo_id, km_recorridos, galones, rendimiento_km_gal, coalesce(es_prueba,false) as ep
      from sgc.registros_combustible
     where vehiculo_id is not null and not coalesce(invalidada, false)
       and revision <> 'en_espera'                                   -- BY1: en espera no cuenta
     order by vehiculo_id, coalesce(es_prueba,false), kilometraje
  loop
    v_ep := r.ep;
    select coalesce(medida_uso,'km'), rendimiento_esperado_km_gal into v_medida, v_esperado
      from sgc.vehiculos where id = r.vehiculo_id;
    -- CE12 — rango por vehículo (vehículo → clase → global) en vez de solo global.
    select dist_min, piso, techo into v_dist_min, v_piso_c, v_techo_c
      from sgc.rango_rendimiento_vehiculo(r.vehiculo_id, v_medida);
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);
    select count(*), avg(rendimiento_km_gal) into v_n, v_prom
      from sgc.registros_combustible
     where vehiculo_id = r.vehiculo_id and id <> r.id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_ep
       and not coalesce(invalidada, false)
       and revision <> 'en_espera'                                   -- BY1
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;
    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n >= v_min_reg then v_prom else null end;
    select estado, motivo, direccion into v_estado, v_motivo, v_dir
      from sgc.clasificar_rendimiento(v_medida, r.km_recorridos, r.galones, r.rendimiento_km_gal, v_baseline, true, v_piso_c, v_techo_c);
    update sgc.registros_combustible
       set estado = v_estado, motivo_alerta = v_motivo, alerta_consumo = (v_estado = 'anormal')
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- ── (7) registrar_combustible_app: la bandera usa el rango del vehículo ───────
CREATE OR REPLACE FUNCTION sgc.registrar_combustible_app(p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date, p_kilometraje integer, p_galones numeric, p_monto numeric, p_estacion text DEFAULT NULL::text, p_foto_recibo_path text DEFAULT NULL::text, p_foto_tablero_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_foto_bomba_path text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_tarjeta text DEFAULT NULL::text, p_titular text DEFAULT NULL::text, p_titular_es_persona boolean DEFAULT false, p_subtipo text DEFAULT NULL::text, p_origen text DEFAULT 'estacion'::text, p_proyecto_id uuid DEFAULT NULL::uuid, p_confirmado boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
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
  v_sin_asignacion boolean := false;   -- BR1
  v_km_base      int;                   -- BR1
  v_elevado_conf boolean;               -- BR1
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

  -- BV1 — la fecha de la echada no puede ser futura, y una fecha PASADA (retroactiva)
  -- solo se permite con un permiso vigente (o si el usuario es flota-elevado/admin).
  if coalesce(p_fecha, current_date) > current_date then
    raise exception 'La fecha de la echada no puede ser futura.'
      using errcode = '22023', detail = 'campo=fecha;motivo=futura';
  end if;
  if coalesce(p_fecha, current_date) < current_date
     and not sgc.puede_registrar_combustible_retro(v_uid, coalesce(p_fecha, current_date)) then
    raise exception 'No puedes registrar una echada con fecha pasada (%). Pide a Flota un permiso de registro retroactivo.', p_fecha
      using errcode = '22023', detail = 'campo=fecha;motivo=retroactiva_sin_permiso';
  end if;

  v_elevado_conf := sgc.es_flota_elevado() and coalesce(p_confirmado, false);  -- BR1

  if v_origen not in ('estacion','deposito_obra') then v_origen := 'estacion'; end if;
  v_deposito := (v_origen = 'deposito_obra');
  if v_deposito then v_persona := false; end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  -- BQ7 — Blindaje del conductor_id (corolario regla 13/14).
  if p_conductor_id is not null
     and not exists (select 1 from sgc.conductores c where c.id = p_conductor_id) then
    raise notice 'registrar_combustible_app: conductor_id % del payload no existe (fusionado/borrado) — ignorado, se resuelve por uid', p_conductor_id;
    p_conductor_id := null;
  end if;
  if p_conductor_id is null then
    select c.id into p_conductor_id from sgc.conductores c where c.usuario_id = v_uid limit 1;
  end if;
  if p_conductor_id is null and p_vehiculo_id is not null then
    select a.conductor_id into p_conductor_id
      from sgc.vehiculo_asignaciones a
     where a.vehiculo_id = p_vehiculo_id and a.activa
     order by a.desde desc nulls last
     limit 1;
  end if;

  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if not v_deposito and coalesce(p_monto, 0) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  -- AW3 — TOPE DURO de galones (integridad).  BR1: un flota-elevado con p_confirmado
  -- lo pasa (regla 15: el rechazo duro es lo físicamente imposible, y el elevado
  -- puede confirmar que sí fue así).
  v_margen_bloq := coalesce((select valor from sgc.flota_config where clave='tanque_margen_bloqueo'), 1.15);
  v_margen_al   := coalesce((select valor from sgc.flota_config where clave='tanque_margen_alerta'), 0.85);
  if v_persona then
    v_cap := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
  else
    v_cap := sgc.cap_tanque_vehiculo(p_vehiculo_id);
  end if;
  if v_cap is not null and v_cap > 0 and p_galones > v_cap * v_margen_bloq
     and not v_elevado_conf then
    perform sgc.error_campo('galones', 'supera_capacidad',
      format('La cantidad de galones (%s) supera la capacidad estimada del %s (~%s gal). Verifica el valor — ¿sobró un punto o coma? Si es correcto, pídele a Logística (Raykler) que la registre.',
        round(p_galones,2),
        case when v_persona then 'depósito' else 'tanque de este vehículo' end,
        round(v_cap,0)));
  end if;

  -- AW3 — banda de precio por galón.  BR1: elevado+confirmado la pasa.
  if coalesce(p_monto,0) > 0 and p_galones > 0 then
    v_precio_calc := p_monto / p_galones;
    v_precio_min  := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
    v_precio_max  := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
    if (v_precio_calc < v_precio_min or v_precio_calc > v_precio_max) and not v_elevado_conf then
      perform sgc.error_campo('monto', 'precio_fuera_banda',
        format('El precio por galón resultante (RD$%s) está fuera de la banda plausible (RD$%s–RD$%s). Revisa los galones y el monto. Si es correcto, pídele a Logística (Raykler) que la registre.',
          round(v_precio_calc,2), round(v_precio_min,0), round(v_precio_max,0)));
    end if;
  end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;

    -- AF18 — solo el usuario asignado registra en su vehículo (BO4: bypass a flota
    -- elevado; BQ7b: une uso-v2).  BR1 (regla 15): si aun así no coincide, ya NO
    -- rechaza — se acepta con bandera sin_asignacion y se avisa a logística.
    if not sgc.es_flota_elevado() then
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
      if v_asignado is not null and v_asignado <> v_uid
         and not exists (
           select 1 from sgc.vehiculo_usos u
            where u.vehiculo_id = p_vehiculo_id and u.usuario_id = v_uid and u.fin_at is null
         ) then
        v_sin_asignacion := true;   -- BR1: antes era raise ... using errcode='DR481'
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

    -- BR1 — km base editable por admin: reinicia el punto de medición del salto sin
    -- tocar las echadas históricas.  Solo en el contexto real (no es_prueba).
    if not v_es_prueba then
      select km_base_combustible into v_km_base from sgc.vehiculos where id = p_vehiculo_id;
      if v_km_base is not null then
        v_km_anterior := greatest(coalesce(v_km_anterior, 0), v_km_base);
      end if;
    end if;

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        if coalesce(p_monto,0) > 0 then v_costo_km := round(p_monto / v_km_recorridos, 2); end if;
      end if;

      -- AF19 — salto de km entre echadas.  BR1 (regla 15): ya NO rechaza a nadie —
      -- se acepta con bandera km_alerta y se avisa a logística (Raykler sanea).
      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          v_km_alerta := true;
        end if;
      end if;
    end if;

    -- CE12 — rango por vehículo (vehículo → clase → global) en vez de solo global.
    select dist_min, piso, techo into v_dist_min, v_piso_c, v_techo_c
      from sgc.rango_rendimiento_vehiculo(p_vehiculo_id, v_medida);
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);

    select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

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
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true, v_piso_c, v_techo_c);
    v_alerta := (v_estado = 'anormal');
  end if;

  -- AW3 — confirmación de valores inusuales (soft).
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
    origen, proyecto_id, registrado_por, km_alerta, sin_asignacion
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
    v_origen, p_proyecto_id, v_uid, v_km_alerta, v_sin_asignacion
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

    -- AW2 — aviso de consumo anormal (con dirección).
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

    -- BR1 — banderas de revisión (regla 15): se avisa a logística sin bloquear.
    if v_km_alerta and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'km_salto',
        'Salto de kilometraje en una echada',
        format('%s: salto de %s km desde la última echada. Revisar/sanear.', coalesce(v_placa,'Un vehículo'), v_km_recorridos),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
    end if;
    if v_sin_asignacion and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'combustible_revisar',
        'Echada sin asignación',
        format('%s: echada registrada por %s sin ser el asignado del vehículo. Revisar.',
          coalesce(v_placa,'Un vehículo'),
          coalesce((select nombre from sgc.usuarios where id = v_uid), 'un usuario')),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
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
    'sin_asignacion', v_sin_asignacion,
    'aviso', case when v_sin_asignacion or v_km_alerta
                  then 'Registrado. Logística (Raykler) lo revisará.' else null end,
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

-- ── (8) guardar_spec_combustible: edita la spec + recalcula ese vehículo ───────
create or replace function sgc.guardar_spec_combustible(p_vehiculo uuid, p_spec jsonb)
returns integer
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_count int := 0; r record; v_medida text; v_esperado numeric; v_baseline numeric;
  v_n int; v_prom numeric; v_rng record; v_min_reg int; v_estado text; v_motivo text; v_dir text; v_ep boolean;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Tu rol no puede editar la especificación de combustible' using errcode = '42501';
  end if;
  update sgc.vehiculos set
    combustible_tipo            = coalesce(nullif(p_spec->>'combustible_tipo',''), combustible_tipo),
    capacidad_tanque_gal        = coalesce((p_spec->>'capacidad')::numeric, capacidad_tanque_gal),
    rendimiento_esperado_km_gal = coalesce((p_spec->>'esperado')::numeric, rendimiento_esperado_km_gal),
    rendimiento_min_km_gal      = (p_spec->>'min')::numeric,
    rendimiento_max_km_gal      = (p_spec->>'max')::numeric,
    rendimiento_tolerancia_pct  = (p_spec->>'tolerancia_pct')::numeric
   where id = p_vehiculo;

  select coalesce(medida_uso,'km') into v_medida from sgc.vehiculos where id = p_vehiculo;
  select * into v_rng from sgc.rango_rendimiento_vehiculo(p_vehiculo, v_medida);
  v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);
  for r in
    select id, km_recorridos, galones, rendimiento_km_gal, coalesce(es_prueba,false) ep
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo and not coalesce(invalidada,false) and revision <> 'en_espera'
     order by coalesce(es_prueba,false), kilometraje
  loop
    v_ep := r.ep;
    select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo;
    select count(*), avg(rendimiento_km_gal) into v_n, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo and id <> r.id and rendimiento_km_gal is not null
       and coalesce(es_prueba,false) = v_ep and not coalesce(invalidada,false) and revision <> 'en_espera'
       and km_recorridos >= v_rng.dist_min and rendimiento_km_gal between v_rng.piso and v_rng.techo;
    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n >= v_min_reg then v_prom else null end;
    select estado, motivo, direccion into v_estado, v_motivo, v_dir
      from sgc.clasificar_rendimiento(v_medida, r.km_recorridos, r.galones, r.rendimiento_km_gal, v_baseline, true, v_rng.piso, v_rng.techo);
    update sgc.registros_combustible set estado = v_estado, motivo_alerta = v_motivo, alerta_consumo = (v_estado = 'anormal') where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
grant execute on function sgc.guardar_spec_combustible(uuid, jsonb) to authenticated;

-- ── (9) importar_specs_combustible: carga masiva por placa ────────────────────
create or replace function sgc.importar_specs_combustible(p_filas jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare it jsonb; v_id uuid; v_ok int := 0; v_err jsonb := '[]'::jsonb; v_placa text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Tu rol no puede importar especificaciones de combustible' using errcode = '42501';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_placa := upper(trim(coalesce(it->>'placa','')));
    if v_placa = '' then continue; end if;
    select id into v_id from sgc.vehiculos where upper(placa) = v_placa limit 1;
    if v_id is null then
      v_err := v_err || jsonb_build_array(jsonb_build_object('placa', v_placa, 'motivo', 'No existe ese vehículo'));
      continue;
    end if;
    update sgc.vehiculos set
      rendimiento_esperado_km_gal = coalesce((it->>'esperado')::numeric, rendimiento_esperado_km_gal),
      rendimiento_min_km_gal      = coalesce((it->>'min')::numeric, rendimiento_min_km_gal),
      rendimiento_max_km_gal      = coalesce((it->>'max')::numeric, rendimiento_max_km_gal)
     where id = v_id;
    v_ok := v_ok + 1;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errores', v_err);
end;
$function$;
grant execute on function sgc.importar_specs_combustible(jsonb) to authenticated;
