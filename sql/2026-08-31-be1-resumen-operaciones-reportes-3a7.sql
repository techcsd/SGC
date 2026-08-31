-- =============================================================================
-- PROMPT-25 FASE 4 (BE1) — Reportes 3 a 7 del resumen semanal de operaciones.
-- Ronda 19/08-01/09/2026 (IDs BE). Aditivo, idempotente, retrocompatible.
--
--   (3) Rutas hechas — completadas por chofer + total; cuarentena BB8 APARTE
--       (decisión Xaviel: "30 completadas + 12 en revisión", no mezclar).
--   (4) Conduces hechos — por tipo (normal salidas / externo BA4) y obra destino.
--   (5) Movimiento de equipos y materiales — entradas/salidas/ajustes por almacén.
--   (6) Km + combustible de vehículos de CARGA — km + galones (solo válidas AW3).
--   (7) Bitácoras por obra — cantidad vs días laborables ("Torre Alpha: 5/6").
--
-- Cada uno = una TOOL de Compa (AU1): mismos números en chat y en el correo.
-- Semana lunes-domingo (sgc.semana_rango). es_prueba fuera de todo.
-- =============================================================================

begin;

-- Helper local: año/semana efectivos (última semana cerrada si vienen null).
-- (Se repite el patrón en cada RPC para que sean autónomas como tools.)

-- ══════════════════════════════════════════════════════════════════════════════
-- REPORTE 3 — Rutas hechas (completadas por chofer + total). Cuarentena APARTE.
--   Una ruta completada con km_real=0 o tiempo_real_min=0 es una incidencia (BB8):
--   NO cuenta como válida hasta que se decida 'aceptada' (incentivo_incidencia_
--   decision). Sin decisión = "en revisión" (cuarentena). Se cuentan por separado.
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.resumen_rutas_semana(
  p_anio int default null, p_semana int default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  return (
    with comp as (
      select r.id,
             coalesce(cu.nombre, c.nombre, 'Sin chofer') as chofer,
             (r.km_real is null or r.km_real = 0 or r.tiempo_real_min is null or r.tiempo_real_min = 0) as flagged,
             d.decision
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
      left join sgc.usuarios cu on cu.id = c.usuario_id
      left join sgc.incentivo_incidencia_decision d
        on d.ref_tipo = 'ruta' and d.ref_id = r.id and d.anio = v_anio and d.semana = v_sem
      where r.estado = 'completada'
        and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) between v_ini and v_fin
        and not coalesce(r.es_prueba, false)
    ),
    clasif as (
      -- 'completada' es un hecho OPERACIONAL (la ruta se terminó). La incidencia
      -- (en revisión / cuarentena BB8) es un subconjunto que se cuenta APARTE, no
      -- se resta del total: si no, un tramo sin km trackeado "desaparecería" del
      -- panorama de operaciones, que es falso (la ruta sí se hizo).
      select chofer,
        (flagged and (decision is null or decision = 'cuarentena')) as en_revision,
        (flagged and decision = 'excluida') as excluida
      from comp
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'completadas', (select count(*) from clasif),
      'limpias',     (select count(*) from clasif where not en_revision and not excluida),
      'en_revision', (select count(*) from clasif where en_revision),
      'excluidas',   (select count(*) from clasif where excluida),
      'por_chofer', coalesce((
        select jsonb_agg(jsonb_build_object(
          'chofer', chofer,
          'completadas', tot, 'en_revision', er) order by tot desc, chofer)
        from (
          select chofer,
                 count(*) tot,
                 count(*) filter (where en_revision) er
          from clasif group by chofer
        ) x), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function sgc.resumen_rutas_semana(int, int) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- REPORTE 4 — Conduces hechos por tipo (normal / externo BA4) y por obra destino.
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.resumen_conduces_semana(
  p_anio int default null, p_semana int default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  return (
    with normales as (
      select coalesce(p.codigo || ' · ' || p.nombre, p.nombre, 'Sin obra') obra
      from sgc.salidas_inventario s
      left join sgc.proyectos p on p.id = s.proyecto_id
      where (s.created_at at time zone 'America/Santo_Domingo')::date between v_ini and v_fin
        and coalesce(s.estado,'') <> 'anulado'
        and not coalesce(s.es_prueba, false)
    ),
    externos as (
      select coalesce(p.codigo || ' · ' || p.nombre, p.nombre, 'Sin obra') obra
      from sgc.conduces_externos ce
      left join sgc.proyectos p on p.id = ce.destino_proyecto_id
      where (ce.created_at at time zone 'America/Santo_Domingo')::date between v_ini and v_fin
        and coalesce(ce.estado,'') <> 'anulado'
        and not coalesce(ce.es_prueba, false)
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'total_normal', (select count(*) from normales),
      'total_externo', (select count(*) from externos),
      'total', (select count(*) from normales) + (select count(*) from externos),
      'por_obra', coalesce((
        select jsonb_agg(jsonb_build_object('obra', obra, 'normal', n, 'externo', e) order by (n + e) desc, obra)
        from (
          select obra, sum(es_norm) n, sum(es_ext) e from (
            select obra, 1 es_norm, 0 es_ext from normales
            union all select obra, 0, 1 from externos
          ) u group by obra
        ) t), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function sgc.resumen_conduces_semana(int, int) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- REPORTE 5 — Movimiento de inventario por almacén (entradas / salidas / ajustes).
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.resumen_inventario_semana(
  p_anio int default null, p_semana int default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  return (
    with movs as (
      select bodega_id, 'entrada' tipo from sgc.entradas_inventario
        where (created_at at time zone 'America/Santo_Domingo')::date between v_ini and v_fin and not coalesce(es_prueba,false)
      union all
      select bodega_id, 'salida' from sgc.salidas_inventario
        where (created_at at time zone 'America/Santo_Domingo')::date between v_ini and v_fin
          and coalesce(estado,'') <> 'anulado' and not coalesce(es_prueba,false)
      union all
      select bodega_id, 'ajuste' from sgc.conteos_inventario
        where (created_at at time zone 'America/Santo_Domingo')::date between v_ini and v_fin and not coalesce(es_prueba,false)
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'total_entradas', (select count(*) from movs where tipo = 'entrada'),
      'total_salidas',  (select count(*) from movs where tipo = 'salida'),
      'total_ajustes',  (select count(*) from movs where tipo = 'ajuste'),
      'por_almacen', coalesce((
        select jsonb_agg(jsonb_build_object(
          'almacen', coalesce(b.nombre, 'Sin almacén'),
          'entradas', ent, 'salidas', sal, 'ajustes', aj) order by (ent + sal + aj) desc)
        from (
          select bodega_id,
                 count(*) filter (where tipo = 'entrada') ent,
                 count(*) filter (where tipo = 'salida') sal,
                 count(*) filter (where tipo = 'ajuste') aj
          from movs group by bodega_id
        ) m
        left join sgc.bodegas b on b.id = m.bodega_id), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function sgc.resumen_inventario_semana(int, int) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- REPORTE 6 — Km + combustible de los vehículos de CARGA (Pesado = camión, etc.).
--   Solo echadas VÁLIDAS (AW3: not invalidada). km = suma de km_recorridos.
--   Si el dato de km viene sucio (odómetros sin registrar), lo dice.
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.resumen_flota_carga_semana(
  p_anio int default null, p_semana int default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  return (
    with echadas as (
      select rc.vehiculo_id,
             coalesce(nullif(trim(v.placa),''), v.marca, 'Vehículo') placa,
             coalesce(rc.km_recorridos, 0) km, coalesce(rc.galones, 0) gal,
             coalesce(rc.monto, 0) monto,
             (rc.km_recorridos is null or rc.km_recorridos = 0) as km_sucio
      from sgc.registros_combustible rc
      join sgc.vehiculos v on v.id = rc.vehiculo_id
      where rc.fecha between v_ini and v_fin
        and not coalesce(rc.invalidada, false)
        and not coalesce(rc.es_prueba, false)
        -- Vehículos de carga (Pesado): excluye la clase liviana.
        and coalesce(v.tipo,'') not in ('motocicleta','automovil','suv','pickup','otro')
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'total_galones', coalesce((select sum(gal) from echadas), 0),
      'total_km', coalesce((select sum(km) from echadas), 0),
      'total_costo', coalesce((select sum(monto) from echadas), 0),
      'km_en_depuracion', (select count(*) from echadas where km_sucio) > 0,
      'por_vehiculo', coalesce((
        select jsonb_agg(jsonb_build_object(
          'placa', placa, 'km', km_t, 'galones', gal_t, 'costo', monto_t, 'echadas', n) order by gal_t desc)
        from (
          select placa, sum(km) km_t, sum(gal) gal_t, sum(monto) monto_t, count(*) n
          from echadas group by vehiculo_id, placa
        ) x), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function sgc.resumen_flota_carga_semana(int, int) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- REPORTE 7 — Bitácoras por obra vs días laborables ("Torre Alpha: 5/6 días").
--   Días laborables = lunes a sábado (6) — la construcción trabaja sábado.
--   Incluye obras activas SIN bitácora (el "quién no está llenando").
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.resumen_bitacoras_semana(
  p_anio int default null, p_semana int default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  return (
    with obras as (
      select p.id, coalesce(p.codigo || ' · ' || p.nombre, p.nombre) obra
      from sgc.proyectos p
      where coalesce(p.activo, true)
        and not coalesce(p.es_prueba, false)
        and coalesce(p.estado,'') not in ('cerrado','cerrada','finalizado','finalizada')
    ),
    dias as (
      select b.proyecto_id, count(distinct b.fecha) d
      from sgc.bitacoras b
      where b.fecha between v_ini and v_fin
        and not coalesce(b.es_prueba, false)
      group by b.proyecto_id
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'dias_laborables', 6,
      'total_bitacoras', coalesce((select sum(d) from dias), 0),
      'por_obra', coalesce((
        select jsonb_agg(jsonb_build_object(
          'obra', o.obra,
          'dias_con_bitacora', coalesce(d.d, 0),
          'dias_laborables', 6) order by coalesce(d.d, 0) asc, o.obra)
        from obras o
        left join dias d on d.proyecto_id = o.id), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function sgc.resumen_bitacoras_semana(int, int) to authenticated, service_role;

commit;
