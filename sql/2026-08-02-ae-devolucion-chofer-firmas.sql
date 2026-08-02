-- ============================================================================
-- AE — Devolución de material por el CHOFER (obra → almacén) con DOBLE FIRMA y
-- firma pendiente enrutada (modelo de Xaviel).
-- ----------------------------------------------------------------------------
-- Modelo: el chofer registra la devolución y el stock se MUEVE DIRECTO (baja la
-- obra, sube el almacén) — él es quien registra. El antifraude va por las 2 FIRMAS
-- que confirman la entrega: emisor (chofer, quien lleva) + receptor (quien recibe:
-- el propio chofer o el ingeniero/encargado). Si el receptor NO está presente, su
-- firma queda PENDIENTE, se le ENRUTA (aviso dirigido + bandeja "Por firmar") y él
-- firma después para completarla.
--
-- Reutiliza: la tabla `salida_firmas` + el RPC `firmar_conduce` (patrón AC7 de doble
-- firma de conduces). La devolución crea una SALIDA (de la obra) — le colgamos las
-- firmas a esa salida.
--
-- Cambios (aditivos, idempotentes):
--   1) salidas_inventario += firma_pendiente_usuario_id / firma_pendiente_nombre
--      (a quién le toca firmar como receptor si no estuvo presente).
--   2) chofer_registrar_devolucion(...): mueve stock (obra→almacén) + registra la
--      firma del emisor + la del receptor (ahora) o la deja PENDIENTE + notifica.
--   3) firmar_conduce: se amplía para permitir firmar al usuario ASIGNADO como
--      receptor pendiente; al firmar receptor, limpia el pendiente.
--   4) mis_firmas_pendientes(): lista las devoluciones/conduces con firma de receptor
--      pendiente asignada al usuario actual (bandeja "Por firmar").
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Receptor pendiente por firmar en una salida ──────────────────────────
alter table sgc.salidas_inventario
  add column if not exists firma_pendiente_usuario_id uuid references sgc.usuarios(id),
  add column if not exists firma_pendiente_nombre text;
comment on column sgc.salidas_inventario.firma_pendiente_usuario_id is
  'AE — usuario (ingeniero/encargado) al que le toca firmar como RECEPTOR si no estuvo presente.';

-- ── 2) firmar_conduce: permitir al RECEPTOR pendiente asignado + limpiar pendiente ──
create or replace function sgc.firmar_conduce(
  p_salida_id uuid,
  p_rol       text,
  p_nombre    text,
  p_firma_path text,
  p_cedula    text default null,
  p_rol_desc  text default null,
  p_metodo    text default 'pad',
  p_usuario_id uuid default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := lower(coalesce(nullif(p_rol,''),''));
  v_id  uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_rol not in ('emisor','receptor') then raise exception 'Rol de firma inválido'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'El nombre de quien firma es obligatorio'; end if;
  if nullif(p_firma_path,'') is null then raise exception 'Falta la imagen de la firma'; end if;

  -- Autorizado: admin / módulo inventario / conductor asignado / creador del conduce,
  -- O el usuario ASIGNADO como receptor pendiente (AE — firma pendiente enrutada).
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

  insert into sgc.salida_firmas (salida_id, rol, nombre, cedula, rol_desc, usuario_id, firma_path, metodo)
  values (p_salida_id, v_rol, trim(p_nombre), nullif(p_cedula,''), nullif(p_rol_desc,''),
          coalesce(p_usuario_id, case when v_rol='receptor' then v_uid else null end), p_firma_path,
          coalesce(nullif(p_metodo,''),'pad'))
  on conflict (salida_id, rol) do update
    set nombre = excluded.nombre, cedula = excluded.cedula, rol_desc = excluded.rol_desc,
        usuario_id = excluded.usuario_id, firma_path = excluded.firma_path,
        metodo = excluded.metodo, firmado_en = now()
  returning id into v_id;

  -- AE — al firmar el receptor, la firma pendiente queda cumplida.
  if v_rol = 'receptor' then
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = null, firma_pendiente_nombre = null
     where id = p_salida_id;
  end if;

  return v_id;
end;
$$;
grant execute on function sgc.firmar_conduce(uuid, text, text, text, text, text, text, uuid) to authenticated, service_role;

-- ── 3) chofer_registrar_devolucion — stock directo + doble firma / pendiente ─
create or replace function sgc.chofer_registrar_devolucion(
  p_id                 uuid,       -- client UUID = id de la SALIDA (idempotencia)
  p_fecha              date,
  p_bodega_destino_id  uuid,
  p_origen_proyecto_id uuid,
  p_referencia         text,
  p_observaciones      text,
  p_items              jsonb,      -- [{articulo_id, cantidad}]
  p_emisor_nombre      text,
  p_emisor_firma_path  text,
  p_receptor_nombre    text default null,
  p_receptor_usuario_id uuid default null,
  p_receptor_firma_path text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
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
  -- Chofer / Almacén / admin (el chofer mueve directo; el antifraude son las firmas).
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.es_chofer()) then
    raise exception 'Sin permiso para registrar devoluciones';
  end if;
  if p_bodega_destino_id is null then raise exception 'Falta el almacén destino.'; end if;
  if p_origen_proyecto_id is null then raise exception 'Selecciona la obra de origen.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un artículo.'; end if;
  if nullif(trim(coalesce(p_emisor_firma_path,'')),'') is null then raise exception 'Falta la firma de quien entrega.'; end if;
  if nullif(p_receptor_firma_path,'') is null and p_receptor_usuario_id is null then
    raise exception 'Indica quién recibe: firma ahora o asígnalo para que firme después.';
  end if;

  select nombre into v_obra_nombre from sgc.proyectos where id = p_origen_proyecto_id;
  if v_obra_nombre is null then raise exception 'Obra de origen no encontrada.'; end if;

  -- Idempotencia: si la salida ya existe, el stock ya se movió → solo (re)aplica firmas.
  v_ya := exists (select 1 from sgc.salidas_inventario where id = p_id);

  if not v_ya then
    -- Almacén de la obra de origen (principal primero).
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

    -- Validar stock en el almacén de la obra.
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

    -- Salida desde el almacén de la obra (baja stock por el trigger de detalle).
    insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, observaciones, creado_por)
    values (p_id, coalesce(p_fecha, current_date), v_bodega_orig, p_origen_proyecto_id,
            format('Devolución a %s', coalesce(v_bodega_dest_nombre,'almacén')),
            nullif(p_observaciones,''), v_uid);
    insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad)
    select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
      from jsonb_array_elements(p_items) as i;

    -- Entrada en el almacén destino (sube stock por el trigger de detalle).
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

  -- Firma del RECEPTOR: ahora (presente) o PENDIENTE (enrutada al asignado).
  if nullif(p_receptor_firma_path,'') is not null then
    insert into sgc.salida_firmas (salida_id, rol, nombre, rol_desc, usuario_id, firma_path)
    values (p_id, 'receptor', coalesce(nullif(trim(p_receptor_nombre),''),'Receptor'), 'Recibe', p_receptor_usuario_id, p_receptor_firma_path)
    on conflict (salida_id, rol) do update
      set nombre = excluded.nombre, usuario_id = excluded.usuario_id, firma_path = excluded.firma_path, firmado_en = now();
    update sgc.salidas_inventario set firma_pendiente_usuario_id = null, firma_pendiente_nombre = null where id = p_id;
  else
    -- Receptor ausente → firma pendiente enrutada al ingeniero/encargado.
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = p_receptor_usuario_id,
           firma_pendiente_nombre = nullif(trim(p_receptor_nombre),'')
     where id = p_id;
    perform sgc.notificar(p_receptor_usuario_id, 'firma',
      'Firma de devolución pendiente',
      format('Tienes una devolución de material de "%s" por firmar.', v_obra_nombre),
      '/transporte/por-firmar');
  end if;

  return p_id;
end;
$$;
grant execute on function sgc.chofer_registrar_devolucion(
  uuid, date, uuid, uuid, text, text, jsonb, text, text, text, uuid, text
) to authenticated, service_role;

-- ── 4) Bandeja "Por firmar": devoluciones/conduces con mi firma de receptor pendiente ──
create or replace function sgc.mis_firmas_pendientes()
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $$
  select coalesce(jsonb_agg(row order by fecha desc), '[]'::jsonb) from (
    select s.fecha, jsonb_build_object(
      'salida_id', s.id,
      'fecha', s.fecha,
      'motivo', s.motivo,
      'obra', p.nombre,
      'proyecto_id', s.proyecto_id,
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
  ) q;
$$;
grant execute on function sgc.mis_firmas_pendientes() to authenticated, service_role;
