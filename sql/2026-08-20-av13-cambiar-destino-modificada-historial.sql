-- ════════════════════════════════════════════════════════════════════════════
-- AV13 — Cambiar destino con paridad + "(modificada)" + historial + re-notificar
-- ════════════════════════════════════════════════════════════════════════════
-- (a) Paridad del selector: cambiar_destino_ruta ya acepta destino de texto +
--     obra (p_proyecto_id) + pin de mapa (p_lat/p_lng) → cubre mapa/manual/obra/
--     almacén central/almacén (el mismo LocationPicker del wizard de creación).
-- (b) Indicador de modificación: columna rutas.modificada_at → la UI pinta
--     "(modificada) · 18/08 3:42 pm" en listados y detalle.
-- (c) Historial: ruta_eventos ya guarda 'destino_cambiado' (de→a, cuándo, quién);
--     se expone con nombres vía ruta_historial() y en ruta_detalle_transporte.
-- (d) Re-notificar: el cambio de destino avisa al chofer (y al creador) — la ruta
--     ahora va a otro lugar.
-- Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

alter table sgc.rutas add column if not exists modificada_at timestamptz;
comment on column sgc.rutas.modificada_at is
  'AV13 — última modificación relevante de la ruta (cambio de destino). Null = nunca modificada. La UI muestra "(modificada) · hora".';

-- ── cambiar_destino_ruta: sella modificada_at + re-notifica ───────────────────
create or replace function sgc.cambiar_destino_ruta(
  p_ruta_id uuid, p_destino text, p_proyecto_id uuid default null,
  p_lat numeric default null, p_lng numeric default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_antes    text;
  v_cond_uid uuid;
  v_creador  uuid;
  v_uid      uuid := auth.uid();
  v_placa    text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.puede_modificar_ruta(p_ruta_id) then raise exception 'No autorizado para modificar esta ruta'; end if;
  if coalesce(trim(p_destino),'') = '' then raise exception 'Falta el nuevo destino'; end if;

  select r.destino, co.usuario_id, r.creado_por, v.placa
    into v_antes, v_cond_uid, v_creador, v_placa
    from sgc.rutas r
    left join sgc.conductores co on co.id = r.conductor_id
    left join sgc.vehiculos v on v.id = r.vehiculo_id
   where r.id = p_ruta_id;

  -- no-op si el destino no cambió realmente (evita historial y avisos de ruido)
  if lower(trim(coalesce(v_antes,''))) = lower(trim(p_destino))
     and p_proyecto_id is null then
    return;
  end if;

  update sgc.rutas
     set destino = p_destino,
         destino_proyecto_id = coalesce(p_proyecto_id, destino_proyecto_id),
         destino_lat = coalesce(p_lat, destino_lat),
         destino_lng = coalesce(p_lng, destino_lng),
         modificada_at = now(),
         updated_at = now()
   where id = p_ruta_id;

  perform sgc._log_ruta_evento(p_ruta_id, 'destino_cambiado',
    format('%s → %s', coalesce(v_antes,'—'), p_destino), p_lat, p_lng);

  -- (d) Re-notificar al chofer y al creador (menos a quien hizo el cambio).
  if v_cond_uid is not null and v_cond_uid <> v_uid then
    perform sgc.notificar(v_cond_uid, 'info', 'Destino de ruta cambiado',
      format('%s → %s', coalesce(v_placa,'La ruta'), p_destino), '/transporte/conduces');
  end if;
  if v_creador is not null and v_creador <> v_uid and v_creador is distinct from v_cond_uid then
    perform sgc.notificar(v_creador, 'info', 'Destino de ruta cambiado',
      format('%s → %s', coalesce(v_placa,'La ruta'), p_destino), '/flota/rutas');
  end if;
end;
$$;
grant execute on function sgc.cambiar_destino_ruta(uuid, text, uuid, numeric, numeric) to authenticated, service_role;
comment on function sgc.cambiar_destino_ruta is
  'AF25 + AV13 — cambia el destino (mapa/manual/obra/almacén), sella modificada_at, registra el historial (destino_cambiado) y re-notifica al chofer/creador.';

-- ── ruta_historial: eventos de la ruta con nombre de quién los hizo ───────────
create or replace function sgc.ruta_historial(p_ruta_id uuid)
returns table (
  id         uuid,
  tipo       text,
  detalle    text,
  por_nombre text,
  created_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select e.id, e.tipo, e.detalle, u.nombre, e.created_at
  from sgc.ruta_eventos e
  left join sgc.usuarios u on u.id = e.por
  where e.ruta_id = p_ruta_id
    and exists (select 1 from sgc.rutas r where r.id = e.ruta_id
                and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
                     or r.conductor_id in (select sgc.mis_conductor_ids())))
  order by e.created_at desc;
$$;
grant execute on function sgc.ruta_historial(uuid) to authenticated, service_role;
comment on function sgc.ruta_historial(uuid) is
  'AV13 — historial de eventos de una ruta (cambios de destino, paradas, inicio/fin) con nombre del autor. Regla AT11: toda modificación es visualizable.';

-- ── ruta_detalle_transporte: agrega modificada_at + eventos ───────────────────
create or replace function sgc.ruta_detalle_transporte(p_ruta_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
    'ruta', (
      select jsonb_build_object(
        'id', r.id, 'origen', r.origen, 'destino', r.destino,
        'estado', r.estado, 'tipo', r.tipo, 'fecha', r.fecha,
        'iniciada_at', r.iniciada_at, 'finalizada_at', r.finalizada_at,
        'modificada_at', r.modificada_at,
        'km_estimado', r.km_estimado, 'km_real', r.km_real,
        'tiempo_estimado_min', r.tiempo_estimado_min,
        'tiempo_real_min', r.tiempo_real_min,
        'duracion_min', case
          when r.iniciada_at is not null and r.finalizada_at is not null
            then round(extract(epoch from (r.finalizada_at - r.iniciada_at)) / 60.0)::int
          else r.tiempo_real_min
        end,
        'conductor_id', r.conductor_id, 'vehiculo_id', r.vehiculo_id
      )
      from sgc.rutas r where r.id = p_ruta_id
    ),
    'eventos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'tipo', e.tipo, 'detalle', e.detalle, 'por', u.nombre, 'created_at', e.created_at
      ) order by e.created_at desc), '[]'::jsonb)
      from sgc.ruta_eventos e left join sgc.usuarios u on u.id = e.por
      where e.ruta_id = p_ruta_id
    ),
    'trayecto', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lat', cp.lat, 'lng', cp.lng, 'capturado_en', cp.capturado_en
      ) order by cp.capturado_en), '[]'::jsonb)
      from sgc.chofer_posiciones cp
      join sgc.rutas r2 on r2.id = p_ruta_id
      join sgc.conductores co on co.id = r2.conductor_id
      where cp.usuario_id = co.usuario_id
        and cp.capturado_en >= coalesce(r2.iniciada_at, r2.created_at)
        and cp.capturado_en <= coalesce(r2.finalizada_at, now())
        and ((not coalesce(cp.es_prueba, false)) or sgc.is_admin())
    ),
    'paradas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pa.id, 'orden', pa.orden, 'ubicacion', pa.ubicacion,
        'lat', pa.lat, 'lng', pa.lng, 'notas', pa.notas,
        'obra', pr.nombre, 'proyecto_id', pa.proyecto_id,
        'estado', pa.estado, 'llegada_at', pa.llegada_at, 'entregada_at', pa.entregada_at,
        'entregado_a', pa.entregado_a, 'foto_path', pa.foto_path, 'firma_path', pa.firma_path,
        'notas_entrega', pa.notas_entrega,
        'conduce_id', (select s2.id from sgc.salidas_inventario s2 where s2.ruta_parada_id = pa.id limit 1)
      ) order by pa.orden), '[]'::jsonb)
      from sgc.ruta_paradas pa
      left join sgc.proyectos pr on pr.id = pa.proyecto_id
      where pa.ruta_id = p_ruta_id
    ),
    'conduces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'fecha', s.fecha, 'estado', s.estado,
        'destino', p.nombre, 'bodega', b.nombre,
        'ruta_parada_id', s.ruta_parada_id, 'parada_ubicacion', pp.ubicacion,
        'foto_path', s.foto_path, 'entrega_foto_path', s.entrega_foto_path,
        'recepcion_foto_path', s.recepcion_foto_path, 'carga_foto_path', s.carga_foto_path,
        'despachante', s.despachante_nombre,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'articulo', a.nombre, 'unidad', a.unidad, 'cantidad', d.cantidad,
            'cantidad_recibida', d.cantidad_recibida, 'propiedad', a.propiedad)), '[]'::jsonb)
          from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
          where d.salida_id = s.id
        )
      ) order by s.created_at), '[]'::jsonb)
      from sgc.salidas_inventario s
      left join sgc.proyectos p on p.id = s.proyecto_id
      left join sgc.bodegas b on b.id = s.bodega_id
      left join sgc.ruta_paradas pp on pp.id = s.ruta_parada_id
      where s.ruta_id = p_ruta_id
        and ((not coalesce(s.es_prueba,false)) or sgc.is_admin())
    ),
    'notas_voz', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id, 'bucket', n.bucket, 'path', n.path,
        'duracion_seg', n.duracion_seg, 'created_at', n.created_at) order by n.created_at), '[]'::jsonb)
      from sgc.audio_notas n
      where n.entidad_tipo = 'ruta' and n.entidad_id = p_ruta_id
        and ((not coalesce(n.es_prueba,false)) or sgc.is_admin())
    )
  );
$function$;
grant execute on function sgc.ruta_detalle_transporte(uuid) to authenticated, service_role;

-- ── rutas_activas_y_hoy: agrega modificada_at (para el chip "(modificada)") ────
drop function if exists sgc.rutas_activas_y_hoy();
create or replace function sgc.rutas_activas_y_hoy()
returns table (
  id                 uuid,
  seccion            text,
  estado             text,
  tipo               text,
  origen             text,
  destino            text,
  placa              text,
  conductor_nombre   text,
  fecha              date,
  iniciada_at        timestamptz,
  modificada_at      timestamptz,
  paradas_total      int,
  paradas_entregadas int
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    r.id,
    case when r.estado = 'en_curso' then 'activa' else 'hoy' end as seccion,
    r.estado, r.tipo, r.origen, r.destino, v.placa, c.nombre, r.fecha, r.iniciada_at, r.modificada_at,
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id),
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id and p.estado = 'entregada')
  from sgc.rutas r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  left join sgc.conductores c on c.id = r.conductor_id
  where (sgc.es_flota_elevado() or r.creado_por = auth.uid() or r.conductor_id in (select sgc.mis_conductor_ids()))
    and (r.estado = 'en_curso' or r.fecha = current_date)
  order by (case when r.estado = 'en_curso' then 0 else 1 end), r.iniciada_at desc nulls last, r.fecha desc;
$$;
grant execute on function sgc.rutas_activas_y_hoy() to authenticated, service_role;
