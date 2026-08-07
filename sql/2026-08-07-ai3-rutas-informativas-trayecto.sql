-- ============================================================================
-- AI3 — Rutas informativas: detalle con H.I/H.F, duración, km y TRAYECTO.
--       SGC padre. Aditivo/retrocompatible.
-- ----------------------------------------------------------------------------
-- La ruta es el registro (informativo) del MOVIMIENTO; el documento con peso es
-- el conduce. El detalle de una ruta finalizada debe mostrar: origen→destino,
-- hora inicio (iniciada_at) y fin (finalizada_at), duración total, km totales y
-- el TRAYECTO recorrido (del tracking AF27, chofer_posiciones).
--
-- Esta migración amplía ruta_detalle_transporte(uuid) agregando:
--   • 'ruta'      → cabecera con estado, fechas, km y duración calculada.
--   • 'trayecto'  → posiciones del chofer de la ruta entre inicio y fin.
-- Conserva 'paradas', 'conduces' y 'notas_voz' (AE5) sin cambios.
--
-- AI5 (foto de crear ruta opcional/genérica): NO requiere cambio de servidor —
-- las fotos de ruta viven en la tabla opcional sgc.ruta_fotos y NINGÚN RPC de
-- creación de ruta las exige (crear_ruta_app / insert directo web). La foto es ya
-- opcional a nivel de datos; el label ("Foto opcional", sin referir a material) y
-- el paso son de UI (PROMPT-12). Las fotos del CONDUCE siguen obligatorias.
-- AI4 (formato "Xh Ym"): helper de presentación (web/app), sin cambio de datos.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.ruta_detalle_transporte(p_ruta_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
    -- AI3 — cabecera de la ruta (informativa).
    'ruta', (
      select jsonb_build_object(
        'id', r.id, 'origen', r.origen, 'destino', r.destino,
        'estado', r.estado, 'tipo', r.tipo, 'fecha', r.fecha,
        'iniciada_at', r.iniciada_at, 'finalizada_at', r.finalizada_at,
        'km_estimado', r.km_estimado, 'km_real', r.km_real,
        'tiempo_estimado_min', r.tiempo_estimado_min,
        'tiempo_real_min', r.tiempo_real_min,
        -- Duración total en minutos: preferimos la real (fin−inicio); si no, la reportada.
        'duracion_min', case
          when r.iniciada_at is not null and r.finalizada_at is not null
            then round(extract(epoch from (r.finalizada_at - r.iniciada_at)) / 60.0)::int
          else r.tiempo_real_min
        end,
        'conductor_id', r.conductor_id, 'vehiculo_id', r.vehiculo_id
      )
      from sgc.rutas r where r.id = p_ruta_id
    ),
    -- AI3 — trayecto recorrido (tracking AF27) del chofer de la ruta.
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
