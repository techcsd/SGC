-- BD2 — recibir = VER + FOTO + FIRMAR (cierra la saga "no firmes a ciegas").
-- Bandeja canónica: "Por confirmar" (conduce_confirmar_receptor). "Por firmar"
-- (firmar_conduce receptor) se fusiona en la misma bandeja y también gana FOTO.
--
-- Cambios (todos ADITIVOS y retrocompatibles — la web sigue funcionando igual):
--   1) firmar_conduce: +p_foto_path +p_nota (opcionales). En la rama receptor
--      guarda la foto de lo recibido en el MISMO campo canónico que usa la
--      confirmación (salidas_inventario.recepcion_foto_path) y la nota en
--      notas_recepcion. Se DROPEA la firma de 8 args y se recrea con 10; los
--      llamadores de 8 args (conduce_firmar_despachante, web) resuelven por los
--      defaults → cero impacto.
--   2) conduce_confirmar_receptor: la FOTO deja de ser bloqueante — se exige foto
--      O una nota que explique por qué no se pudo (política de Xaviel: "obligatoria
--      pero no bloqueante"). Además, al confirmar se limpian los flags
--      firma_pendiente_* para que la entrega NO siga apareciendo en "Por firmar"
--      (mata la redundancia AY2: una entrega entregada-con-firma-pendiente salía en
--      las DOS bandejas).
-- Espejo web (paridad SGC) pendiente: la web ya manda foto siempre, así que estos
-- cambios no la rompen; el "confirmar sin foto con nota" es opcional espejarlo allá.
begin;

-- ── 1) firmar_conduce: foto + nota opcionales (recepción) ─────────────────────
drop function if exists sgc.firmar_conduce(uuid, text, text, text, text, text, text, uuid);

create or replace function sgc.firmar_conduce(
  p_salida_id uuid,
  p_rol text,
  p_nombre text,
  p_firma_path text,
  p_cedula text default null::text,
  p_rol_desc text default null::text,
  p_metodo text default 'pad'::text,
  p_usuario_id uuid default null::uuid,
  p_foto_path text default null::text,   -- BD2: foto de lo recibido (rama receptor)
  p_nota text default null::text          -- BD2: nota (si no se pudo tomar foto)
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text := lower(coalesce(nullif(p_rol,''),''));
  v_id  uuid;
  v_pend uuid;
  v_pend_alm boolean;
  v_creador uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_rol not in ('emisor','receptor','transportista') then raise exception 'Rol de firma inválido'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'El nombre de quien firma es obligatorio'; end if;
  if nullif(p_firma_path,'') is null then raise exception 'Falta la imagen de la firma'; end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or exists (
      select 1 from sgc.salidas_inventario s
      where s.id = p_salida_id
        and (s.creado_por = v_uid
             or s.firma_pendiente_usuario_id = v_uid
             or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = v_uid)
             -- AV1: el despachante designado ELEGIBLE puede firmar (rol 'emisor').
             or (s.despachante_usuario_id = v_uid and sgc.es_despachante_elegible(v_uid)))
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
    -- BD2: además de limpiar la firma pendiente, guarda la evidencia de recepción
    -- (foto/nota) en los MISMOS campos que usa la confirmación canónica.
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = null,
           firma_pendiente_nombre     = null,
           firma_pendiente_almacen    = false,
           recepcion_foto_path        = coalesce(nullif(p_foto_path,''), recepcion_foto_path),
           notas_recepcion            = coalesce(nullif(p_nota,''), notas_recepcion)
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

grant execute on function sgc.firmar_conduce(uuid, text, text, text, text, text, text, uuid, text, text) to authenticated, service_role;

-- ── 2) conduce_confirmar_receptor: foto NO bloqueante + mata el fantasma ───────
create or replace function sgc.conduce_confirmar_receptor(
  p_salida_id uuid,
  p_foto_path text,
  p_firma_path text,
  p_checklist jsonb default null,
  p_items     jsonb default null,
  p_notas     text  default null
) returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_item jsonb; v_incompleto boolean; v_recibida numeric; v_enviada numeric; v_nombre text;
  v_autorizado boolean; v_bodega_destino_id uuid; v_entrada_id uuid; v_notas text;
  v_receptor_nombre text; v_proyecto_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;
  if v_s.recibido_por is not null then
    raise exception 'Esta entrega ya fue confirmada.';
  end if;

  -- Anti-suplantación: el chofer/emisor no confirma su propia entrega (salvo admin).
  if sgc.es_chofer_de_conduce(p_salida_id) and not sgc.is_admin() then
    raise exception 'La recepción debe confirmarla el responsable del destino desde SU dispositivo, no el transportista.';
  end if;

  -- Autorizado = admin, puede_confirmar_recepcion, receptor de obra, o confirmador
  -- de la matriz (cubre destino almacén central).
  v_autorizado := sgc.is_admin()
    or sgc.puede_confirmar_recepcion()
    or exists (select 1 from sgc.receptores_de_destino(p_salida_id) r where r.usuario_id = v_uid)
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_autorizado then
    raise exception 'No estás autorizado para confirmar la recepción de este destino.';
  end if;

  -- BD2: la foto es obligatoria PERO NO BLOQUEANTE — si no se pudo tomar (cámara/
  -- permiso/sin señal) se acepta con una NOTA que lo explique. La firma sí es
  -- siempre obligatoria.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null
     and nullif(trim(coalesce(p_notas,'')),'') is null then
    raise exception 'Toma la foto de la recepción; si no puedes, explica por qué en las notas.';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma de recepción es obligatoria.';
  end if;

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
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
  end if;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  v_notas := concat_ws(' · ', nullif(p_notas,''), 'Confirmado por el receptor en su dispositivo');

  -- BD2: limpia también los flags de firma pendiente. Antes, una entrega
  -- entregada-con-firma-pendiente seguía saliendo en "Por firmar" tras confirmarla
  -- (la redundancia de las dos bandejas). Confirmar YA deja la firma del receptor,
  -- así que la firma pendiente queda saldada.
  update sgc.salidas_inventario set
    estado             = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    recibido_por       = v_uid,
    recibido_en        = now(),
    recepcion_foto_path= coalesce(p_foto_path, recepcion_foto_path),
    notas_recepcion    = coalesce(v_notas, notas_recepcion),
    firma_pendiente_usuario_id = null,
    firma_pendiente_nombre     = null,
    firma_pendiente_almacen    = false
  where id = p_salida_id;

  select nombre into v_receptor_nombre from sgc.usuarios where id = v_uid;
  delete from sgc.salida_firmas where salida_id = p_salida_id and rol = 'receptor';
  insert into sgc.salida_firmas (salida_id, rol, nombre, usuario_id, firma_path, metodo, firmado_en)
  values (p_salida_id, 'receptor', coalesce(v_receptor_nombre,'Receptor'), v_uid, p_firma_path, 'pad', now());

  insert into sgc.recepcion_confirmaciones (
    entidad_tipo, entidad_id, confirmado_por, modo, fotos, notas, checklist,
    es_prueba, es_prueba_origen
  ) values (
    'salida', p_salida_id, v_uid, 'presencial',
    case when nullif(trim(coalesce(p_foto_path,'')),'') is null then '{}'::text[] else array[p_foto_path] end,
    p_notas, p_checklist,
    coalesce(v_s.es_prueba, false), case when coalesce(v_s.es_prueba,false) then 'heredado' else 'manual' end
  );

  -- Entrada de inventario al destino: almacén central (AL10) o bodega de la obra.
  v_bodega_destino_id := v_s.destino_almacen_id;
  if v_bodega_destino_id is null and v_s.proyecto_id is not null then
    select id into v_bodega_destino_id from sgc.bodegas where proyecto_id = v_s.proyecto_id limit 1;
  end if;
  if v_bodega_destino_id is not null and v_bodega_destino_id <> v_s.bodega_id
     and not exists (select 1 from sgc.entradas_inventario where salida_id = p_salida_id) then
    insert into sgc.entradas_inventario (
      fecha, bodega_id, referencia, observaciones, creado_por,
      origen_tipo, origen_proyecto_id, salida_id
    ) values (
      current_date, v_bodega_destino_id,
      case when v_s.destino_almacen_id is not null then 'Recepción de material trasladado al almacén'
           else 'Recepción de material despachado a la obra' end,
      v_notas, v_uid,
      case when v_s.destino_almacen_id is not null then 'traslado_almacen' else 'recepcion_obra' end,
      v_s.proyecto_id, p_salida_id
    ) returning id into v_entrada_id;
    insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
    select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id and coalesce(d.cantidad_recibida, d.cantidad) > 0;
  end if;

  if v_s.creado_por is not null then
    perform sgc.notificar(v_s.creado_por, 'entrega',
      'Entrega confirmada',
      'El receptor confirmó la recepción de tu conduce.',
      '/transporte/mis-conduces');
  end if;

  return sgc.conduce_fase(p_salida_id);
end;
$$;
grant execute on function sgc.conduce_confirmar_receptor(uuid, text, text, jsonb, jsonb, text) to authenticated, service_role;

commit;
