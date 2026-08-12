-- AO4 (re-reporte AL4) — Contrato del PDF del conduce, compartible por la app.
--
-- Decisión de arquitectura: NO se genera un PDF server-side (Deno no tiene motor de
-- PDF fiable y duplicaría el template Angular de la web). El contrato ÚNICO para que la
-- app arme y comparta el PDF (share sheet nativo → WhatsApp) es la RPC ya existente
-- sgc.conduce_detalle_app(id): trae número, fecha, obra, almacenes, portador actual,
-- items (nombre/código/unidad/cant/recibida), firmas, transferencias, fotos y notas.
-- La web mantiene window.print() ("Guardar como PDF" del navegador) sobre el mismo
-- conjunto de datos → un solo origen de verdad, sin duplicar plantillas.
--
-- Aquí SOLO se COMPLETA el contrato con los campos de firma legacy que la vista web
-- imprimible usa como fallback en conduces antiguos (antes de salida_firmas canónico),
-- para que el PDF de la app sea idéntico al de la web también en esos casos. Aditivo:
-- añade claves nuevas al JSON, no cambia las existentes.

set search_path = sgc, public;

create or replace function sgc.conduce_detalle_app(p_salida_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_out jsonb;
  v_puede boolean;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  v_puede := sgc.is_admin()
    or v_s.creado_por = auth.uid()
    or v_s.entregado_por = auth.uid()
    or v_s.recibido_por = auth.uid()
    or exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = auth.uid())
    or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_puede then
    raise exception 'No autorizado para ver este conduce.';
  end if;

  select jsonb_build_object(
    'id', v_s.id,
    'numero', 'CND-' || upper(left(v_s.id::text, 8)),
    'fecha', v_s.fecha,
    'created_at', v_s.created_at,
    'estado', v_s.estado,
    'fase', sgc.conduce_fase(v_s.id),
    'motivo', v_s.motivo,
    'responsable', v_s.responsable,
    'observaciones', v_s.observaciones,
    'proyecto_id', v_s.proyecto_id,
    'proyecto', (select nombre from sgc.proyectos where id = v_s.proyecto_id),
    'bodega_id', v_s.bodega_id,
    'bodega', (select nombre from sgc.bodegas where id = v_s.bodega_id),
    'destino_almacen_id', v_s.destino_almacen_id,
    'destino_almacen', (select nombre from sgc.bodegas where id = v_s.destino_almacen_id),
    'conductor_id', v_s.conductor_id,
    'conductor', (select u.nombre from sgc.conductores c
                    left join sgc.usuarios u on u.id = c.usuario_id
                  where c.id = v_s.conductor_id),
    'creado_por', v_s.creado_por,
    'creado_por_nombre', (select nombre from sgc.usuarios where id = v_s.creado_por),
    'entregado_por', v_s.entregado_por,
    'entregado_por_nombre', (select nombre from sgc.usuarios where id = v_s.entregado_por),
    'entregado_en', v_s.entregado_en,
    'entrega_foto_path', v_s.entrega_foto_path,
    -- AO4 — campos legacy de firma/receptor (fallback para conduces antiguos)
    'entrega_receptor', v_s.entrega_receptor,
    'entrega_firma_path', v_s.entrega_firma_path,
    'firma_path', v_s.firma_path,
    'firma_pendiente_nombre', v_s.firma_pendiente_nombre,
    'recibido_por', v_s.recibido_por,
    'recibido_por_nombre', (select nombre from sgc.usuarios where id = v_s.recibido_por),
    'recibido_en', v_s.recibido_en,
    'recepcion_foto_path', v_s.recepcion_foto_path,
    'notas_recepcion', v_s.notas_recepcion,
    'ruta_id', v_s.ruta_id,
    'es_prueba', coalesce(v_s.es_prueba, false),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'detalle_id', d.id,
                'articulo_id', d.articulo_id,
                'articulo', a.nombre,
                'codigo', a.codigo,
                'unidad', a.unidad,
                'propiedad', a.propiedad,
                'cantidad', d.cantidad,
                'cantidad_recibida', d.cantidad_recibida)
                order by a.nombre)
              from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
              where d.salida_id = v_s.id), '[]'::jsonb),
    'firmas', coalesce((select jsonb_agg(jsonb_build_object(
                'rol', sf.rol, 'nombre', sf.nombre, 'firma_path', sf.firma_path, 'firmado_en', sf.firmado_en))
               from sgc.salida_firmas sf where sf.salida_id = v_s.id), '[]'::jsonb),
    'transferencias', coalesce((select jsonb_agg(jsonb_build_object(
                'id', t.id, 'estado', t.estado, 'fase_al_transferir', t.fase_al_transferir,
                'de', (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.de_conductor_id),
                'a',  (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.a_conductor_id),
                'ofrecida_en', t.ofrecida_en, 'resuelta_en', t.resuelta_en)
                order by t.ofrecida_en)
               from sgc.conduce_transferencias t where t.salida_id = v_s.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

grant execute on function sgc.conduce_detalle_app(uuid) to authenticated, service_role;

comment on function sgc.conduce_detalle_app(uuid) is
  'AL9/AL13/AL4/AO4 — contrato ÚNICO del conduce para vista/PDF compartible (web imprime, app arma PDF y comparte). numero derivado, items, portador actual, fotos, firmas (canónicas + legacy), transferencias. Visibilidad: portador/creador/entregó/recibió/confirmador/flota/inventario/admin.';
