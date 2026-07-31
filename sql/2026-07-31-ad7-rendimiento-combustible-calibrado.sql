-- ============================================================================
-- AD7 — Ronda 31/07/2026 (PROMPT-15 FASE 3)
-- Rendimiento de combustible calibrado contra la realidad.
--
-- Problema: una echada 10-11 km después de la anterior se clasificaba (óptimo o
-- anormal) cuando en realidad NO es medible. El rendimiento confiable solo se
-- calcula de tanque lleno a tanque lleno y con una distancia mínima significativa.
--
-- Solución: 4 estados `optimo | bajo | anormal | datos_insuficientes`, con
-- umbrales configurables (flota_config), baseline por vehículo SIN envenenar con
-- echadas basura, y detección de outliers en AMBOS sentidos (también atrapa un
-- rendimiento imposiblemente ALTO por error de odómetro / echada saltada).
--
-- Todo aditivo e idempotente. Reglas documentadas en docs/RENDIMIENTO-COMBUSTIBLE.md.
-- ============================================================================

-- 1) Umbrales configurables (idempotente; no pisa lo que un admin ya cambió).
insert into sgc.flota_config (clave, valor) values
  ('dist_min_km',              50),   -- km mínimos entre echadas para medir (km)
  ('dist_min_horas',            3),   -- horas mínimas entre echadas (equipos por horas)
  ('rendimiento_maximo_km_gal', 35),  -- techo absoluto km/gal (arriba = error/echada saltada)
  ('umbral_anormal_pct',       40),   -- desviación (± ) del baseline => anormal
  ('min_registros_baseline',    3),   -- echadas plausibles mínimas para confiar el promedio propio
  ('rendimiento_min_horas_gal', 0.05),-- piso h/gal (equipos por horas)
  ('rendimiento_max_horas_gal', 1.0)  -- techo h/gal (equipos por horas)
on conflict (clave) do nothing;
-- (umbral_consumo_pct=20 y rendimiento_minimo_km_gal=10 ya existen.)

-- 2) Columnas nuevas en registros_combustible.
alter table sgc.registros_combustible
  add column if not exists estado text
    check (estado in ('optimo','bajo','anormal','datos_insuficientes')),
  add column if not exists tanque_lleno boolean not null default true;

-- 3) Helper puro de clasificación (compartido por el insert y el recálculo).
--    Lee los umbrales de flota_config. Devuelve (estado, motivo).
create or replace function sgc.clasificar_rendimiento(
  p_medida       text,      -- 'km' | 'horas'
  p_km_rec       numeric,   -- distancia/horas recorridas (null = primera echada)
  p_galones      numeric,
  p_rend         numeric,   -- rendimiento calculado (null si no calculable)
  p_baseline     numeric,   -- B: esperado o promedio propio plausible (null si no hay)
  p_tanque_lleno boolean
) returns table (estado text, motivo text)
language plpgsql
stable
as $$
declare
  v_horas    boolean := (p_medida = 'horas');
  v_uni      text := case when v_horas then 'h'     else 'km'     end;
  v_ren      text := case when v_horas then 'h/gal' else 'km/gal' end;
  v_dist_min numeric;
  v_piso     numeric;
  v_techo    numeric;
  v_consumo  numeric;
  v_anormal  numeric;
begin
  select coalesce((select valor from sgc.flota_config where clave = case when v_horas then 'dist_min_horas' else 'dist_min_km' end),
                  case when v_horas then 3 else 50 end) into v_dist_min;
  select coalesce((select valor from sgc.flota_config where clave = case when v_horas then 'rendimiento_min_horas_gal' else 'rendimiento_minimo_km_gal' end),
                  case when v_horas then 0.05 else 10 end) into v_piso;
  select coalesce((select valor from sgc.flota_config where clave = case when v_horas then 'rendimiento_max_horas_gal' else 'rendimiento_maximo_km_gal' end),
                  case when v_horas then 1.0 else 35 end) into v_techo;
  select coalesce((select valor from sgc.flota_config where clave = 'umbral_consumo_pct'), 20) into v_consumo;
  select coalesce((select valor from sgc.flota_config where clave = 'umbral_anormal_pct'), 40) into v_anormal;

  -- 1) Datos insuficientes: no medible de forma confiable.
  if p_km_rec is null then
    return query select 'datos_insuficientes'::text,
      format('Primera echada registrada — todavía sin %s para comparar el rendimiento.',
             case when v_horas then 'horas' else 'distancia' end);
    return;
  end if;
  if coalesce(p_galones,0) <= 0 or p_rend is null then
    return query select 'datos_insuficientes'::text, 'No hay galones/lectura suficientes para calcular el rendimiento.'::text;
    return;
  end if;
  if coalesce(p_tanque_lleno, true) = false then
    return query select 'datos_insuficientes'::text,
      'Esta echada (o la anterior) no fue a tanque lleno; el rendimiento solo es confiable entre llenados completos.'::text;
    return;
  end if;
  if p_km_rec < v_dist_min then
    return query select 'datos_insuficientes'::text,
      format('Solo %s %s desde la última echada (se necesitan al menos %s %s entre tanques llenos). El rendimiento real solo es medible de tanque lleno a tanque lleno.',
             round(p_km_rec), v_uni, round(v_dist_min), v_uni);
    return;
  end if;

  -- 2) Anormal: fuera de rango físico o gran desviación del baseline (ambos sentidos).
  if p_rend < v_piso then
    return query select 'anormal'::text,
      format('Rendimiento imposiblemente bajo: %s %s (mínimo coherente %s %s). Posible fuga, falla mecánica, combustible desviado o error de lectura.',
             p_rend, v_ren, round(v_piso,2), v_ren);
    return;
  end if;
  if p_rend > v_techo then
    return query select 'anormal'::text,
      format('Rendimiento imposiblemente alto: %s %s (máximo coherente %s %s). Probable error de odómetro o una echada anterior sin registrar.',
             p_rend, v_ren, round(v_techo,2), v_ren);
    return;
  end if;
  if p_baseline is not null and p_baseline > 0 and abs(p_rend - p_baseline) / p_baseline > v_anormal/100.0 then
    return query select 'anormal'::text,
      format('Rendimiento fuera de rango: %s %s vs. lo esperado ≈ %s %s (desviación mayor al %s%%). Revisar el vehículo o la lectura.',
             p_rend, v_ren, round(p_baseline,2), v_ren, round(v_anormal));
    return;
  end if;

  -- 3) Bajo: por debajo de la banda normal, pero explicable (entre consumo% y anormal%).
  if p_baseline is not null and p_baseline > 0
     and p_rend < p_baseline * (1 - v_consumo/100.0)
     and p_rend >= p_baseline * (1 - v_anormal/100.0) then
    return query select 'bajo'::text,
      format('Rinde %s %s, por debajo de lo normal (≈ %s %s) pero dentro de un margen explicable. Vale la pena vigilarlo.',
             p_rend, v_ren, round(p_baseline,2), v_ren);
    return;
  end if;

  -- 4) Óptimo.
  return query select 'optimo'::text,
    case when p_baseline is not null and p_baseline > 0
      then format('Rendimiento dentro de lo esperado para este vehículo (≈ %s %s ± %s%%). Consumo normal.',
                  round(p_baseline,2), v_ren, round(v_consumo))
      else format('Rendimiento de %s %s dentro de rangos coherentes. Aún sin baseline propio suficiente para comparar.', p_rend, v_ren)
    end;
end;
$$;

grant execute on function sgc.clasificar_rendimiento(text,numeric,numeric,numeric,numeric,boolean) to authenticated, service_role;
