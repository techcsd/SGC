-- ============================================================================
-- AE5 — Vínculo ruta/PARADA ↔ conduce + estado y evidencia por parada (SGC padre).
-- ----------------------------------------------------------------------------
-- Estado previo (verificado en prod):
--   • ruta_paradas (AC13) existe: lista ordenada de paradas SIN estado ni evidencia.
--   • salidas_inventario.ruta_id (Z22) existe: un conduce se ata a una RUTA.
--   • NO existe vínculo a una PARADA específica ni progreso por parada.
--
-- Esta migración (aditiva, retrocompatible):
--   1) ruta_paradas += estado (pendiente/en_camino/entregada/omitida) + evidencia
--      por parada (llegada/entrega, quién recibió, foto, firma, notas).
--   2) salidas_inventario += ruta_parada_id → un conduce puede viajar en una PARADA
--      concreta (además de la ruta). ruta_id se conserva para el nivel ruta.
--   3) set_ruta_paradas: ahora RECONCILIA por id en vez de borrar-todo, para no
--      perder el estado/evidencia de paradas ya en camino/entregadas al re-planificar.
--   4) RPC vincular_conduce_parada: el chofer ata un conduce PROPIO a una parada
--      (y de paso a su ruta) — "este material va a esta parada".
--   5) RPC avanzar_parada: marca una parada en_camino/entregada con evidencia/firma
--      (AC7-style) — para paradas sin conduce (traslado/personal) o cierre manual.
--   6) Trigger: al confirmarse la recepción de un conduce atado a una parada, la
--      parada pasa a 'entregada' automáticamente (traza: en qué ruta/parada viajó,
--      cuándo y quién recibió).
--   7) ruta_detalle_transporte: ahora devuelve también las PARADAS con su estado y
--      el conduce vinculado; cada conduce reporta su parada.
--
-- Visibilidad de conduces: la matriz (emisor, chofer asignado, almacén/inventario,
-- obra destino, admin) YA está implementada por las políticas RLS de Z22/transporte
-- (ver docs/CHOFER-FLUJO.md §Visibilidad). Esta migración no la relaja; el vínculo a
-- parada solo enriquece la traza. Idempotente.
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Estado + evidencia por parada ────────────────────────────────────────
alter table sgc.ruta_paradas
  add column if not exists estado        text not null default 'pendiente'
      check (estado in ('pendiente','en_camino','entregada','omitida')),
  add column if not exists llegada_at    timestamptz,
  add column if not exists entregada_at  timestamptz,
  add column if not exists entregado_a   text,          -- nombre de quien recibió en la parada
  add column if not exists foto_path     text,          -- evidencia (bucket vehiculos)
  add column if not exists firma_path    text,          -- firma de recepción (bucket conduces)
  add column if not exists notas_entrega text;
comment on column sgc.ruta_paradas.estado is 'AE5 — progreso de la parada: pendiente → en_camino → entregada (u omitida).';

-- ── 2) Conduce ↔ parada específica ──────────────────────────────────────────
alter table sgc.salidas_inventario
  add column if not exists ruta_parada_id uuid references sgc.ruta_paradas(id) on delete set null;
create index if not exists idx_salidas_ruta_parada on sgc.salidas_inventario(ruta_parada_id);
comment on column sgc.salidas_inventario.ruta_parada_id is 'AE5 — parada concreta de la ruta en la que viaja/se entrega este conduce (además de ruta_id).';

-- UPDATE policy para paradas (mismo alcance que la ruta madre). Los RPCs son
-- SECURITY DEFINER, pero dejar la política explícita evita sorpresas futuras.
drop policy if exists ruta_paradas_upd on sgc.ruta_paradas;
create policy ruta_paradas_upd on sgc.ruta_paradas for update to authenticated
using (exists (select 1 from sgc.rutas r where r.id = ruta_paradas.ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
            or r.conductor_id in (select sgc.mis_conductor_ids()))))
with check (exists (select 1 from sgc.rutas r where r.id = ruta_paradas.ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
            or r.conductor_id in (select sgc.mis_conductor_ids()))));

-- ── 3) set_ruta_paradas: reconciliar por id (preserva progreso) ─────────────
-- Retrocompatible: si una parada del JSON no trae `id`, se inserta (flujo offline
-- de creación). Si trae `id`, se actualiza conservando estado/evidencia. Se borran
-- solo las paradas que ya no vienen Y siguen 'pendiente' (nunca una entregada/en camino).
create or replace function sgc.set_ruta_paradas(p_ruta_id uuid, p_paradas jsonb)
returns int language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare
  v_uid uuid := auth.uid();
  v_n int := 0;
  v_keep uuid[] := array[]::uuid[];
  p jsonb;
  v_orden int := 0;
  v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not exists (select 1 from sgc.rutas r where r.id = p_ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = v_uid
            or r.conductor_id in (select sgc.mis_conductor_ids()))) then
    raise exception 'No tienes permiso sobre esta ruta';
  end if;

  for p in select * from jsonb_array_elements(coalesce(p_paradas,'[]'::jsonb)) loop
    if nullif(p->>'ubicacion','') is null then continue; end if;
    v_orden := v_orden + 1;
    v_id := nullif(p->>'id','')::uuid;
    if v_id is not null and exists (select 1 from sgc.ruta_paradas where id = v_id and ruta_id = p_ruta_id) then
      -- Actualiza datos de planificación; NO toca estado ni evidencia.
      update sgc.ruta_paradas set
        orden       = coalesce((p->>'orden')::int, v_orden),
        ubicacion   = p->>'ubicacion',
        lat         = nullif(p->>'lat','')::numeric,
        lng         = nullif(p->>'lng','')::numeric,
        notas       = nullif(p->>'notas',''),
        proyecto_id = nullif(p->>'proyecto_id','')::uuid
      where id = v_id;
    else
      insert into sgc.ruta_paradas (ruta_id, orden, ubicacion, lat, lng, notas, proyecto_id)
      values (p_ruta_id, coalesce((p->>'orden')::int, v_orden), p->>'ubicacion',
              nullif(p->>'lat','')::numeric, nullif(p->>'lng','')::numeric,
              nullif(p->>'notas',''), nullif(p->>'proyecto_id','')::uuid)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
    v_n := v_n + 1;
  end loop;

  -- Borra solo las paradas que ya no vienen y siguen pendientes (protege entregas).
  delete from sgc.ruta_paradas
   where ruta_id = p_ruta_id
     and estado = 'pendiente'
     and not (id = any(v_keep));

  return v_n;
end;
$$;
grant execute on function sgc.set_ruta_paradas(uuid, jsonb) to authenticated, service_role;

-- ── 4) Vincular un conduce a una parada (y a su ruta) ───────────────────────
create or replace function sgc.vincular_conduce_parada(p_salida_id uuid, p_ruta_parada_id uuid)
returns void language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare
  v_uid uuid := auth.uid();
  v_ruta_id uuid;
  v_creado_por uuid;
  v_conductor_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select creado_por, conductor_id into v_creado_por, v_conductor_id
    from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Permiso: elevado, o emisor del conduce, o el chofer asignado al conduce.
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')
          or v_creado_por = v_uid
          or exists (select 1 from sgc.conductores c where c.id = v_conductor_id and c.usuario_id = v_uid)) then
    raise exception 'No autorizado para vincular este conduce.';
  end if;

  if p_ruta_parada_id is null then
    update sgc.salidas_inventario set ruta_parada_id = null where id = p_salida_id;
    return;
  end if;

  select ruta_id into v_ruta_id from sgc.ruta_paradas where id = p_ruta_parada_id;
  if v_ruta_id is null then raise exception 'Parada no encontrada.'; end if;

  -- Atar a la parada implica atar a su ruta.
  update sgc.salidas_inventario
     set ruta_parada_id = p_ruta_parada_id, ruta_id = v_ruta_id
   where id = p_salida_id;
end;
$$;
grant execute on function sgc.vincular_conduce_parada(uuid, uuid) to authenticated, service_role;

-- ── 5) Avanzar el estado de una parada (con evidencia/firma AC7-style) ──────
create or replace function sgc.avanzar_parada(
  p_parada_id   uuid,
  p_estado      text,                         -- 'en_camino' | 'entregada' | 'omitida'
  p_foto_path   text default null,
  p_firma_path  text default null,
  p_entregado_a text default null,
  p_notas       text default null
) returns void language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare
  v_uid uuid := auth.uid();
  v_ruta_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_estado not in ('pendiente','en_camino','entregada','omitida') then
    raise exception 'Estado de parada inválido: %', p_estado;
  end if;

  select ruta_id into v_ruta_id from sgc.ruta_paradas where id = p_parada_id;
  if v_ruta_id is null then raise exception 'Parada no encontrada.'; end if;
  if not exists (select 1 from sgc.rutas r where r.id = v_ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = v_uid
            or r.conductor_id in (select sgc.mis_conductor_ids()))) then
    raise exception 'No tienes permiso sobre esta ruta.';
  end if;

  update sgc.ruta_paradas set
    estado        = p_estado,
    llegada_at    = case when p_estado = 'en_camino' and llegada_at is null then now() else llegada_at end,
    entregada_at  = case when p_estado = 'entregada' then now() else entregada_at end,
    entregado_a   = coalesce(nullif(p_entregado_a,''), entregado_a),
    foto_path     = coalesce(nullif(p_foto_path,''), foto_path),
    firma_path    = coalesce(nullif(p_firma_path,''), firma_path),
    notas_entrega = coalesce(nullif(p_notas,''), notas_entrega)
  where id = p_parada_id;
end;
$$;
grant execute on function sgc.avanzar_parada(uuid, text, text, text, text, text) to authenticated, service_role;

-- ── 6) Trigger: recepción de conduce atado a parada → parada 'entregada' ────
create or replace function sgc.tg_conduce_entregado_marca_parada()
returns trigger language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
begin
  if new.ruta_parada_id is not null
     and new.estado in ('entregado','entregado_incompleto')
     and coalesce(old.estado,'') is distinct from new.estado then
    update sgc.ruta_paradas p set
      estado        = 'entregada',
      entregada_at  = coalesce(p.entregada_at, now()),
      foto_path     = coalesce(p.foto_path, new.recepcion_foto_path, new.entrega_foto_path),
      firma_path    = coalesce(p.firma_path, new.entrega_firma_path),
      entregado_a   = coalesce(p.entregado_a, new.entrega_receptor)
    where p.id = new.ruta_parada_id
      and p.estado <> 'entregada';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_conduce_entregado_marca_parada on sgc.salidas_inventario;
create trigger trg_conduce_entregado_marca_parada
  after update of estado on sgc.salidas_inventario
  for each row execute function sgc.tg_conduce_entregado_marca_parada();

-- ── 7) ruta_detalle_transporte: paradas con estado + conduce vinculado ──────
create or replace function sgc.ruta_detalle_transporte(p_ruta_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
    'paradas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pa.id, 'orden', pa.orden, 'ubicacion', pa.ubicacion,
        'lat', pa.lat, 'lng', pa.lng, 'notas', pa.notas,
        'obra', pr.nombre, 'proyecto_id', pa.proyecto_id,
        'estado', pa.estado, 'llegada_at', pa.llegada_at, 'entregada_at', pa.entregada_at,
        'entregado_a', pa.entregado_a, 'foto_path', pa.foto_path, 'firma_path', pa.firma_path,
        'notas_entrega', pa.notas_entrega,
        'conduce_id', (select s2.id from sgc.salidas_inventario s2 where s2.ruta_parada_id = pa.id limit 1)
      ) order by pa.orden), '[]'::jsonb)
      from sgc.ruta_paradas pa
      left join sgc.proyectos pr on pr.id = pa.proyecto_id
      where pa.ruta_id = p_ruta_id
    ),
    'conduces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'fecha', s.fecha, 'estado', s.estado,
        'destino', p.nombre, 'bodega', b.nombre,
        'ruta_parada_id', s.ruta_parada_id, 'parada_ubicacion', pp.ubicacion,
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
      left join sgc.ruta_paradas pp on pp.id = s.ruta_parada_id
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

-- ── Conduce → su ruta/parada (para el detalle del conduce en la web) ────────
create or replace function sgc.conduce_ruta_info(p_salida_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp' as $$
  select case when s.ruta_id is null then null else jsonb_build_object(
    'ruta_id', s.ruta_id,
    'origen', r.origen, 'destino', r.destino, 'fecha', r.fecha,
    'estado_ruta', r.estado, 'tipo', r.tipo,
    'ruta_parada_id', s.ruta_parada_id,
    'parada_ubicacion', pp.ubicacion, 'parada_orden', pp.orden, 'parada_estado', pp.estado,
    'parada_entregada_at', pp.entregada_at, 'parada_entregado_a', pp.entregado_a
  ) end
  from sgc.salidas_inventario s
  left join sgc.rutas r on r.id = s.ruta_id
  left join sgc.ruta_paradas pp on pp.id = s.ruta_parada_id
  where s.id = p_salida_id;
$$;
grant execute on function sgc.conduce_ruta_info(uuid) to authenticated, service_role;
