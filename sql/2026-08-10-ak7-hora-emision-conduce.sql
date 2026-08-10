-- =============================================================================
-- PROMPT-1 FASE 5 (AK7) — Hora de emisión del conduce en los listados. SGC padre.
-- Aditivo. El card de "pendientes de entrega" (mis_conduces_pendientes_entrega) ya
-- devuelve created_at; aquí se añade created_at (timestamp de emisión) al histórico
-- del transportista (mis_conduces_hoy) y al detalle de ruta (ruta_detalle_transporte
-- → conduces) para que la app pinte fecha Y hora.
-- Nota AK8: verificado server-side que el stock del destino SOLO sube al confirmar la
-- recepción (conduce_confirmar_receptor/recibir_conduce_app insertan detalle_entradas
-- con guard not-exists + for update → sin doble conteo). No requiere cambio de datos.
-- =============================================================================

begin;

create or replace function sgc.mis_conduces_hoy()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'fecha', s.fecha, 'created_at', s.created_at, 'estado', s.estado,
    'destino', p.nombre, 'bodega', b.nombre,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'detalle_id', d.id, 'articulo', a.nombre, 'unidad', a.unidad,
        'cantidad', d.cantidad, 'propiedad', a.propiedad, 'imagen_url', a.imagen_url)), '[]'::jsonb)
      from sgc.detalle_salidas d
      join sgc.articulos a on a.id = d.articulo_id
      where d.salida_id = s.id
    )
  ) order by s.created_at desc), '[]'::jsonb)
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas b on b.id = s.bodega_id
  where s.estado = 'despachado'
    and s.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid())
    and ((not coalesce(s.es_prueba, false)) or sgc.is_admin());
$function$;

CREATE OR REPLACE FUNCTION sgc.ruta_detalle_transporte(p_ruta_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
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
        'id', s.id, 'fecha', s.fecha, 'created_at', s.created_at, 'estado', s.estado,
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

commit;
