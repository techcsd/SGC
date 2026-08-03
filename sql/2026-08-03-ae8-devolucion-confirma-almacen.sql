-- AE8 — Devolución de material: opción "que confirme Almacén" (antifraude)
--
-- Decisión de Xaviel (2026-08-03): al devolver material, cuando el chofer se
-- ponía a sí mismo como receptor, la app auto-firmaba las DOS firmas (emisor +
-- receptor) con el mismo garabato → el antifraude de doble firma no protegía de
-- nada. Ahora esa opción MUEVE el stock pero deja la firma de RECIBIDO PENDIENTE
-- para que ALMACÉN la confirme (igual que la compra de ferretería). Como
-- sgc.bodegas NO tiene un "encargado" por persona, es una COLA COMPARTIDA:
-- cualquiera con el módulo inventario (o admin) la ve y la confirma.

-- 1) Marcador de "pendiente de confirmación por Almacén" (cola compartida).
alter table sgc.salidas_inventario
  add column if not exists firma_pendiente_almacen boolean not null default false;

-- 2) Overload de 13 args con p_confirmar_almacen. El de 12 args se conserva para
--    apps < 1.59 (PostgREST resuelve por el set exacto de claves enviadas).
create or replace function sgc.chofer_registrar_devolucion(
  p_id uuid,
  p_fecha date,
  p_bodega_destino_id uuid,
  p_origen_proyecto_id uuid,
  p_referencia text,
  p_observaciones text,
  p_items jsonb,
  p_emisor_nombre text,
  p_emisor_firma_path text,
  p_receptor_nombre text default null,
  p_receptor_usuario_id uuid default null,
  p_receptor_firma_path text default null,
  p_confirmar_almacen boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_entrada_id   uuid;
  v_bodega_orig  uuid;
  v_bodega_dest_nombre text;
  v_obra_nombre  text;
  v_item         jsonb;
  v_stock        numeric;
  v_nombre       text;
  v_ya           boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.es_chofer()) then
    raise exception 'Sin permiso para registrar devoluciones';
  end if;
  if p_bodega_destino_id is null then raise exception 'Falta el almacén destino.'; end if;
  if p_origen_proyecto_id is null then raise exception 'Selecciona la obra de origen.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un artículo.'; end if;
  if nullif(trim(coalesce(p_emisor_firma_path,'')),'') is null then raise exception 'Falta la firma de quien entrega.'; end if;
  -- AE8 — el receptor puede: firmar ahora, quedar pendiente enrutado a alguien, o
  -- quedar pendiente de ALMACÉN (p_confirmar_almacen).
  if not coalesce(p_confirmar_almacen,false)
     and nullif(p_receptor_firma_path,'') is null and p_receptor_usuario_id is null then
    raise exception 'Indica quién recibe: firma ahora, asígnalo, o deja que lo confirme Almacén.';
  end if;

  select nombre into v_obra_nombre from sgc.proyectos where id = p_origen_proyecto_id;
  if v_obra_nombre is null then raise exception 'Obra de origen no encontrada.'; end if;

  v_ya := exists (select 1 from sgc.salidas_inventario where id = p_id);

  if not v_ya then
    select id into v_bodega_orig
      from sgc.bodegas
     where proyecto_id = p_origen_proyecto_id and coalesce(activo, true)
     order by coalesce(es_principal, false) desc, created_at asc
     limit 1;
    if v_bodega_orig is null then
      raise exception 'La obra "%" no tiene almacén propio para descontar.', v_obra_nombre;
    end if;
    if v_bodega_orig = p_bodega_destino_id then
      raise exception 'El almacén de origen y el de destino no pueden ser el mismo.';
    end if;

    for v_item in select * from jsonb_array_elements(p_items) loop
      select s.cantidad, a.nombre into v_stock, v_nombre
        from sgc.stock_por_bodega s join sgc.articulos a on a.id = s.articulo_id
       where s.articulo_id = (v_item->>'articulo_id')::uuid and s.bodega_id = v_bodega_orig;
      v_stock := coalesce(v_stock, 0);
      if v_stock < (v_item->>'cantidad')::numeric then
        raise exception 'Stock insuficiente en "%": "%" disponible %, solicitado %.',
          v_obra_nombre, coalesce(v_nombre,'material'), v_stock, (v_item->>'cantidad')::numeric;
      end if;
    end loop;

    select nombre into v_bodega_dest_nombre from sgc.bodegas where id = p_bodega_destino_id;

    insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, observaciones, creado_por)
    values (p_id, coalesce(p_fecha, current_date), v_bodega_orig, p_origen_proyecto_id,
            format('Devolución a %s', coalesce(v_bodega_dest_nombre,'almacén')),
            nullif(p_observaciones,''), v_uid);
    insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad)
    select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
      from jsonb_array_elements(p_items) as i;

    insert into sgc.entradas_inventario (fecha, bodega_id, referencia, observaciones, creado_por,
                                         origen_tipo, origen_proyecto_id, salida_id)
    values (coalesce(p_fecha, current_date), p_bodega_destino_id,
            coalesce(nullif(p_referencia,''), format('Devolución de %s', v_obra_nombre)),
            nullif(p_observaciones,''), v_uid, 'devolucion_obra', p_origen_proyecto_id, p_id)
    returning id into v_entrada_id;
    insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
    select v_entrada_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
      from jsonb_array_elements(p_items) as i;
  end if;

  -- Firma del EMISOR (chofer) — upsert.
  insert into sgc.salida_firmas (salida_id, rol, nombre, rol_desc, usuario_id, firma_path)
  values (p_id, 'emisor', coalesce(nullif(trim(p_emisor_nombre),''),'Chofer'), 'Chofer (entrega)', v_uid, p_emisor_firma_path)
  on conflict (salida_id, rol) do update
    set nombre = excluded.nombre, usuario_id = excluded.usuario_id, firma_path = excluded.firma_path, firmado_en = now();

  -- Firma del RECEPTOR: ahora (presente), pendiente de ALMACÉN, o pendiente
  -- enrutada a una persona.
  if nullif(p_receptor_firma_path,'') is not null then
    insert into sgc.salida_firmas (salida_id, rol, nombre, rol_desc, usuario_id, firma_path)
    values (p_id, 'receptor', coalesce(nullif(trim(p_receptor_nombre),''),'Receptor'), 'Recibe', p_receptor_usuario_id, p_receptor_firma_path)
    on conflict (salida_id, rol) do update
      set nombre = excluded.nombre, usuario_id = excluded.usuario_id, firma_path = excluded.firma_path, firmado_en = now();
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = null, firma_pendiente_nombre = null, firma_pendiente_almacen = false
     where id = p_id;
  elsif coalesce(p_confirmar_almacen,false) then
    -- AE8 — pendiente de confirmación por ALMACÉN (cola compartida de inventario).
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = null, firma_pendiente_nombre = 'Almacén', firma_pendiente_almacen = true
     where id = p_id;
  else
    -- Receptor ausente → firma pendiente enrutada a la persona asignada.
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = p_receptor_usuario_id,
           firma_pendiente_nombre = nullif(trim(p_receptor_nombre),''),
           firma_pendiente_almacen = false
     where id = p_id;
    perform sgc.notificar(p_receptor_usuario_id, 'firma',
      'Firma de devolución pendiente',
      format('Tienes una devolución de material de "%s" por firmar.', v_obra_nombre),
      '/transporte/por-firmar');
  end if;

  return p_id;
end;
$function$;

grant execute on function sgc.chofer_registrar_devolucion(uuid,date,uuid,uuid,text,text,jsonb,text,text,text,uuid,text,boolean) to authenticated;

-- 3) mis_firmas_pendientes: además de las pendientes ASIGNADAS a mí, incluir las
--    pendientes de ALMACÉN si tengo el módulo inventario (o soy admin). Cada fila
--    trae `pendiente_almacen` para que la app las etiquete distinto.
create or replace function sgc.mis_firmas_pendientes()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(row order by fecha desc), '[]'::jsonb) from (
    select s.fecha, jsonb_build_object(
      'salida_id', s.id,
      'fecha', s.fecha,
      'motivo', s.motivo,
      'obra', p.nombre,
      'proyecto_id', s.proyecto_id,
      'pendiente_almacen', s.firma_pendiente_almacen,
      'emisor', (select f.nombre from sgc.salida_firmas f where f.salida_id = s.id and f.rol = 'emisor' limit 1),
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'articulo', a.nombre, 'unidad', a.unidad, 'cantidad', d.cantidad)), '[]'::jsonb)
        from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
        where d.salida_id = s.id
      )
    ) as row
    from sgc.salidas_inventario s
    left join sgc.proyectos p on p.id = s.proyecto_id
    where s.firma_pendiente_usuario_id = auth.uid()
       or (s.firma_pendiente_almacen and (sgc.is_admin() or sgc.tiene_modulo('inventario')))
  ) q;
$function$;

-- 4) firmar_conduce: al firmar el receptor, limpiar TAMBIÉN firma_pendiente_almacen
--    y avisar al creador si estaba pendiente (por persona o por almacén).
create or replace function sgc.firmar_conduce(
  p_salida_id uuid, p_rol text, p_nombre text, p_firma_path text,
  p_cedula text default null, p_rol_desc text default null,
  p_metodo text default 'pad', p_usuario_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text := lower(coalesce(nullif(p_rol,''),''));
  v_id  uuid;
  v_pend uuid;       -- receptor pendiente (persona) ANTES de firmar
  v_pend_alm boolean; -- AE8 — pendiente de almacén ANTES de firmar
  v_creador uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_rol not in ('emisor','receptor') then raise exception 'Rol de firma inválido'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'El nombre de quien firma es obligatorio'; end if;
  if nullif(p_firma_path,'') is null then raise exception 'Falta la imagen de la firma'; end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or exists (
      select 1 from sgc.salidas_inventario s
      where s.id = p_salida_id
        and (s.creado_por = v_uid
             or s.firma_pendiente_usuario_id = v_uid
             or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = v_uid))
    )
  ) then
    raise exception 'No tienes permiso para firmar este conduce';
  end if;

  if v_rol = 'receptor' then
    select firma_pendiente_usuario_id, firma_pendiente_almacen, creado_por
      into v_pend, v_pend_alm, v_creador
      from sgc.salidas_inventario where id = p_salida_id;
  end if;

  insert into sgc.salida_firmas (salida_id, rol, nombre, cedula, rol_desc, usuario_id, firma_path, metodo)
  values (p_salida_id, v_rol, trim(p_nombre), nullif(p_cedula,''), nullif(p_rol_desc,''),
          coalesce(p_usuario_id, case when v_rol='receptor' then v_uid else null end), p_firma_path,
          coalesce(nullif(p_metodo,''),'pad'))
  on conflict (salida_id, rol) do update
    set nombre = excluded.nombre, cedula = excluded.cedula, rol_desc = excluded.rol_desc,
        usuario_id = excluded.usuario_id, firma_path = excluded.firma_path,
        metodo = excluded.metodo, firmado_en = now()
  returning id into v_id;

  if v_rol = 'receptor' then
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = null, firma_pendiente_nombre = null, firma_pendiente_almacen = false
     where id = p_salida_id;

    if (v_pend is not null or coalesce(v_pend_alm,false)) and v_creador is not null and v_creador <> v_uid then
      perform sgc.notificar(v_creador, 'firma',
        'Firma de recepción completada',
        format('%s confirmó la entrega que habías dejado pendiente.', trim(p_nombre)),
        '/transporte/conduces');
    end if;
  end if;

  return v_id;
end;
$function$;
