-- =============================================================================
-- PROMPT-28 (BG) FASE 4 — BG4: Retiro de material DAÑADO — RPCs + gates.
-- Ronda 19/08-03/09/2026. Aditivo, idempotente, retrocompatible.
-- Depende de sql/2026-09-01-bg4-retiro-material-schema.sql.
--
-- Flujo: crear (obra, fotos OBLIGATORIAS) → aprobar (Raykler/almacén) → generar
-- conduce de retiro (reusa conduce_externo, transporte-only) → recibir (recepción
-- canónica ver+foto+firma → entra a CUARENTENA, no despachable) → disponer
-- (descarte/reparación/devolución, auditado). Todo por RPC DEFINER (RLS write-only).
-- =============================================================================
begin;

-- ── Gates ────────────────────────────────────────────────────────────────────
create or replace function sgc.puede_gestionar_retiro()
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.es_logistica();
$$;
grant execute on function sgc.puede_gestionar_retiro() to authenticated, service_role;

-- Descarte/disposición: almacén, dirección, gerencia + roles elevados (decisión Xaviel).
create or replace function sgc.puede_disponer_retiro()
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('inventario')
      or sgc.tiene_modulo('direccion')
      or sgc.es_logistica()
      or exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = auth.uid()
          and r.codigo in ('gerencia','gerente_produccion','direccion','jefe_ingenieros'));
$$;
grant execute on function sgc.puede_disponer_retiro() to authenticated, service_role;

-- ── Crear retiro (obra) — fotos OBLIGATORIAS server-side (AS15) ───────────────
create or replace function sgc.crear_retiro_material(
  p_proyecto_id uuid,
  p_almacen_destino_id uuid,
  p_motivo_dano text,
  p_motivo_dano_detalle text,
  p_notas text,
  p_items jsonb,
  p_fotos jsonb,
  p_es_prueba boolean default false
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_proyecto_id is null then
    raise exception using errcode='22023', message='Indica la obra del material dañado.',
      detail='{"campo":"proyecto_id","motivo":"requerido"}';
  end if;
  if p_motivo_dano is null or p_motivo_dano not in ('danado_obra','defecto_fabrica','vencido','otro') then
    raise exception using errcode='22023', message='Indica el motivo del daño.',
      detail='{"campo":"motivo_dano","motivo":"requerido"}';
  end if;
  if coalesce(jsonb_array_length(p_items),0) = 0 then
    raise exception using errcode='22023', message='Agrega al menos un artículo a retirar.',
      detail='{"campo":"items","motivo":"requerido"}';
  end if;
  -- Fotos OBLIGATORIAS: material "dañado" sin foto es un hueco de control.
  if coalesce(jsonb_array_length(p_fotos),0) = 0 then
    raise exception using errcode='22023', message='Agrega al menos una foto del material dañado.',
      detail='{"campo":"fotos","motivo":"requerido"}';
  end if;

  insert into sgc.retiros_material
    (proyecto_id, solicitante_id, almacen_destino_id, motivo_dano, motivo_dano_detalle, notas, es_prueba)
  values
    (p_proyecto_id, v_uid, p_almacen_destino_id, p_motivo_dano,
     nullif(trim(p_motivo_dano_detalle),''), nullif(trim(p_notas),''), coalesce(p_es_prueba,false))
  returning id into v_id;

  insert into sgc.retiro_material_items (retiro_id, articulo_id, descripcion, cantidad, unidad)
  select v_id,
         nullif(i->>'articulo_id','')::uuid,
         coalesce(nullif(trim(i->>'descripcion'),''), 'Artículo'),
         (i->>'cantidad')::numeric,
         nullif(trim(i->>'unidad'),'')
  from jsonb_array_elements(p_items) i;

  insert into sgc.retiro_material_fotos (retiro_id, path, nombre)
  select v_id, i->>'path', nullif(i->>'nombre','')
  from jsonb_array_elements(p_fotos) i
  where nullif(i->>'path','') is not null;

  -- Aviso a inventario/almacén (Matriz BF4).
  begin
    perform sgc.notificar_modulo('inventario', 'retiro_material',
      'Nuevo retiro de material dañado',
      'RET-' || lpad((select folio::text from sgc.retiros_material where id=v_id),6,'0')
        || ' — ' || coalesce((select nombre from sgc.proyectos where id=p_proyecto_id),'obra'),
      '/inventario/retiros?item=' || v_id::text);
  exception when others then null; end;

  return v_id;
end;
$$;
grant execute on function sgc.crear_retiro_material(uuid,uuid,text,text,text,jsonb,jsonb,boolean)
  to authenticated, service_role;

-- ── Aprobar / Rechazar / Cancelar ────────────────────────────────────────────
create or replace function sgc.retiro_aprobar(p_id uuid, p_almacen_destino_id uuid default null)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_r sgc.retiros_material;
begin
  select * into v_r from sgc.retiros_material where id = p_id;
  if not found then raise exception 'Retiro no encontrado.'; end if;
  if not sgc.puede_gestionar_retiro() then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_r.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes aprobar tu propio retiro.';
  end if;
  if v_r.estado <> 'pendiente' then raise exception 'Este retiro ya no está pendiente.'; end if;
  update sgc.retiros_material
     set estado='aprobada', aprobada_por=auth.uid(), aprobada_en=now(),
         almacen_destino_id = coalesce(p_almacen_destino_id, almacen_destino_id),
         updated_at=now()
   where id=p_id;
end;
$$;
grant execute on function sgc.retiro_aprobar(uuid, uuid) to authenticated, service_role;

create or replace function sgc.retiro_rechazar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_r sgc.retiros_material;
begin
  select * into v_r from sgc.retiros_material where id = p_id;
  if not found then raise exception 'Retiro no encontrado.'; end if;
  if not sgc.puede_gestionar_retiro() then raise exception 'No autorizado' using errcode='42501'; end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'El motivo del rechazo es obligatorio.'; end if;
  if v_r.estado <> 'pendiente' then raise exception 'Este retiro ya no está pendiente.'; end if;
  update sgc.retiros_material
     set estado='rechazada', rechazada_motivo=trim(p_motivo), updated_at=now()
   where id=p_id;
end;
$$;
grant execute on function sgc.retiro_rechazar(uuid, text) to authenticated, service_role;

create or replace function sgc.retiro_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_r sgc.retiros_material;
begin
  select * into v_r from sgc.retiros_material where id = p_id;
  if not found then raise exception 'Retiro no encontrado.'; end if;
  -- El solicitante puede cancelar el suyo mientras no esté en cuarentena/dispuesto.
  if not (sgc.puede_gestionar_retiro() or v_r.solicitante_id = auth.uid()) then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'El motivo de cancelación es obligatorio.'; end if;
  if v_r.estado in ('en_cuarentena','dispuesta','cancelada','rechazada') then
    raise exception 'Este retiro ya no se puede cancelar.';
  end if;
  update sgc.retiros_material
     set estado='cancelada', cancelada_motivo=trim(p_motivo), updated_at=now()
   where id=p_id;
end;
$$;
grant execute on function sgc.retiro_cancelar(uuid, text) to authenticated, service_role;

-- ── Generar conduce de retiro (reusa conduce_externo, transporte-only) ───────
-- No pasa bodega_id de origen/destino → NO dispara entrada/salida de stock normal
-- (el material dañado NO vuelve al stock disponible: irá a cuarentena al recibirse).
create or replace function sgc.retiro_generar_conduce(
  p_id uuid,
  p_transporta_proveedor_id uuid default null,
  p_transporta_texto text default null,
  p_placa_foto_path text default null,
  p_carga_foto_path text default null,
  p_emisor_firma_path text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare
  v_r sgc.retiros_material; v_obra text; v_alm text; v_conduce uuid;
  v_items jsonb; v_desc text;
begin
  select * into v_r from sgc.retiros_material where id = p_id;
  if not found then raise exception 'Retiro no encontrado.'; end if;
  if not sgc.puede_gestionar_retiro() then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_r.estado not in ('aprobada','en_retiro') then
    raise exception 'El retiro debe estar aprobado para generar el conduce.';
  end if;

  select nombre into v_obra from sgc.proyectos where id = v_r.proyecto_id;
  select nombre into v_alm  from sgc.bodegas   where id = v_r.almacen_destino_id;

  select jsonb_agg(jsonb_build_object(
           'articulo_id', it.articulo_id, 'descripcion', it.descripcion,
           'cantidad', it.cantidad, 'unidad', it.unidad)),
         string_agg(it.descripcion || ' (' || it.cantidad || ')', ', ')
    into v_items, v_desc
  from sgc.retiro_material_items it where it.retiro_id = p_id;

  -- Conduce externo como documento de transporte (sin auto-inventario: bodega ids null).
  v_conduce := sgc.crear_conduce_externo(
    p_transporta_proveedor_id => p_transporta_proveedor_id,
    p_transporta_texto        => nullif(trim(p_transporta_texto),''),
    p_placa_foto_path         => p_placa_foto_path,
    p_carga_foto_path         => p_carga_foto_path,
    p_material_descripcion    => 'Retiro de material dañado: ' || coalesce(v_desc,''),
    p_items                   => coalesce(v_items,'[]'::jsonb),
    p_origen                  => coalesce(v_obra,'Obra'),
    p_origen_lat => null, p_origen_lng => null,
    p_origen_proyecto_id      => v_r.proyecto_id,
    p_origen_bodega_id        => null,
    p_destino                 => coalesce(v_alm, 'Almacén'),
    p_destino_lat => null, p_destino_lng => null,
    p_destino_proyecto_id     => null,
    p_destino_bodega_id       => null,
    p_emisor_firma_path       => p_emisor_firma_path,
    p_origen_requisicion_id   => null
  );

  update sgc.retiros_material
     set estado='en_retiro', conduce_externo_id=v_conduce,
         transporta_proveedor_id=p_transporta_proveedor_id,
         transporta_texto=nullif(trim(p_transporta_texto),''),
         placa_foto_path=p_placa_foto_path, carga_foto_path=p_carga_foto_path,
         emisor_firma_path=p_emisor_firma_path, updated_at=now()
   where id=p_id;
  return v_conduce;
end;
$$;
grant execute on function sgc.retiro_generar_conduce(uuid,uuid,text,text,text,text)
  to authenticated, service_role;

-- ── Recibir (recepción canónica ver+foto+firma) → CUARENTENA ─────────────────
create or replace function sgc.retiro_recibir(
  p_id uuid, p_foto_path text, p_firma_path text, p_notas text default null
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_r sgc.retiros_material; v_it record;
begin
  select * into v_r from sgc.retiros_material where id = p_id;
  if not found then raise exception 'Retiro no encontrado.'; end if;
  if not sgc.puede_gestionar_retiro() then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_r.estado not in ('aprobada','en_retiro') then
    raise exception 'Este retiro no está en estado de recepción.';
  end if;
  if v_r.almacen_destino_id is null then
    raise exception 'Falta el almacén destino para recibir a cuarentena.';
  end if;
  -- Recepción canónica (BD2): foto + firma obligatorias salvo admin.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null and not sgc.is_admin() then
    raise exception 'Toma la foto de la recepción del material.';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null and not sgc.is_admin() then
    raise exception 'La firma del receptor es obligatoria.';
  end if;

  -- Confirmar el conduce externo si existe (reusa la recepción canónica del módulo).
  if v_r.conduce_externo_id is not null then
    begin perform sgc.conduce_externo_confirmar_receptor(v_r.conduce_externo_id, p_foto_path, p_firma_path, p_notas);
    exception when others then null; end;
  end if;

  -- Entra a CUARENTENA por almacén (visible, NO despachable).
  for v_it in select articulo_id, cantidad from sgc.retiro_material_items where retiro_id = p_id loop
    perform sgc.adjust_cuarentena(v_it.articulo_id, v_r.almacen_destino_id, v_it.cantidad,
                                  'retiro_recibido', p_id, v_r.es_prueba);
  end loop;

  update sgc.retiros_material
     set estado='en_cuarentena', recibido_por=auth.uid(), recibido_en=now(),
         recepcion_foto_path=p_foto_path, recepcion_firma_path=p_firma_path,
         recepcion_notas=nullif(trim(p_notas),''), updated_at=now()
   where id=p_id;
end;
$$;
grant execute on function sgc.retiro_recibir(uuid,text,text,text) to authenticated, service_role;

-- ── Disposición final (descarte / reparación / devolución) — auditada ────────
create or replace function sgc.retiro_disponer(
  p_id uuid, p_disposicion text, p_nota text default null, p_proveedor_id uuid default null
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_r sgc.retiros_material; v_it record;
begin
  select * into v_r from sgc.retiros_material where id = p_id;
  if not found then raise exception 'Retiro no encontrado.'; end if;
  if not sgc.puede_disponer_retiro() then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_disposicion not in ('descarte','reparacion','devolucion') then
    raise exception 'Disposición inválida.';
  end if;
  if v_r.estado <> 'en_cuarentena' then
    raise exception 'El material debe estar en cuarentena para disponerlo.';
  end if;
  if p_disposicion = 'devolucion' and p_proveedor_id is null then
    raise exception 'Indica el proveedor para la devolución.';
  end if;

  for v_it in select articulo_id, cantidad from sgc.retiro_material_items where retiro_id = p_id loop
    -- Sale de cuarentena (traza en el ledger con el motivo = disposición).
    perform sgc.adjust_cuarentena(v_it.articulo_id, v_r.almacen_destino_id, -v_it.cantidad,
                                  p_disposicion, p_id, v_r.es_prueba);
    -- Reparación: vuelve a stock disponible (solo datos reales).
    if p_disposicion = 'reparacion' and v_it.articulo_id is not null and not v_r.es_prueba then
      perform sgc.adjust_stock(v_it.articulo_id, v_r.almacen_destino_id, v_it.cantidad);
    end if;
  end loop;

  update sgc.retiros_material
     set estado='dispuesta', disposicion=p_disposicion,
         disposicion_nota=nullif(trim(p_nota),''),
         proveedor_devolucion_id = case when p_disposicion='devolucion' then p_proveedor_id else null end,
         dispuesta_por=auth.uid(), dispuesta_en=now(), updated_at=now()
   where id=p_id;
end;
$$;
grant execute on function sgc.retiro_disponer(uuid,text,text,uuid) to authenticated, service_role;

-- ── Listados / detalle ───────────────────────────────────────────────────────
create or replace function sgc.retiros_listado(
  p_estado text default null, p_solo_mios boolean default false, p_limite int default 300
) returns table (
  id uuid, folio bigint, proyecto_id uuid, proyecto_nombre text,
  solicitante_nombre text, motivo_dano text, motivo_dano_detalle text, estado text,
  disposicion text, items_count int, fotos_count int, es_prueba boolean, created_at timestamptz
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select r.id, r.folio, r.proyecto_id, p.nombre,
         u.nombre, r.motivo_dano, r.motivo_dano_detalle, r.estado,
         r.disposicion,
         (select count(*)::int from sgc.retiro_material_items it where it.retiro_id=r.id),
         (select count(*)::int from sgc.retiro_material_fotos f where f.retiro_id=r.id),
         r.es_prueba, r.created_at
  from sgc.retiros_material r
  left join sgc.proyectos p on p.id = r.proyecto_id
  left join sgc.usuarios  u on u.id = r.solicitante_id
  where (
      r.solicitante_id = auth.uid() or sgc.is_admin()
      or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras')
      or sgc.tiene_modulo('direccion') or sgc.es_responsable_de_proyecto(r.proyecto_id)
    )
    and ((not r.es_prueba) or sgc.is_admin())
    and (p_estado is null or r.estado = p_estado)
    and (not p_solo_mios or r.solicitante_id = auth.uid())
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limite,300), 1000));
$$;
grant execute on function sgc.retiros_listado(text, boolean, int) to authenticated, service_role;

create or replace function sgc.retiro_detalle(p_id uuid)
returns jsonb language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select case when exists (select 1 from sgc.retiros_material r where r.id = p_id and (
      r.solicitante_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('inventario')
      or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion')
      or sgc.es_responsable_de_proyecto(r.proyecto_id)))
    then (
      select jsonb_build_object(
        'retiro', to_jsonb(r) || jsonb_build_object(
          'proyecto_nombre', (select nombre from sgc.proyectos where id=r.proyecto_id),
          'almacen_nombre',  (select nombre from sgc.bodegas   where id=r.almacen_destino_id),
          'solicitante_nombre', (select nombre from sgc.usuarios where id=r.solicitante_id)),
        'items', coalesce((select jsonb_agg(to_jsonb(it)) from sgc.retiro_material_items it where it.retiro_id=r.id),'[]'::jsonb),
        'fotos', coalesce((select jsonb_agg(to_jsonb(f)) from sgc.retiro_material_fotos f where f.retiro_id=r.id),'[]'::jsonb))
      from sgc.retiros_material r where r.id = p_id)
    else jsonb_build_object('error','no_autorizado') end;
$$;
grant execute on function sgc.retiro_detalle(uuid) to authenticated, service_role;

-- ── Cuarentena: "columna propia en Inventario" ───────────────────────────────
create or replace function sgc.inventario_cuarentena(p_bodega_id uuid default null)
returns table (
  bodega_id uuid, bodega_nombre text, articulo_id uuid, articulo_nombre text,
  codigo text, cantidad numeric, updated_at timestamptz
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select sc.bodega_id, b.nombre, sc.articulo_id, a.nombre, a.codigo, sc.cantidad, sc.updated_at
  from sgc.stock_cuarentena sc
  left join sgc.bodegas   b on b.id = sc.bodega_id
  left join sgc.articulos a on a.id = sc.articulo_id
  where sc.cantidad > 0
    and sgc.puede_ver_inventario_bodega(sc.bodega_id)
    and (p_bodega_id is null or sc.bodega_id = p_bodega_id)
  order by b.nombre, a.nombre;
$$;
grant execute on function sgc.inventario_cuarentena(uuid) to authenticated, service_role;

-- ── Compa: material dañado / en cuarentena ───────────────────────────────────
create or replace function sgc.material_en_cuarentena(p_query text default null)
returns table (bodega text, articulo text, cantidad numeric)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select b.nombre, a.nombre, sc.cantidad
  from sgc.stock_cuarentena sc
  left join sgc.bodegas b on b.id = sc.bodega_id
  left join sgc.articulos a on a.id = sc.articulo_id
  where sc.cantidad > 0
    and sgc.puede_ver_inventario_bodega(sc.bodega_id)
    and (p_query is null or a.nombre ilike '%'||p_query||'%' or b.nombre ilike '%'||p_query||'%')
  order by b.nombre, a.nombre
  limit 200;
$$;
grant execute on function sgc.material_en_cuarentena(text) to authenticated, service_role;

-- ── Informe semanal: retiros de la semana (BE1-5) ────────────────────────────
create or replace function sgc.resumen_retiros_semana(p_anio int default null, p_semana int default null)
returns table (estado text, disposicion text, retiros int, articulos numeric)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  with rango as (select * from sgc.semana_rango(
    coalesce(p_anio, extract(isoyear from now())::int),
    coalesce(p_semana, extract(week from now())::int)))
  select r.estado, r.disposicion, count(*)::int,
         coalesce(sum((select sum(it.cantidad) from sgc.retiro_material_items it where it.retiro_id=r.id)),0)
  from sgc.retiros_material r, rango
  where not r.es_prueba
    and r.created_at >= rango.inicio and r.created_at < rango.fin
  group by r.estado, r.disposicion
  order by r.estado;
$$;
grant execute on function sgc.resumen_retiros_semana(int, int) to authenticated, service_role;

commit;
