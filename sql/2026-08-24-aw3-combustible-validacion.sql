-- ============================================================================
-- AW3 — Validación de echadas de combustible + limpieza retroactiva
-- Ronda 19-24/08/2026 (IDs AW) · PROMPT-9-SGC FASE 1 (+ base de FASE 2)
--
-- Causa raíz del 34,118.0 gal (echada 5b8edd7e, camión L542136): el usuario
-- registró ~34.118 gal (monto RD$10,000 ÷ ~293/gal) y el punto decimal se
-- perdió (confusión punto/coma). La echada previa del mismo vehículo (28.317)
-- guardó bien, así que es un error puntual — pero `registrar_combustible_app`
-- NO tenía tope superior de galones. Este script cierra ese hueco en el
-- servidor (integridad), no solo en el cliente (UX).
--
-- Todo ADITIVO y RETROCOMPATIBLE. Las firmas de RPC compartidas con csd-app
-- se amplían con parámetros DEFAULT (la app vieja sigue funcionando).
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────
-- 1) Capacidad de tanque por vehículo (opcional; manda sobre el tope de clase)
-- ────────────────────────────────────────────────────────────────────────
alter table sgc.vehiculos
  add column if not exists capacidad_tanque_gal numeric;

comment on column sgc.vehiculos.capacidad_tanque_gal is
  'AW3 — capacidad aproximada del tanque en galones. Si está llena, manda sobre el tope por clase en la validación de echadas. Puede quedar vacía (se usa el tope por clase con holgura).';

-- ────────────────────────────────────────────────────────────────────────
-- 2) Topes por clase + márgenes + banda de precio (flota_config, clave/valor)
--    Valores APROXIMADOS con holgura para no frustrar registros reales
--    (Xaviel: "algo que tenga holgura"). El bloqueo duro usa cap × margen.
-- ────────────────────────────────────────────────────────────────────────
insert into sgc.flota_config (clave, valor) values
  ('tanque_cap_motocicleta', 6),    -- moto ~1-2 gal → holgura amplia
  ('tanque_cap_automovil',   25),   -- sedán ~13-18 gal
  ('tanque_cap_suv',         45),
  ('tanque_cap_pickup',      45),
  ('tanque_cap_camion',      120),  -- camión mediano/grande
  ('tanque_cap_pesado',      250),  -- equipo pesado (excavadora, grúa, mixer…)
  ('tanque_cap_default',     80),   -- tipo desconocido/"otro"
  ('tanque_cap_no_vehiculo', 500),  -- echada a depósito/planta/bidones (no vehículo)
  ('tanque_margen_bloqueo',  1.15), -- bloqueo duro: galones > cap × 1.15
  ('tanque_margen_alerta',   0.85), -- confirmación: galones > cap × 0.85
  ('precio_gal_min',         100),  -- banda de precio RD$/gal (bloqueo fuera de banda)
  ('precio_gal_max',         600)
on conflict (clave) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- 3) Trazabilidad de saneamiento (AU18: nunca borrar, conservar original)
-- ────────────────────────────────────────────────────────────────────────
alter table sgc.registros_combustible
  add column if not exists invalidada         boolean not null default false,
  add column if not exists saneada            boolean not null default false,
  add column if not exists saneamiento_motivo text,
  add column if not exists saneada_por        uuid,
  add column if not exists saneada_at         timestamptz,
  add column if not exists valor_original     jsonb;

comment on column sgc.registros_combustible.invalidada is
  'AW3 — echada excluida de promedios/KPIs/conciliación/incentivo por dato inválido. Se conserva el registro (traza).';
comment on column sgc.registros_combustible.valor_original is
  'AW3 — snapshot del registro antes de la primera corrección/invalidación.';

-- ────────────────────────────────────────────────────────────────────────
-- 4) avisos_flota — nuevo tipo 'revisar_lectura' (rendimiento alto = error de dato)
-- ────────────────────────────────────────────────────────────────────────
alter table sgc.avisos_flota drop constraint if exists avisos_flota_tipo_chk;
alter table sgc.avisos_flota add constraint avisos_flota_tipo_chk check (tipo = any (array[
  'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido','consumo_anormal',
  'licencia','matricula','seguro','reporte_semanal','conciliacion',
  'licencia_por_vencer','licencia_vencida','matricula_por_vencer','matricula_vencida',
  'seguro_por_vencer','seguro_vencida','pp_por_vencer','pp_vencida',
  'mantenimiento_por_revisar','novedad','revisar_lectura']));

-- ────────────────────────────────────────────────────────────────────────
-- 5) Helper: capacidad efectiva de tanque (override por vehículo → clase)
-- ────────────────────────────────────────────────────────────────────────
create or replace function sgc.cap_tanque_vehiculo(p_vehiculo_id uuid)
returns numeric
language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_tipo text; v_cap numeric; v_key text;
begin
  select capacidad_tanque_gal, lower(coalesce(tipo,'otro'))
    into v_cap, v_tipo from sgc.vehiculos where id = p_vehiculo_id;
  if v_cap is not null and v_cap > 0 then return v_cap; end if;
  v_key := case
    when v_tipo = 'motocicleta' then 'tanque_cap_motocicleta'
    when v_tipo = 'automovil'   then 'tanque_cap_automovil'
    when v_tipo = 'suv'         then 'tanque_cap_suv'
    when v_tipo = 'pickup'      then 'tanque_cap_pickup'
    when v_tipo = 'camion'      then 'tanque_cap_camion'
    when v_tipo in ('excavadora','retroexcavadora','bulldozer','grua','mixer',
                    'compactadora','montacargas','telehandler') then 'tanque_cap_pesado'
    else 'tanque_cap_default'
  end;
  return coalesce(
    (select valor from sgc.flota_config where clave = v_key),
    (select valor from sgc.flota_config where clave = 'tanque_cap_default'),
    80);
end;
$function$;
grant execute on function sgc.cap_tanque_vehiculo(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 6) clasificar_rendimiento — ahora devuelve DIRECCIÓN de la anomalía
--    (bajo = mantenimiento · alto = revisar lectura). Aditivo: los llamadores
--    que solo leen estado/motivo siguen igual (SELECT estado, motivo INTO …).
--    Cambia el tipo de retorno (nueva columna) → hay que DROP + CREATE. Los
--    otros RPCs referencian por nombre, así que el drop no rompe (se recompilan).
-- ────────────────────────────────────────────────────────────────────────
drop function if exists sgc.clasificar_rendimiento(text,numeric,numeric,numeric,numeric,boolean);
create or replace function sgc.clasificar_rendimiento(
  p_medida text, p_km_rec numeric, p_galones numeric, p_rend numeric,
  p_baseline numeric, p_tanque_lleno boolean)
returns table(estado text, motivo text, direccion text)
language plpgsql stable
as $function$
declare
  v_horas    boolean := (p_medida = 'horas');
  v_uni      text := case when v_horas then 'h'     else 'km'     end;
  v_ren      text := case when v_horas then 'h/gal' else 'km/gal' end;
  v_dist_min numeric; v_piso numeric; v_techo numeric; v_consumo numeric; v_anormal numeric;
begin
  select coalesce((select valor from sgc.flota_config where clave = case when v_horas then 'dist_min_horas' else 'dist_min_km' end),
                  case when v_horas then 3 else 50 end) into v_dist_min;
  select coalesce((select valor from sgc.flota_config where clave = case when v_horas then 'rendimiento_min_horas_gal' else 'rendimiento_minimo_km_gal' end),
                  case when v_horas then 0.05 else 10 end) into v_piso;
  select coalesce((select valor from sgc.flota_config where clave = case when v_horas then 'rendimiento_max_horas_gal' else 'rendimiento_maximo_km_gal' end),
                  case when v_horas then 1.0 else 35 end) into v_techo;
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

commit;
