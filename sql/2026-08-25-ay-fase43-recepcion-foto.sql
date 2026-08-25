-- ============================================================================
-- AY FASE 4.3 — Recepción de conduces: foto de evidencia CONFIGURABLE (AY1).
--
-- Hoy la foto es SIEMPRE obligatoria (AH7). El flujo web del ingeniero
-- (/bitacora/entregas) no capturaba foto → el server rechazaba "foto obligatoria"
-- y la recepción quedaba rota. Decisión Xaviel (AY1): foto obligatoria por
-- defecto, con BYPASS ADMIN (política AS15). Este cambio relaja el check a
-- "obligatoria salvo admin"; el frontend agrega la captura de foto.
--
-- (La taxonomía "por tipo de conduce" — varillas vs paquetería — requiere una
--  columna de tipo que hoy no existe; queda como refinamiento futuro. El bypass
--  admin cubre la excepción operativa por ahora.)
--
-- Resto del cuerpo idéntico a la versión en prod (AX1/AX2). Aditivo/retrocompat.
-- ============================================================================

begin;
set local search_path = sgc, public;

create or replace function sgc.confirmar_recepcion_salida(
  p_salida_id uuid, p_items jsonb, p_notas text,
  p_receptor text default null, p_foto_path text default null
)
returns boolean
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_autorizado boolean; v_incompleto boolean; v_item jsonb;
  v_recibida numeric; v_enviada numeric; v_nombre text;
  v_bodega_obra_id uuid; v_entrada_id uuid; v_notas text;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Salida no encontrada.'; end if;
  if v_salida.estado <> 'despachado' then raise exception 'Esta salida ya tiene una recepción confirmada.'; end if;

  select sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
    or (v_salida.proyecto_id is not null and sgc.es_responsable_de_proyecto(v_salida.proyecto_id))
    or (v_salida.proyecto_id is not null and sgc.es_capataz_de_proyecto(v_salida.proyecto_id))
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  into v_autorizado;
  if not v_autorizado then raise exception 'No autorizado para confirmar esta entrega.'; end if;

  -- AY1 — foto de evidencia obligatoria SALVO admin (bypass AS15).
  if nullif(trim(coalesce(p_foto_path,'')),'') is null and not sgc.is_admin() then
    raise exception 'La foto de evidencia es obligatoria para confirmar la recepción.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_recibida := (v_item->>'cantidad_recibida')::numeric;
    if v_recibida is not null and v_recibida < 0 then
      raise exception 'La cantidad recibida no puede ser negativa.';
    end if;
    select d.cantidad, a.nombre into v_enviada, v_nombre
    from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
    where d.id = (v_item->>'detalle_id')::uuid and d.salida_id = p_salida_id;
    if v_recibida is not null and v_enviada is not null and v_recibida > v_enviada then
      raise exception 'La cantidad recibida (%) de "%" no puede ser mayor que la enviada (%).',
        v_recibida, coalesce(v_nombre,'artículo'), v_enviada;
    end if;
    update sgc.detalle_salidas set cantidad_recibida = v_recibida
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  v_notas := concat_ws(' · ', nullif(p_notas,''),
    case when nullif(p_receptor,'') is not null then 'Recibió: '||p_receptor end);

  update sgc.salidas_inventario
  set estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
      recibido_por = auth.uid(), recibido_en = now(),
      notas_recepcion = v_notas,
      recepcion_foto_path = coalesce(p_foto_path, recepcion_foto_path)
  where id = p_salida_id;

  if v_salida.proyecto_id is not null then
    select id into v_bodega_obra_id from sgc.bodegas where proyecto_id = v_salida.proyecto_id limit 1;
    if v_bodega_obra_id is not null and v_bodega_obra_id <> v_salida.bodega_id then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, salida_id
      ) values (
        current_date, v_bodega_obra_id, 'Recepción de material despachado a la obra',
        v_notas, auth.uid(), 'recepcion_obra', v_salida.proyecto_id, p_salida_id
      ) returning id into v_entrada_id;
      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
      select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id and coalesce(d.cantidad_recibida, d.cantidad) > 0;
    end if;
  end if;

  return v_incompleto;
end;
$function$;
grant execute on function sgc.confirmar_recepcion_salida(uuid, jsonb, text, text, text) to authenticated, service_role;

commit;
