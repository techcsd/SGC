-- ════════════════════════════════════════════════════════════════════════════
-- BZ0 — Tres huecos del padre que la app (PROMPT-67, BX/BY) pidió cerrar aquí.
-- HANDOFF fc014fc. No esperan otra ronda.
-- ════════════════════════════════════════════════════════════════════════════
--  1) listar_bitacoras(...)  — contrato de lista para la app (BY4), con la RLS de
--     bitácora (puede_ver_bitacora_de). El web lista por select directo; la app
--     necesita un RPC estable.
--  2) reenviar_echada(...)   — idempotente por (reenvio_de, client_uuid): un reintento
--     de la app con el mismo client_uuid no duplica el reenvío (BY5).
--  3) requisiciones_bandeja  — expone `cerrada_en` en la lista (BY3): la app arma el
--     "Historial" de requisiciones y necesita cuándo se cerró (la columna ya existía;
--     faltaba en el contrato de la lista).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-25-bz0-huecos-app.sql --env dev  →  --env prod --yes
-- Rollback: drop function listar_bitacoras(...); reenviar_echada vuelve a su versión no
--   idempotente; requisiciones_bandeja quita la columna cerrada_en.
begin;

-- ── 1) listar_bitacoras — contrato de lista para la app (BY4) ──────────────────
-- p_todas=false → solo las mías; p_todas=true → todas las que puedo ver (mías +
-- las de proyectos donde soy responsable / con módulo proyectos / ver_todas / admin).
-- La visibilidad se resuelve por fila con puede_ver_bitacora_de (misma RLS que el web).
create or replace function sgc.listar_bitacoras(
  p_todas     boolean default true,
  p_proyecto  uuid    default null,
  p_desde     date    default null,
  p_hasta     date    default null,
  p_ingeniero uuid    default null
)
returns table (
  id                     uuid,
  fecha                  date,
  tipo                   text,
  proyecto_id            uuid,
  proyecto_nombre        text,
  usuario_id             uuid,
  autor_nombre           text,
  ingeniero_responsable  text,
  comentarios            text,
  sin_actividad          boolean,
  es_prueba              boolean,
  created_at             timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select b.id, b.fecha, b.tipo, b.proyecto_id, p.nombre as proyecto_nombre,
         b.usuario_id, u.nombre as autor_nombre, b.ingeniero_responsable,
         b.comentarios, coalesce(b.sin_actividad, false) as sin_actividad,
         coalesce(b.es_prueba, false) as es_prueba, b.created_at
    from sgc.bitacoras b
    left join sgc.proyectos p on p.id = b.proyecto_id
    left join sgc.usuarios  u on u.id = b.usuario_id
   where (
           b.usuario_id = auth.uid()
           or (coalesce(p_todas, true) and sgc.puede_ver_bitacora_de(b.proyecto_id))
         )
     and (not coalesce(b.es_prueba, false) or sgc.is_admin())
     and (p_proyecto  is null or b.proyecto_id = p_proyecto)
     and (p_desde     is null or b.fecha >= p_desde)
     and (p_hasta     is null or b.fecha <= p_hasta)
     and (p_ingeniero is null or b.usuario_id = p_ingeniero)
   order by b.fecha desc, b.created_at desc;
$$;
grant execute on function sgc.listar_bitacoras(boolean, uuid, date, date, uuid) to authenticated, service_role;
comment on function sgc.listar_bitacoras(boolean, uuid, date, date, uuid) is
  'BZ0/BY4 — lista de bitácoras para la app con la RLS de bitácora (puede_ver_bitacora_de). '
  'p_todas=false → solo las mías; true → todas las visibles. Filtros: proyecto, rango de '
  'fecha, ingeniero (usuario_id).';

-- ── 2) reenviar_echada — idempotente por (reenvio_de, client_uuid) ────────────
create or replace function sgc.reenviar_echada(p_original uuid, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_orig   sgc.registros_combustible%rowtype;
  v_exist  sgc.registros_combustible%rowtype;
  v_client uuid := nullif(p_datos->>'client_uuid','')::uuid;
  v_res    jsonb;
  v_new    uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_orig from sgc.registros_combustible where id = p_original;
  if not found then raise exception 'Echada original no encontrada'; end if;

  -- Idempotencia: un reintento con el mismo client_uuid devuelve el reenvío ya creado.
  if v_client is not null then
    select * into v_exist from sgc.registros_combustible
      where reenvio_de = p_original and client_uuid = v_client limit 1;
    if found then return to_jsonb(v_exist); end if;
  end if;

  if v_orig.revision <> 'rechazada' then
    raise exception 'Solo se reenvía una echada rechazada' using errcode = '22023';
  end if;
  if not (sgc.is_admin() or sgc.es_flota_elevado()
          or v_orig.registrado_por = v_uid
          or exists (select 1 from sgc.conductores c where c.id = v_orig.conductor_id and c.usuario_id = v_uid)) then
    raise exception 'No puedes reenviar esta echada' using errcode = '42501';
  end if;

  -- Reusa el camino normal (recalcula km/rendimiento). El client_uuid estable hace que
  -- registrar_combustible_app sea idempotente en reintentos de red.
  v_res := sgc.registrar_combustible_app(
    coalesce(v_client, gen_random_uuid()),
    coalesce(nullif(p_datos->>'vehiculo_id','')::uuid, v_orig.vehiculo_id),
    v_orig.conductor_id,
    coalesce(nullif(p_datos->>'fecha','')::date, v_orig.fecha),
    coalesce(nullif(p_datos->>'kilometraje','')::int, v_orig.kilometraje),
    coalesce(nullif(p_datos->>'galones','')::numeric, v_orig.galones),
    coalesce(nullif(p_datos->>'monto','')::numeric, v_orig.monto),
    coalesce(nullif(p_datos->>'estacion',''), v_orig.estacion),
    v_orig.foto_recibo_path, v_orig.foto_tablero_path,
    coalesce(nullif(p_datos->>'notas',''), v_orig.notas),
    v_orig.foto_bomba_path, v_orig.producto);
  v_new := nullif(v_res->>'id','')::uuid;
  if v_new is not null then
    update sgc.registros_combustible set reenvio_de = p_original where id = v_new;
  end if;
  return v_res;
end $function$;
grant execute on function sgc.reenviar_echada(uuid, jsonb) to authenticated, service_role;

-- ── 3) requisiciones_bandeja — exponer cerrada_en en la lista (BY3) ───────────
drop function if exists sgc.requisiciones_bandeja(text, uuid, text, text, integer);
create or replace function sgc.requisiciones_bandeja(
  p_estado text default null, p_proyecto_id uuid default null,
  p_urgencia text default null, p_busqueda text default null, p_limite integer default 100)
returns table(
  id uuid, estado text, urgencia text, notas text, created_at timestamptz,
  cerrada_en timestamptz, proyecto_id uuid, proyecto_nombre text,
  solicitante_id uuid, solicitante_nombre text, items_count integer,
  tiene_conduce boolean, tiene_compra boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.estado, s.urgencia, s.notas, s.created_at, s.cerrada_en,
         s.proyecto_id, p.nombre as proyecto_nombre,
         s.solicitante_id, u.nombre as solicitante_nombre,
         (select count(*)::int from sgc.solicitud_material_items i where i.solicitud_id = s.id) as items_count,
         (s.salida_id is not null) as tiene_conduce,
         (s.solicitud_compra_id is not null) as tiene_compra
  from sgc.solicitudes_material s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.usuarios  u on u.id = s.solicitante_id
  where sgc.puede_ver_todas_requisiciones()
    and (p_estado      is null or s.estado = p_estado)
    and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
    and (p_urgencia    is null or s.urgencia = p_urgencia)
    and (
      p_busqueda is null or p_busqueda = ''
      or p.nombre ilike '%' || p_busqueda || '%'
      or u.nombre ilike '%' || p_busqueda || '%'
      or exists (
        select 1 from sgc.solicitud_material_items i
        where i.solicitud_id = s.id and i.descripcion ilike '%' || p_busqueda || '%'
      )
    )
  order by
    case s.estado when 'pendiente' then 0 when 'aprobada' then 1 else 2 end,
    case s.urgencia when 'urgente' then 0 else 1 end,
    s.created_at desc
  limit coalesce(p_limite, 100);
$$;
grant execute on function sgc.requisiciones_bandeja(text, uuid, text, text, integer) to authenticated, service_role;

commit;
