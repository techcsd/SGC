-- sql/2026-10-29-db14-tablero-vivo.sql — Ronda DB (PROMPT-124 F8, DB1)
-- «Hoy, en vivo» en el Inicio: KPIs del día, flujo de pedidos por etapa, últimos
-- eventos y posiciones de la flota — UNA llamada (`tablero_vivo_resumen()`), y el
-- cliente re-pide al recibir un evento de Realtime (debounce 2 s) o cada 30 s de
-- polling si Realtime no está disponible. Nada se calcula en el cliente.
--
-- Gate (DB-14): módulos inventario / flota / proyectos / direccion o admin.
-- es_prueba: visible solo para admin (los demás ven solo datos reales).
--
-- Realtime: agrega a la publicación `supabase_realtime` las tablas que faltan
-- (en dev NO había NINGUNA tabla sgc — F0). En prod ya están solicitudes_material,
-- salidas_inventario y chofer_ultima_posicion; faltan vehiculo_usos,
-- registros_combustible y bitacoras (se agregan con el OK de Xaviel).
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db14-tablero-vivo.sql --env dev

-- ── 1) Realtime: tablas del tablero (idempotente) ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'solicitudes_material','salidas_inventario','vehiculo_usos',
    'registros_combustible','bitacoras','chofer_ultima_posicion'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'sgc' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table sgc.%I', t);
    end if;
  end loop;
end $$;

-- ── 2) RPC única del tablero ──────────────────────────────────────────────────
create or replace function sgc.tablero_vivo_resumen()
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_admin boolean := sgc.is_admin();
  v_kpis jsonb;
  v_flujo jsonb;
  v_eventos jsonb;
  v_flota jsonb;
begin
  if not (v_admin or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No tienes acceso al tablero en vivo.' using errcode = '42501';
  end if;

  -- KPIs del día (es_prueba solo lo ve admin).
  select jsonb_build_object(
    'requisiciones_hoy', (select count(*) from sgc.solicitudes_material s
       where (s.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))),
    'conduces_hoy', (select count(*) from sgc.salidas_inventario sa
       where (sa.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and sa.estado <> 'anulado' and (v_admin or not coalesce(sa.es_prueba, false))),
    'entregas_hoy', (select count(*) from sgc.salidas_inventario sa
       where sa.entregado_en is not null
         and (sa.entregado_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(sa.es_prueba, false))),
    'echadas_hoy', (select count(*) from sgc.registros_combustible rc
       where rc.fecha = v_hoy and not coalesce(rc.invalidada, false)
         and (v_admin or not coalesce(rc.es_prueba, false))),
    'vehiculos_en_uso', (select count(distinct vu.vehiculo_id) from sgc.vehiculo_usos vu
       where vu.fin_at is null and (v_admin or not coalesce(vu.es_prueba, false))),
    'bitacoras_hoy', (select count(*) from sgc.bitacoras b
       where (b.created_at at time zone 'America/Santo_Domingo')::date = v_hoy)
  ) into v_kpis;

  -- Flujo de pedidos (del día): solicitada → aprobada → despachada → en ruta → entregada.
  select jsonb_build_object(
    'solicitada', (select count(*) from sgc.solicitudes_material s
       where (s.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and s.estado = 'pendiente' and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))),
    'aprobada', (select count(*) from sgc.solicitudes_material s
       where s.atendido_en is not null
         and (s.atendido_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))),
    'despachada', (select count(*) from sgc.salidas_inventario sa
       where (sa.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and sa.estado = 'despachado' and sa.transito_at is null
         and (v_admin or not coalesce(sa.es_prueba, false))),
    'en_ruta', (select count(*) from sgc.salidas_inventario sa
       where sa.transito_at is not null and sa.entregado_en is null
         and sa.estado = 'despachado'
         and (v_admin or not coalesce(sa.es_prueba, false))),
    'entregada', (select count(*) from sgc.salidas_inventario sa
       where sa.entregado_en is not null
         and (sa.entregado_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(sa.es_prueba, false)))
  ) into v_flujo;

  -- Últimos 8 eventos del día (unión de los flujos que ya se registran).
  select coalesce(jsonb_agg(e order by e->>'at' desc), '[]'::jsonb) into v_eventos
  from (
    select to_jsonb(x) as e from (
      (select 'requisicion'::text as tipo, 'Requisición ' || coalesce(s.folio::text,'') as titulo,
              coalesce((select p.nombre from sgc.proyectos p where p.id = s.proyecto_id), '') as detalle,
              s.created_at as at
       from sgc.solicitudes_material s
       where (s.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))
       order by s.created_at desc limit 8)
      union all
      (select 'conduce', 'Conduce despachado',
              coalesce((select p.nombre from sgc.proyectos p where p.id = sa.proyecto_id), ''),
              sa.created_at
       from sgc.salidas_inventario sa
       where (sa.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and sa.estado <> 'anulado' and (v_admin or not coalesce(sa.es_prueba, false))
       order by sa.created_at desc limit 8)
      union all
      (select 'entrega', 'Conduce entregado',
              coalesce(sa.entrega_receptor, ''),
              sa.entregado_en
       from sgc.salidas_inventario sa
       where sa.entregado_en is not null
         and (sa.entregado_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(sa.es_prueba, false))
       order by sa.entregado_en desc limit 8)
      union all
      (select 'combustible', 'Echada de combustible',
              coalesce((select v.alias from sgc.vehiculos v where v.id = rc.vehiculo_id),
                       (select v.placa from sgc.vehiculos v where v.id = rc.vehiculo_id), ''),
              rc.created_at
       from sgc.registros_combustible rc
       where rc.fecha = v_hoy and not coalesce(rc.invalidada, false)
         and (v_admin or not coalesce(rc.es_prueba, false))
       order by rc.created_at desc limit 8)
      union all
      (select 'uso', 'Vehículo en uso',
              coalesce((select v.alias from sgc.vehiculos v where v.id = vu.vehiculo_id),
                       (select v.placa from sgc.vehiculos v where v.id = vu.vehiculo_id), ''),
              vu.inicio_at
       from sgc.vehiculo_usos vu
       where (vu.inicio_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(vu.es_prueba, false))
       order by vu.inicio_at desc limit 8)
      union all
      (select 'bitacora', 'Bitácora registrada',
              coalesce((select p.nombre from sgc.proyectos p where p.id = b.proyecto_id), ''),
              b.created_at
       from sgc.bitacoras b
       where (b.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
       order by b.created_at desc limit 8)
    ) x
    order by x.at desc limit 8
  ) ult;

  -- Flota en vivo: última posición de HOY por vehículo (la manda la app).
  select coalesce(jsonb_agg(jsonb_build_object(
      'vehiculo_id', cp.vehiculo_id,
      'placa', v.placa,
      'alias', v.alias,
      'chofer', u.nombre,
      'lat', cp.lat, 'lng', cp.lng,
      'capturado_en', cp.capturado_en)), '[]'::jsonb)
  into v_flota
  from sgc.chofer_ultima_posicion cp
  join sgc.vehiculos v on v.id = cp.vehiculo_id
  left join sgc.usuarios u on u.id = cp.usuario_id
  where (cp.capturado_en at time zone 'America/Santo_Domingo')::date = v_hoy
    and (v_admin or not coalesce(v.es_prueba, false));

  return jsonb_build_object(
    'kpis', v_kpis, 'flujo', v_flujo, 'eventos', v_eventos, 'flota', v_flota,
    'generado_en', now());
end $function$;
grant execute on function sgc.tablero_vivo_resumen() to authenticated;
