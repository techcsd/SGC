-- ============================================================================
-- BD2b — Espejo web de la política BD2: la FOTO de recepción es obligatoria PERO
-- NO BLOQUEANTE. La web (confirmar_recepcion_salida, bandeja "Confirmar entregas")
-- exigía foto siempre (salvo admin) y bloqueaba al receptor si la cámara/permiso/
-- señal fallaban. Ahora, igual que conduce_confirmar_receptor (app), se acepta
-- confirmar SIN foto SIEMPRE que se explique por qué en las NOTAS. La FIRMA del
-- receptor sigue siendo obligatoria (salvo admin) — no se firma a ciegas.
--
-- Cambio ADITIVO y retrocompatible: misma firma (6 args), mismo matriz de permisos
-- (admin | inventario | proyecto_empleado | responsable | capataz | conductor),
-- misma escritura (salida_firmas.receptor por sesión + recepcion_confirmaciones +
-- entrada en obra). SOLO cambia la validación de la foto. La web que sigue mandando
-- foto siempre no nota diferencia.
-- ============================================================================

begin;
set local search_path = sgc, public;

create or replace function sgc.confirmar_recepcion_salida(
  p_salida_id uuid, p_items jsonb, p_notas text,
  p_receptor text default null, p_foto_path text default null, p_firma_path text default null
)
returns boolean
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_autorizado boolean; v_incompleto boolean; v_item jsonb;
  v_recibida numeric; v_enviada numeric; v_nombre text;
  v_bodega_obra_id uuid; v_entrada_id uuid; v_notas text; v_yo text;
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

  -- BD2 — foto OBLIGATORIA pero NO BLOQUEANTE: se exige foto O una nota que explique
  -- por qué no se pudo tomar (cámara/permiso/sin señal). Antes se exigía foto siempre.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null
     and nullif(trim(coalesce(p_notas,'')),'') is null
     and not sgc.is_admin() then
    raise exception 'Toma la foto de la recepción; si no puedes, explica por qué en las notas.';
  end if;
  -- AY2 — firma del receptor obligatoria SALVO admin (no se firma a ciegas).
  if nullif(trim(coalesce(p_firma_path,'')),'') is null and not sgc.is_admin() then
    raise exception 'La firma del receptor es obligatoria para confirmar la recepción.';
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
      recepcion_foto_path = coalesce(p_foto_path, recepcion_foto_path),
      -- BD2 — mata el fantasma de la doble bandeja: si venía con firma pendiente,
      -- confirmar YA salda la firma del receptor (ver salida_firmas abajo).
      firma_pendiente_usuario_id = null,
      firma_pendiente_nombre     = null,
      firma_pendiente_almacen    = false
  where id = p_salida_id;

  -- AY2 — firma del receptor (directo; el responsable/capataz no pasa firmar_conduce).
  -- Identidad de SESIÓN: el nombre sale de usuarios (p_receptor solo como fallback
  -- para la firma en persona de un no-usuario). usuario_id = auth.uid() deja la traza.
  if nullif(trim(coalesce(p_firma_path,'')),'') is not null then
    select nombre into v_yo from sgc.usuarios where id = auth.uid();
    delete from sgc.salida_firmas where salida_id = p_salida_id and rol = 'receptor';
    insert into sgc.salida_firmas (salida_id, rol, nombre, usuario_id, firma_path, metodo)
    values (p_salida_id, 'receptor', coalesce(v_yo, nullif(p_receptor,''), 'Receptor'), auth.uid(), p_firma_path, 'pad');
  end if;

  -- AY2 — registro de confirmación (paridad con conduce_confirmar_receptor).
  insert into sgc.recepcion_confirmaciones (entidad_tipo, entidad_id, confirmado_por, modo, fotos, notas, es_prueba)
  values ('salida', p_salida_id, auth.uid(), 'presencial',
          case when nullif(p_foto_path,'') is not null then array[p_foto_path] else '{}'::text[] end,
          v_notas, coalesce(v_salida.es_prueba, false));

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
grant execute on function sgc.confirmar_recepcion_salida(uuid, jsonb, text, text, text, text) to authenticated, service_role;

commit;
