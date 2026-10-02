-- CF5 — Solicitud de movimiento: almacén central como origen/destino + renglones del catálogo
-- -------------------------------------------------------------------------------------
-- Hoy "¿Qué se mueve?" es un textarea libre y el destino sólo ofrece obra; origen/destino
-- se escriben a mano.  La tabla YA tiene origen_bodega_id/origen_proyecto_id/destino_* (AY11);
-- lo que falta es (a) renglones del catálogo y (b) exponer los selectores en la UI.
-- CF5 añade la tabla de renglones y RPCs v2 que arman `que_se_mueve` como resumen generado.
-- -------------------------------------------------------------------------------------

-- ── (1) Renglones de la solicitud (artículo del catálogo o texto libre) ───────────────
create table if not exists sgc.solicitud_movimiento_items (
  id            uuid primary key default gen_random_uuid(),
  solicitud_id  uuid not null references sgc.solicitudes_movimiento(id) on delete cascade,
  articulo_id   uuid references sgc.articulos(id),     -- null = "no está en el catálogo" (texto libre)
  descripcion   text not null,                         -- nombre del artículo o texto libre
  cantidad      numeric(14,3),
  unidad        text,
  orden         int not null default 0,
  created_at    timestamptz not null default now()
);
comment on table sgc.solicitud_movimiento_items is 'CF5 — renglones (catálogo o texto libre) de una solicitud de movimiento.';
create index if not exists idx_sol_mov_items_sol on sgc.solicitud_movimiento_items(solicitud_id);

alter table sgc.solicitud_movimiento_items enable row level security;
drop policy if exists "sol_mov_items: ver" on sgc.solicitud_movimiento_items;
create policy "sol_mov_items: ver" on sgc.solicitud_movimiento_items for select to authenticated
  using (exists (
    select 1 from sgc.solicitudes_movimiento s
    where s.id = solicitud_movimiento_items.solicitud_id
      and (s.solicitante_id = auth.uid() or s.created_by = auth.uid() or sgc.es_referente_movimiento())
  ));
grant select on sgc.solicitud_movimiento_items to authenticated;
grant select, insert, update, delete on sgc.solicitud_movimiento_items to service_role;

-- ── (2) Helper: resumen "que se mueve" a partir de los renglones ──────────────────────
create or replace function sgc._resumen_items_movimiento(p_items jsonb)
returns text
language sql stable set search_path to 'sgc','pg_temp'
as $function$
  select nullif(string_agg(
    trim(both ' ' from (
      coalesce(nullif(trim(i->>'cantidad'),''),'') || ' ' ||
      coalesce(nullif(trim(i->>'unidad'),''),'') || ' ' ||
      coalesce(
        (select a.nombre from sgc.articulos a where a.id = nullif(i->>'articulo_id','')::uuid),
        nullif(trim(i->>'descripcion'),''), 'Artículo')
    )), ', ' order by (i->>'orden')::int nulls last),
  '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;
$function$;

-- ── (3) Guardar los renglones de una solicitud (reemplaza) ────────────────────────────
create or replace function sgc._guardar_items_movimiento(p_solicitud uuid, p_items jsonb)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare i jsonb; n int := 0;
begin
  delete from sgc.solicitud_movimiento_items where solicitud_id = p_solicitud;
  if p_items is null then return; end if;
  for i in select * from jsonb_array_elements(p_items) loop
    if nullif(trim(coalesce(i->>'descripcion','')),'') is null
       and nullif(i->>'articulo_id','') is null then continue; end if;
    insert into sgc.solicitud_movimiento_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, orden)
    values (
      p_solicitud,
      nullif(i->>'articulo_id','')::uuid,
      coalesce(nullif(trim(i->>'descripcion'),''),
               (select a.nombre from sgc.articulos a where a.id = nullif(i->>'articulo_id','')::uuid),
               'Artículo'),
      nullif(trim(i->>'cantidad'),'')::numeric,
      nullif(trim(i->>'unidad'),''),
      n
    );
    n := n + 1;
  end loop;
end;
$function$;

-- ── (4) Crear solicitud con renglones (v2) ────────────────────────────────────────────
create or replace function sgc.crear_solicitud_movimiento_v2(
  p_proyecto_id uuid,
  p_items jsonb,
  p_tipo_carga text default 'materiales',
  p_origen_tipo text default 'almacen',
  p_origen_texto text default null,
  p_origen_bodega_id uuid default null,
  p_origen_proyecto_id uuid default null,
  p_destino_tipo text default 'obra',
  p_destino_texto text default null,
  p_destino_bodega_id uuid default null,
  p_destino_proyecto_id uuid default null,
  p_prioridad text default 'media',
  p_fecha_requerimiento date default null,
  p_notas text default null,
  p_que_se_mueve text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_id uuid; v_resumen text; v_proy text; v_sol text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  v_resumen := coalesce(nullif(trim(coalesce(p_que_se_mueve,'')),''), sgc._resumen_items_movimiento(p_items));
  if v_resumen is null then raise exception 'Agrega al menos un renglón de lo que se va a mover.'; end if;

  insert into sgc.solicitudes_movimiento (
    solicitante_id, proyecto_id, que_se_mueve, tipo_carga,
    origen_tipo, origen_texto, origen_bodega_id, origen_proyecto_id,
    destino_tipo, destino_texto, destino_bodega_id, destino_proyecto_id,
    prioridad, fecha_requerimiento, notas, created_by
  ) values (
    v_uid, p_proyecto_id, v_resumen, coalesce(p_tipo_carga,'materiales'),
    coalesce(p_origen_tipo,'almacen'), nullif(trim(p_origen_texto),''), p_origen_bodega_id, p_origen_proyecto_id,
    coalesce(p_destino_tipo,'obra'), nullif(trim(p_destino_texto),''), p_destino_bodega_id, p_destino_proyecto_id,
    coalesce(p_prioridad,'media'), p_fecha_requerimiento, nullif(trim(p_notas),''), v_uid
  ) returning id into v_id;

  perform sgc._guardar_items_movimiento(v_id, p_items);

  select nombre into v_proy from sgc.proyectos where id = p_proyecto_id;
  select nombre into v_sol  from sgc.usuarios  where id = v_uid;
  perform sgc._notificar_referentes_movimiento(
    'Nueva solicitud de movimiento',
    coalesce(v_sol,'Un ingeniero')||' solicitó mover: '||left(v_resumen,80)||
      coalesce(' · '||v_proy,'')||' · prioridad '||coalesce(p_prioridad,'media'),
    '/flota/solicitudes-movimiento');
  return v_id;
end;
$function$;
grant execute on function sgc.crear_solicitud_movimiento_v2(uuid,jsonb,text,text,text,uuid,uuid,text,text,uuid,uuid,text,date,text,text) to authenticated, service_role;

-- ── (5) Editar solicitud (solicitante/referente, solo mientras pendiente) ─────────────
create or replace function sgc.editar_solicitud_movimiento(
  p_id uuid,
  p_proyecto_id uuid,
  p_items jsonb,
  p_tipo_carga text default 'materiales',
  p_origen_tipo text default 'almacen',
  p_origen_texto text default null,
  p_origen_bodega_id uuid default null,
  p_origen_proyecto_id uuid default null,
  p_destino_tipo text default 'obra',
  p_destino_texto text default null,
  p_destino_bodega_id uuid default null,
  p_destino_proyecto_id uuid default null,
  p_prioridad text default 'media',
  p_fecha_requerimiento date default null,
  p_notas text default null,
  p_que_se_mueve text default null
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_resumen text; v_estado text; v_dueno uuid;
begin
  select estado, solicitante_id into v_estado, v_dueno from sgc.solicitudes_movimiento where id = p_id;
  if not found then raise exception 'Solicitud no encontrada' using errcode='P0002'; end if;
  if not (v_dueno = v_uid or sgc.es_referente_movimiento() or sgc.is_admin()) then
    raise exception 'No autorizado para editar esta solicitud' using errcode='42501';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'Solo se puede editar una solicitud pendiente' using errcode='22023';
  end if;
  v_resumen := coalesce(nullif(trim(coalesce(p_que_se_mueve,'')),''), sgc._resumen_items_movimiento(p_items));
  if v_resumen is null then raise exception 'Agrega al menos un renglón.'; end if;
  update sgc.solicitudes_movimiento set
    proyecto_id = p_proyecto_id, que_se_mueve = v_resumen, tipo_carga = coalesce(p_tipo_carga,'materiales'),
    origen_tipo = coalesce(p_origen_tipo,'almacen'), origen_texto = nullif(trim(p_origen_texto),''),
    origen_bodega_id = p_origen_bodega_id, origen_proyecto_id = p_origen_proyecto_id,
    destino_tipo = coalesce(p_destino_tipo,'obra'), destino_texto = nullif(trim(p_destino_texto),''),
    destino_bodega_id = p_destino_bodega_id, destino_proyecto_id = p_destino_proyecto_id,
    prioridad = coalesce(p_prioridad,'media'), fecha_requerimiento = p_fecha_requerimiento,
    notas = nullif(trim(p_notas),'')
  where id = p_id;
  perform sgc._guardar_items_movimiento(p_id, p_items);
end;
$function$;
grant execute on function sgc.editar_solicitud_movimiento(uuid,uuid,jsonb,text,text,text,uuid,uuid,text,text,uuid,uuid,text,date,text,text) to authenticated, service_role;

-- ── (6) Listar los renglones de una solicitud ─────────────────────────────────────────
create or replace function sgc.solicitud_movimiento_items_listar(p_solicitud uuid)
returns jsonb
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', it.id, 'articulo_id', it.articulo_id, 'descripcion', it.descripcion,
      'cantidad', it.cantidad, 'unidad', it.unidad, 'orden', it.orden,
      'articulo_nombre', (select a.nombre from sgc.articulos a where a.id = it.articulo_id)
    ) order by it.orden), '[]'::jsonb)
  from sgc.solicitud_movimiento_items it
  join sgc.solicitudes_movimiento s on s.id = it.solicitud_id
  where it.solicitud_id = p_solicitud
    and (s.solicitante_id = auth.uid() or s.created_by = auth.uid() or sgc.es_referente_movimiento());
$function$;
grant execute on function sgc.solicitud_movimiento_items_listar(uuid) to authenticated;
