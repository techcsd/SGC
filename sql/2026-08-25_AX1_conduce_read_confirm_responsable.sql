-- ============================================================================
-- AX1 — El ingeniero de campo (responsable de la obra destino) debe poder VER y
-- FIRMAR el conduce que recibe en "Entregas por firmar".
--
-- Diagnóstico (25-ago-2026): tanto la RLS de lectura como el RPC de confirmación
-- reconocían el vínculo usuario↔obra SOLO por `proyecto_empleados`. Los ingenieros
-- están vinculados por `proyecto_responsables` (verificado: 100% como responsable,
-- 0 como empleado) → quedaban fuera de la lectura Y de la confirmación. Es el
-- tercer sabor del bug de coherencia (AX1): acción concedida sin la lectura que la
-- sustenta — aquí, ni acción ni lectura para el receptor real.
--
-- Fix (aditivo, retrocompatible): nuevas policies permisivas de SELECT + amplía la
-- autorización del RPC, reutilizando el helper existente
-- `sgc.es_responsable_de_proyecto(proyecto_id)` (STABLE SECURITY DEFINER, ya cubre
-- responsable principal + proyecto_responsables activos). Una sola regla: quien es
-- responsable de la obra destino puede leer el conduce completo y confirmarlo.
-- ============================================================================

-- 1) salidas_inventario — cabecera (origen/destino/estado/firmas de cabecera).
drop policy if exists "salidas_inventario: select responsable" on sgc.salidas_inventario;
create policy "salidas_inventario: select responsable" on sgc.salidas_inventario
  for select using (sgc.es_responsable_de_proyecto(proyecto_id));

-- 2) detalle_salidas — items y cantidades del conduce.
drop policy if exists "detalle_salidas: select responsable" on sgc.detalle_salidas;
create policy "detalle_salidas: select responsable" on sgc.detalle_salidas
  for select using (exists (
    select 1 from sgc.salidas_inventario si
    where si.id = detalle_salidas.salida_id
      and sgc.es_responsable_de_proyecto(si.proyecto_id)));

-- 3) salida_firmas — firmas previas (emisor / despachante).
drop policy if exists "salida_firmas: select responsable" on sgc.salida_firmas;
create policy "salida_firmas: select responsable" on sgc.salida_firmas
  for select using (exists (
    select 1 from sgc.salidas_inventario si
    where si.id = salida_firmas.salida_id
      and sgc.es_responsable_de_proyecto(si.proyecto_id)));

-- 4) salida_items_libres — material no catalogado del conduce (AU4).
drop policy if exists "salida_items_libres: select responsable" on sgc.salida_items_libres;
create policy "salida_items_libres: select responsable" on sgc.salida_items_libres
  for select using (exists (
    select 1 from sgc.salidas_inventario si
    where si.id = salida_items_libres.salida_id
      and sgc.es_responsable_de_proyecto(si.proyecto_id)));

-- 5) confirmar_recepcion_salida — el responsable de la obra destino también puede
--    confirmar/firmar (acción = lectura, una sola matriz). Único cambio: se añade
--    la rama `es_responsable_de_proyecto` a la autorización; el resto es idéntico.
CREATE OR REPLACE FUNCTION sgc.confirmar_recepcion_salida(p_salida_id uuid, p_items jsonb, p_notas text, p_receptor text DEFAULT NULL::text, p_foto_path text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
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
    -- AX1 — el responsable de la obra destino (ingeniero de campo) también recibe/firma.
    or (v_salida.proyecto_id is not null and sgc.es_responsable_de_proyecto(v_salida.proyecto_id))
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  into v_autorizado;
  if not v_autorizado then raise exception 'No autorizado para confirmar esta entrega.'; end if;

  -- AH7 — foto de evidencia OBLIGATORIA.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
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
