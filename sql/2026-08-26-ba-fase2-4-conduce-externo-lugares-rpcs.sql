-- ============================================================================
-- BA / TRANSPORTE V3 — FASE 2 (conduce externo + proveedores) + FASE 4 («Otros»)
-- Motor server-side (RPCs). Aditivo. Depende del esquema de FASE 1.
-- Gating de creación del conduce externo = MISMO que el conduce normal (FASE 0.1,
-- aprobado por Xaviel): admin / módulo inventario / chofer activo. Contabilidad fuera.
-- Firmas (FASE 0.4): emisor = quien recibe el camión; receptor = destino (matriz AY2).
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ---------------------------------------------------------------------------
-- Helpers de permiso
-- ---------------------------------------------------------------------------
-- ¿Puede crear un conduce? (misma regla que crear_conduce_transportista)
create or replace function sgc.puede_crear_conduce()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('inventario')
      or exists (select 1 from sgc.conductores c
                 where c.usuario_id = auth.uid() and coalesce(c.activo, true));
$$;
grant execute on function sgc.puede_crear_conduce() to authenticated, service_role;

-- ¿Es "Raykler"? (rol Logística y Transportación, o admin) — ratifica proveedores,
-- marca viajes pagados, promueve lugares. Gate por ROL (decisión de Xaviel).
create or replace function sgc.es_logistica()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or exists (select 1 from sgc.usuarios_roles ur
                 join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo = 'logistica');
$$;
grant execute on function sgc.es_logistica() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Proveedores de transportación
-- ---------------------------------------------------------------------------
-- Alta al vuelo (nace sin_ratificar; usable de inmediato).
create or replace function sgc.proveedor_transporte_crear(
  p_nombre text, p_telefono text default null, p_contacto text default null,
  p_rnc text default null, p_notas text default null)
returns uuid
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if not sgc.puede_crear_conduce() then
    raise exception 'No tienes permiso para registrar proveedores de transporte.';
  end if;
  if nullif(btrim(coalesce(p_nombre,'')),'') is null then
    raise exception 'El nombre del proveedor es obligatorio.';
  end if;
  insert into sgc.proveedores_transporte (nombre, telefono, contacto, rnc, notas, es_prueba)
  values (btrim(p_nombre), nullif(btrim(p_telefono),''), nullif(btrim(p_contacto),''),
          nullif(btrim(p_rnc),''), nullif(btrim(p_notas),''), sgc.usuario_actual_es_prueba())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.proveedor_transporte_crear(text,text,text,text,text) to authenticated;

-- Ratificar (oficializar) — solo Raykler/admin.
create or replace function sgc.proveedor_transporte_ratificar(p_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_logistica() then
    raise exception 'Solo Logística puede ratificar proveedores.';
  end if;
  update sgc.proveedores_transporte
     set estado = 'ratificado', ratificado_por = auth.uid(), ratificado_en = now()
   where id = p_id;
end;
$$;
grant execute on function sgc.proveedor_transporte_ratificar(uuid) to authenticated;

-- Convertir un «Otro» textual en proveedor formal, ABSORBIENDO sus viajes.
create or replace function sgc.proveedor_transporte_absorber_texto(
  p_texto text, p_nombre text, p_telefono text default null, p_contacto text default null)
returns uuid
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if not sgc.es_logistica() then
    raise exception 'Solo Logística puede formalizar proveedores desde texto.';
  end if;
  if nullif(btrim(coalesce(p_texto,'')),'') is null then
    raise exception 'Falta el texto del proveedor a absorber.';
  end if;
  insert into sgc.proveedores_transporte (nombre, telefono, contacto, estado, ratificado_por, ratificado_en)
  values (btrim(coalesce(p_nombre, p_texto)), nullif(btrim(p_telefono),''), nullif(btrim(p_contacto),''),
          'ratificado', auth.uid(), now())
  returning id into v_id;
  -- Absorbe los viajes que apuntaban al texto (case-insensitive).
  update sgc.viajes_transporte
     set proveedor_id = v_id, proveedor_texto = null
   where proveedor_id is null
     and lower(btrim(proveedor_texto)) = lower(btrim(p_texto));
  -- Y los conduces externos que transportaban por ese texto.
  update sgc.conduces_externos
     set transporta_proveedor_id = v_id, transporta_texto = null
   where transporta_proveedor_id is null
     and lower(btrim(transporta_texto)) = lower(btrim(p_texto));
  return v_id;
end;
$$;
grant execute on function sgc.proveedor_transporte_absorber_texto(text,text,text,text) to authenticated;

-- Listado de proveedores (catálogo + bandeja de ratificación).
create or replace function sgc.proveedores_transporte_listado(
  p_solo_por_ratificar boolean default false)
returns table(
  id uuid, nombre text, telefono text, contacto text, rnc text, estado text,
  activo boolean, es_prueba boolean, created_at timestamptz,
  viajes_total bigint, viajes_pendientes_pago bigint)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select pt.id, pt.nombre, pt.telefono, pt.contacto, pt.rnc, pt.estado,
         pt.activo, pt.es_prueba, pt.created_at,
         (select count(*) from sgc.viajes_transporte v where v.proveedor_id = pt.id) as viajes_total,
         (select count(*) from sgc.viajes_transporte v where v.proveedor_id = pt.id and v.estado_pago = 'pendiente_pago') as viajes_pendientes_pago
  from sgc.proveedores_transporte pt
  where coalesce(pt.activo, true)
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin() or not coalesce(pt.es_prueba, false))
    and (not p_solo_por_ratificar or pt.estado = 'sin_ratificar')
  order by (pt.estado = 'sin_ratificar') desc, pt.nombre;
$$;
grant execute on function sgc.proveedores_transporte_listado(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- «Otros» en lugares — registrar en la bandeja (FASE 4)
-- ---------------------------------------------------------------------------
create or replace function sgc.registrar_lugar_pendiente(
  p_texto text, p_documento_tipo text default null,
  p_documento_id uuid default null, p_contexto text default null)
returns uuid
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if nullif(btrim(coalesce(p_texto,'')),'') is null then return null; end if;
  insert into sgc.lugares_por_registrar (texto, documento_tipo, documento_id, contexto, es_prueba)
  values (btrim(p_texto), p_documento_tipo, p_documento_id, p_contexto, sgc.usuario_actual_es_prueba())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.registrar_lugar_pendiente(text,text,uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Conduce externo — crear + viaje automático
-- ---------------------------------------------------------------------------
create or replace function sgc.crear_conduce_externo(
  p_transporta_proveedor_id uuid,
  p_transporta_texto text,
  p_placa_foto_path text,
  p_carga_foto_path text default null,
  p_material_descripcion text default null,
  p_items jsonb default null,
  p_origen text default null, p_origen_lat numeric default null, p_origen_lng numeric default null,
  p_origen_proyecto_id uuid default null, p_origen_bodega_id uuid default null,
  p_destino text default null, p_destino_lat numeric default null, p_destino_lng numeric default null,
  p_destino_proyecto_id uuid default null, p_destino_bodega_id uuid default null,
  p_emisor_firma_path text default null,
  p_origen_requisicion_id uuid default null)
returns uuid
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id uuid;
  v_prueba boolean := sgc.usuario_actual_es_prueba();
  v_salida_id uuid;
  v_entrada_id uuid;
  v_afecta boolean := false;
  v_resp text;
begin
  if not sgc.puede_crear_conduce() then
    raise exception 'No puedes crear conduces (no eres transportista ni tienes el módulo Inventario).';
  end if;
  if nullif(btrim(coalesce(p_placa_foto_path,'')),'') is null then
    raise exception 'La foto de la placa del camión es obligatoria.';
  end if;
  if p_transporta_proveedor_id is null and nullif(btrim(coalesce(p_transporta_texto,'')),'') is null then
    raise exception 'Indica quién transporta (proveedor o texto «Otro»).';
  end if;

  select nombre into v_resp from sgc.usuarios where id = auth.uid();

  -- Impacto de inventario (solo si hay items del catálogo y toca un almacén nuestro).
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    if p_origen_bodega_id is not null then
      v_salida_id := sgc.registrar_salida_inventario(
        current_date, p_origen_bodega_id, p_destino_proyecto_id, 'conduce_externo',
        coalesce(v_resp,'')::varchar, coalesce(p_material_descripcion,''), auth.uid(), p_items);
      v_afecta := true;
    elsif p_destino_bodega_id is not null then
      v_entrada_id := sgc.registrar_entrada_inventario(
        current_date, p_destino_bodega_id, null, null, 'Conduce externo',
        coalesce(p_material_descripcion,''), auth.uid(), p_items, 'otros', p_origen_proyecto_id);
      v_afecta := true;
    end if;
  end if;

  insert into sgc.conduces_externos (
    transporta_proveedor_id, transporta_texto, placa_foto_path, carga_foto_path,
    material_descripcion, afecta_inventario, salida_id, entrada_id,
    origen, origen_lat, origen_lng, origen_proyecto_id, origen_bodega_id,
    destino, destino_lat, destino_lng, destino_proyecto_id, destino_bodega_id,
    emisor_firma_path, origen_requisicion_id, es_prueba)
  values (
    p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), p_placa_foto_path, p_carga_foto_path,
    nullif(btrim(p_material_descripcion),''), v_afecta, v_salida_id, v_entrada_id,
    nullif(btrim(p_origen),''), p_origen_lat, p_origen_lng, p_origen_proyecto_id, p_origen_bodega_id,
    nullif(btrim(p_destino),''), p_destino_lat, p_destino_lng, p_destino_proyecto_id, p_destino_bodega_id,
    p_emisor_firma_path, p_origen_requisicion_id, v_prueba)
  returning id into v_id;

  -- Viaje automático al proveedor (o texto).
  insert into sgc.viajes_transporte (proveedor_id, proveedor_texto, conduce_externo_id, fecha, es_prueba)
  values (p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), v_id, current_date, v_prueba);

  -- «Otros» sin coordenadas ni obra/almacén → bandeja "Lugares por registrar".
  if nullif(btrim(p_origen),'') is not null and p_origen_lat is null
     and p_origen_proyecto_id is null and p_origen_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_origen, 'conduce_externo', v_id, 'origen');
  end if;
  if nullif(btrim(p_destino),'') is not null and p_destino_lat is null
     and p_destino_proyecto_id is null and p_destino_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_destino, 'conduce_externo', v_id, 'destino');
  end if;

  return v_id;
end;
$$;
grant execute on function sgc.crear_conduce_externo(uuid,text,text,text,text,jsonb,text,numeric,numeric,uuid,uuid,text,numeric,numeric,uuid,uuid,text,uuid) to authenticated;

-- Confirmar recepción del conduce externo en destino (ver + foto + firma, AY2).
create or replace function sgc.conduce_externo_confirmar_receptor(
  p_id uuid, p_foto_path text, p_firma_path text, p_notas text default null)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_c sgc.conduces_externos%rowtype;
begin
  select * into v_c from sgc.conduces_externos where id = p_id;
  if not found then raise exception 'Conduce externo no encontrado.'; end if;
  if v_c.estado = 'recibido' then raise exception 'Este conduce ya fue confirmado.'; end if;
  if nullif(btrim(coalesce(p_foto_path,'')),'') is null then raise exception 'La foto de recepción es obligatoria.'; end if;
  if nullif(btrim(coalesce(p_firma_path,'')),'') is null then raise exception 'La firma de recepción es obligatoria.'; end if;
  if v_c.emisor_usuario_id = auth.uid() then
    raise exception 'Quien emite el conduce no puede confirmar su propia recepción.';
  end if;
  if not (sgc.is_admin() or sgc.puede_confirmar_recepcion()
          or (v_c.destino_proyecto_id is not null and sgc.es_responsable_de_proyecto(v_c.destino_proyecto_id))
          or sgc.es_logistica()) then
    raise exception 'Tu rol no está habilitado para confirmar esta recepción.';
  end if;
  update sgc.conduces_externos
     set estado = 'recibido', recibido_por = auth.uid(), recibido_en = now(),
         recepcion_foto_path = p_foto_path, receptor_firma_path = p_firma_path,
         notas_recepcion = nullif(btrim(p_notas),''), updated_at = now()
   where id = p_id;
end;
$$;
grant execute on function sgc.conduce_externo_confirmar_receptor(uuid,text,text,text) to authenticated;

-- Anular conduce externo (creador / logística / admin).
create or replace function sgc.conduce_externo_anular(p_id uuid, p_motivo text)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_c sgc.conduces_externos%rowtype;
begin
  select * into v_c from sgc.conduces_externos where id = p_id;
  if not found then raise exception 'Conduce externo no encontrado.'; end if;
  if not (v_c.creado_por = auth.uid() or sgc.es_logistica()) then
    raise exception 'No tienes permiso para anular este conduce.';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then raise exception 'El motivo de anulación es obligatorio.'; end if;
  update sgc.conduces_externos
     set estado = 'anulado', anulado_por = auth.uid(), anulado_en = now(),
         motivo_anulacion = btrim(p_motivo), updated_at = now()
   where id = p_id;
  -- El viaje asociado se marca prueba? no: se conserva. Si estaba pendiente, sigue.
end;
$$;
grant execute on function sgc.conduce_externo_anular(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Viajes — pago (solo Raykler) + perfil del proveedor / tool de Compa
-- ---------------------------------------------------------------------------
create or replace function sgc.viaje_marcar_pagado(p_viaje_id uuid, p_pagado boolean)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_logistica() then
    raise exception 'Solo Logística (Raykler) puede marcar viajes como pagados.';
  end if;
  update sgc.viajes_transporte
     set estado_pago = case when p_pagado then 'pagado' else 'pendiente_pago' end,
         pagado_por  = case when p_pagado then auth.uid() else null end,
         pagado_en   = case when p_pagado then now() else null end
   where id = p_viaje_id;
end;
$$;
grant execute on function sgc.viaje_marcar_pagado(uuid,boolean) to authenticated;

-- Perfil del proveedor: viajes por periodo con estado (también tool de Compa).
create or replace function sgc.viajes_de_proveedor(
  p_proveedor_id uuid default null, p_proveedor_texto text default null,
  p_desde date default null, p_hasta date default null)
returns table(
  viaje_id uuid, conduce_externo_id uuid, fecha date, estado_pago text,
  pagado_en timestamptz, origen text, destino text, material text, es_prueba boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select v.id, v.conduce_externo_id, v.fecha, v.estado_pago, v.pagado_en,
         ce.origen, ce.destino, ce.material_descripcion, v.es_prueba
  from sgc.viajes_transporte v
  left join sgc.conduces_externos ce on ce.id = v.conduce_externo_id
  where (p_proveedor_id is null or v.proveedor_id = p_proveedor_id)
    and (p_proveedor_texto is null or lower(btrim(v.proveedor_texto)) = lower(btrim(p_proveedor_texto)))
    and (p_desde is null or v.fecha >= p_desde)
    and (p_hasta is null or v.fecha <= p_hasta)
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin() or not coalesce(v.es_prueba, false))
  order by v.fecha desc, v.created_at desc;
$$;
grant execute on function sgc.viajes_de_proveedor(uuid,text,date,date) to authenticated;

-- Historial general de conduces externos (con tipo/proveedor resueltos).
create or replace function sgc.conduces_externos_listado(
  p_estado text default null, p_limite int default 200)
returns table(
  id uuid, transporta text, es_proveedor_formal boolean, estado text,
  origen text, destino text, material text, afecta_inventario boolean,
  placa_foto_path text, carga_foto_path text, recepcion_foto_path text,
  emisor_nombre text, recibido_por_nombre text, recibido_en timestamptz,
  created_at timestamptz, es_prueba boolean, requisicion_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select ce.id,
         coalesce(pt.nombre, ce.transporta_texto) as transporta,
         (ce.transporta_proveedor_id is not null) as es_proveedor_formal,
         ce.estado, ce.origen, ce.destino, ce.material_descripcion, ce.afecta_inventario,
         ce.placa_foto_path, ce.carga_foto_path, ce.recepcion_foto_path,
         ue.nombre as emisor_nombre, ur.nombre as recibido_por_nombre, ce.recibido_en,
         ce.created_at, ce.es_prueba, ce.origen_requisicion_id
  from sgc.conduces_externos ce
  left join sgc.proveedores_transporte pt on pt.id = ce.transporta_proveedor_id
  left join sgc.usuarios ue on ue.id = ce.emisor_usuario_id
  left join sgc.usuarios ur on ur.id = ce.recibido_por
  where (p_estado is null or ce.estado = p_estado)
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin() or not coalesce(ce.es_prueba, false))
  order by ce.created_at desc
  limit greatest(1, coalesce(p_limite, 200));
$$;
grant execute on function sgc.conduces_externos_listado(text,int) to authenticated;

-- ---------------------------------------------------------------------------
-- FASE 4 — Bandeja "Lugares por registrar" + promoción + buscador unificado
-- ---------------------------------------------------------------------------
create or replace function sgc.lugares_por_registrar_listado(p_estado text default 'pendiente')
returns table(
  id uuid, texto text, usado_por_nombre text, documento_tipo text, documento_id uuid,
  contexto text, estado text, created_at timestamptz, es_prueba boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select l.id, l.texto, u.nombre, l.documento_tipo, l.documento_id, l.contexto,
         l.estado, l.created_at, l.es_prueba
  from sgc.lugares_por_registrar l
  left join sgc.usuarios u on u.id = l.usado_por
  where (p_estado is null or l.estado = p_estado)
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin() or not coalesce(l.es_prueba, false))
  order by l.created_at desc;
$$;
grant execute on function sgc.lugares_por_registrar_listado(text) to authenticated;

-- Promover un «Otros» a lugar registrado (con coordenadas). Solo Raykler/admin.
create or replace function sgc.lugar_promover(
  p_pendiente_id uuid, p_nombre text, p_lat numeric default null, p_lng numeric default null)
returns uuid
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_lugar_id uuid; v_p sgc.lugares_por_registrar%rowtype;
begin
  if not sgc.es_logistica() then
    raise exception 'Solo Logística puede promover lugares.';
  end if;
  select * into v_p from sgc.lugares_por_registrar where id = p_pendiente_id;
  if not found then raise exception 'Registro pendiente no encontrado.'; end if;
  insert into sgc.lugares_registrados (nombre, lat, lng, es_prueba)
  values (btrim(coalesce(p_nombre, v_p.texto)), p_lat, p_lng, v_p.es_prueba)
  returning id into v_lugar_id;
  update sgc.lugares_por_registrar
     set estado = 'promovido', promovido_a_lugar_id = v_lugar_id,
         promovido_por = auth.uid(), promovido_en = now()
   where id = p_pendiente_id;
  return v_lugar_id;
end;
$$;
grant execute on function sgc.lugar_promover(uuid,text,numeric,numeric) to authenticated;

create or replace function sgc.lugar_descartar_pendiente(p_pendiente_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_logistica() then raise exception 'Solo Logística puede descartar lugares.'; end if;
  update sgc.lugares_por_registrar set estado = 'descartado' where id = p_pendiente_id;
end;
$$;
grant execute on function sgc.lugar_descartar_pendiente(uuid) to authenticated;

-- Buscador de lugares del SISTEMA (obras + almacenes + POIs promovidos). El cliente
-- lo une con Google Places. Este RPC arregla el bug "Bellón": lugares que SÍ existen
-- en el sistema y el buscador no devolvía. Usa unaccent como AZ8.
create or replace function sgc.buscar_lugares(p_q text)
returns table(tipo text, id uuid, nombre text, lat numeric, lng numeric, detalle text)
language sql stable security definer
set search_path to 'sgc', 'public', 'extensions', 'pg_temp'
as $$
  with q as (select extensions.unaccent(lower(btrim(coalesce(p_q,'')))) as t)
  select * from (
    -- Obras (proyectos con coordenadas)
    select 'obra'::text as tipo, p.id, p.nombre::text as nombre, p.latitud as lat, p.longitud as lng,
           coalesce(p.ubicacion, p.codigo)::text as detalle
    from sgc.proyectos p
    where coalesce(p.activo, true)
      and (not coalesce(p.es_prueba,false) or sgc.is_admin() or sgc.usuario_actual_es_prueba())
      and (select length(t) from q) >= 2
      and extensions.unaccent(lower(coalesce(p.nombre,'') || ' ' || coalesce(p.codigo,''))) like '%' || (select t from q) || '%'
    union all
    -- Almacenes / bodegas
    select 'almacen', b.id, b.nombre::text, b.latitud, b.longitud, coalesce(b.ubicacion,'')::text
    from sgc.bodegas b
    where coalesce(b.activo, true)
      and (select length(t) from q) >= 2
      and extensions.unaccent(lower(coalesce(b.nombre,''))) like '%' || (select t from q) || '%'
    union all
    -- POIs registrados (promovidos desde «Otros»)
    select 'lugar', lr.id, lr.nombre::text, lr.lat, lr.lng, 'Lugar registrado'::text
    from sgc.lugares_registrados lr
    where coalesce(lr.activo, true)
      and (not coalesce(lr.es_prueba,false) or sgc.is_admin() or sgc.usuario_actual_es_prueba())
      and (select length(t) from q) >= 2
      and extensions.unaccent(lower(lr.nombre)) like '%' || (select t from q) || '%'
  ) x
  order by nombre
  limit 25;
$$;
grant execute on function sgc.buscar_lugares(text) to authenticated;

commit;
