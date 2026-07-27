-- ============================================================================
-- RONDA 11c · Z22 — Conduces del transportista + chofer receptor (servidor)
-- ----------------------------------------------------------------------------
-- Decisión: el chofer es un sgc.conductores ligado a un usuario (conductores.usuario_id).
-- Alcance propio: un conductor vinculado puede CREAR conduces y CONFIRMAR su
-- recepción, viendo/actuando solo los suyos (+ los que le asignan). Roles elevados
-- (inventario/admin) siguen viendo/actuando todo (R14). Sin módulo RBAC nuevo.
--
--   Z22.1 — RPC crear_conduce_transportista (SECURITY DEFINER): el chofer crea el
--           conduce quedando como conductor_id; valida stock; idempotente por id.
--   Z22.1 — SELECT: el conductor ve sus conduces (conductor_id vinculado / creados).
--   Z22.2 — salidas_inventario.ruta_id: asociar conduces a una ruta + RPC de detalle
--           que expone conduces, fotos y notas de voz (Z23) de la ruta.
--   Z22.3 — confirmar_recepcion_salida: el conductor asignado también puede confirmar;
--           evidencia opcional (foto + receptor/"en calidad de") — la obligatoriedad
--           la fuerza la app (Z19/PROMPT-4). Conserva la entrada automática T15.
-- Aditivo, idempotente.
-- ============================================================================

set search_path = sgc, public;

-- ── Z22.2 — columnas aditivas ───────────────────────────────────────────────
alter table sgc.salidas_inventario
  add column if not exists ruta_id uuid references sgc.rutas(id),
  add column if not exists recepcion_foto_path text;
create index if not exists idx_salidas_ruta on sgc.salidas_inventario(ruta_id);
create index if not exists idx_salidas_conductor on sgc.salidas_inventario(conductor_id);

-- ── Z22.1 — SELECT del conductor sobre sus conduces ─────────────────────────
drop policy if exists "salidas_inventario: select conductor" on sgc.salidas_inventario;
create policy "salidas_inventario: select conductor" on sgc.salidas_inventario for select to authenticated
  using (
    creado_por = auth.uid()
    or exists (
      select 1 from sgc.conductores c
      where c.id = salidas_inventario.conductor_id and c.usuario_id = auth.uid()
    )
  );

drop policy if exists "detalle_salidas: select conductor" on sgc.detalle_salidas;
create policy "detalle_salidas: select conductor" on sgc.detalle_salidas for select to authenticated
  using (
    exists (
      select 1 from sgc.salidas_inventario si
      left join sgc.conductores c on c.id = si.conductor_id
      where si.id = detalle_salidas.salida_id
        and (si.creado_por = auth.uid() or c.usuario_id = auth.uid())
    )
  );

-- ── Z22.1 — RPC: el chofer crea un conduce (queda como conductor) ───────────
create or replace function sgc.crear_conduce_transportista(
  p_id           uuid,          -- id de op (idempotencia offline)
  p_fecha        date,
  p_bodega_id    uuid,
  p_proyecto_id  uuid,          -- destino (obra) — opcional
  p_observaciones text,
  p_vehiculo_id  uuid,          -- opcional
  p_ruta_id      uuid,          -- opcional (asociar a una ruta)
  p_items        jsonb          -- [{articulo_id, cantidad, talla?}]
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_cond_id    uuid;
  v_elevado    boolean;
  v_item       jsonb;
  v_stock      numeric; v_nombre text; v_bodega text; v_sol numeric;
  v_faltantes  text[] := array[]::text[];
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  v_elevado := sgc.is_admin() or sgc.tiene_modulo('inventario');
  select id into v_cond_id from sgc.conductores where usuario_id = v_uid and coalesce(activo,true) limit 1;

  if not (v_elevado or v_cond_id is not null) then
    raise exception 'Tu usuario no puede crear conduces (no es transportista ni tiene el módulo Inventario).';
  end if;

  -- Idempotencia por id de op.
  if p_id is not null and exists (select 1 from sgc.salidas_inventario where id = p_id) then
    return p_id;
  end if;

  -- Validar stock de todos los renglones (acumula faltantes).
  select nombre into v_bodega from sgc.bodegas where id = p_bodega_id;
  v_bodega := coalesce(v_bodega, 'el almacén');
  for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_sol := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad,0) into v_nombre, v_stock
    from sgc.articulos a
    left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;
    v_nombre := coalesce(v_nombre,'artículo'); v_stock := coalesce(v_stock,0);
    if v_stock < v_sol then
      v_faltantes := v_faltantes || format('No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega, trim(to_char(v_stock,'FM999999990.###')), trim(to_char(v_sol,'FM999999990.###')));
    end if;
  end loop;
  if array_length(v_faltantes,1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n');
  end if;

  insert into sgc.salidas_inventario (
    id, fecha, bodega_id, proyecto_id, motivo, responsable, observaciones,
    creado_por, conductor_id, vehiculo_id, ruta_id, estado
  ) values (
    coalesce(p_id, gen_random_uuid()), coalesce(p_fecha, current_date), p_bodega_id, p_proyecto_id,
    case when p_proyecto_id is not null then 'uso_proyecto' else 'otro' end,
    null, p_observaciones, v_uid,
    -- si el creador no es conductor (elevado), no se auto-asigna conductor
    v_cond_id, p_vehiculo_id, p_ruta_id, 'despachado'
  ) returning id into p_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla','')
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i;

  return p_id;
end;
$function$;
grant execute on function sgc.crear_conduce_transportista(uuid, date, uuid, uuid, text, uuid, uuid, jsonb)
  to authenticated, service_role;

-- ── Z22.3 — confirmar recepción: conductor asignado + evidencia opcional ────
drop function if exists sgc.confirmar_recepcion_salida(uuid, jsonb, text);
create or replace function sgc.confirmar_recepcion_salida(
  p_salida_id uuid,
  p_items     jsonb,
  p_notas     text,
  p_receptor  text default null,   -- "en calidad de qué" / nombre de quien recibe
  p_foto_path text default null    -- Z19 evidencia (la app la exige; el server la guarda)
) returns boolean
language plpgsql
security definer
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
    -- Z22.3 — el conductor asignado al conduce también puede confirmar la recepción.
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  into v_autorizado;
  if not v_autorizado then raise exception 'No autorizado para confirmar esta entrega.'; end if;

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

  -- "en calidad de" se anexa a las notas de recepción.
  v_notas := concat_ws(' · ', nullif(p_notas,''),
    case when nullif(p_receptor,'') is not null then 'Recibió: '||p_receptor end);

  update sgc.salidas_inventario
  set estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
      recibido_por = auth.uid(), recibido_en = now(),
      notas_recepcion = v_notas,
      recepcion_foto_path = coalesce(p_foto_path, recepcion_foto_path)
  where id = p_salida_id;

  -- ── T15: entrada automática en el almacén de la obra (conservado) ──────────
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

-- ── Z22.2 — Detalle de transporte de una ruta: conduces + fotos + notas de voz ──
create or replace function sgc.ruta_detalle_transporte(p_ruta_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
    'conduces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'fecha', s.fecha, 'estado', s.estado,
        'destino', p.nombre, 'bodega', b.nombre,
        'foto_path', s.foto_path, 'entrega_foto_path', s.entrega_foto_path,
        'recepcion_foto_path', s.recepcion_foto_path,
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
