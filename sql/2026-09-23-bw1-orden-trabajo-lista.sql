-- ============================================================================
-- BW1 (PROMPT-62 F2) — Ver, revisar y compartir la Orden de trabajo
-- ----------------------------------------------------------------------------
-- Nota de Xaviel (23-sep): «Theres no a way to view and check the 'orden de
-- trabajo' that a user creates, we need a way to view and share it.»
--
-- La OT ya existe como bitácora tipo 'orden_trabajo' (BN1): tablas
-- bitacora_orden_detalle / bitacora_orden_firmas, RPC crear_orden_trabajo /
-- orden_trabajo_detalle. Faltaba: (a) numeración visible OT-000123, (b) una
-- LISTA propia con estado derivado de las firmas, (c) avisos al crear/compartir.
--
-- ADITIVO: columna `numero` + secuencia + backfill; RPC de lista (security
-- invoker → respeta RLS de bitácora); tipos de aviso; crear_orden_trabajo avisa.
-- Estado derivado (capa de lectura, SIN CHECK nuevo): borrador (sin firmas) /
-- emitida (firma del ingeniero) / firmada (ambas). NO existe "cerrada" a nivel de
-- bitácora en el esquema (bitacoras no tiene columna de cierre) → no se deriva.
--
-- BU1 (regla 18): aplicar `--env dev` primero, probar, luego `--env prod --yes`.
-- ============================================================================

begin;

-- ── 1) Numeración visible OT-000123 (secuencia + backfill por created_at) ─────
alter table sgc.bitacora_orden_detalle add column if not exists numero bigint;

create sequence if not exists sgc.orden_trabajo_numero_seq;

-- Backfill determinista por antigüedad (created_at, luego id como desempate).
with ordenado as (
  select id, row_number() over (order by created_at, id) as rn
  from sgc.bitacora_orden_detalle
  where numero is null
)
update sgc.bitacora_orden_detalle d
   set numero = o.rn
  from ordenado o
 where d.id = o.id;

-- Avanzar la secuencia más allá del máximo backfilleado.
select setval('sgc.orden_trabajo_numero_seq',
              coalesce((select max(numero) from sgc.bitacora_orden_detalle), 0) + 1, false);

alter table sgc.bitacora_orden_detalle
  alter column numero set default nextval('sgc.orden_trabajo_numero_seq');

create unique index if not exists uq_orden_detalle_numero
  on sgc.bitacora_orden_detalle(numero);

-- Evita el clásico "permission denied for sequence" (aunque el INSERT va por
-- crear_orden_trabajo, que es SECURITY DEFINER y dueño de la secuencia).
grant usage, select on sequence sgc.orden_trabajo_numero_seq to authenticated, service_role;

comment on column sgc.bitacora_orden_detalle.numero is
  'BW1 — número visible de la orden de trabajo (OT-000123). Secuencia orden_trabajo_numero_seq.';

-- ── 2) RPC de lista (respeta RLS de bitácora: security INVOKER) ──────────────
-- Devuelve por cada OT: número, obra, fecha, responsable (autor), creado_por,
-- estado derivado de las firmas y conteo de fotos (bitacora_archivos).
create or replace function sgc.listar_ordenes_trabajo(
  p_proyecto  uuid    default null,
  p_desde     date    default null,
  p_hasta     date    default null,
  p_estado    text    default null,
  p_solo_mias boolean default false
) returns table (
  bitacora_id  uuid,
  numero       bigint,
  codigo       text,
  fecha        date,
  proyecto_id  uuid,
  proyecto     text,
  descripcion  text,
  ubicacion    text,
  responsable  text,     -- autor de la OT (el ingeniero que la levantó)
  creado_por   text,
  created_at   timestamptz,
  estado       text,     -- borrador | emitida | firmada
  fotos        integer,
  es_prueba    boolean
)
language sql
stable
security invoker
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    b.id as bitacora_id,
    d.numero,
    'OT-' || lpad(coalesce(d.numero, 0)::text, 6, '0') as codigo,
    b.fecha,
    b.proyecto_id,
    p.nombre as proyecto,
    d.descripcion,
    d.ubicacion,
    u.nombre as responsable,
    u.nombre as creado_por,
    b.created_at,
    case
      when exists (select 1 from sgc.bitacora_orden_firmas f
                     where f.bitacora_id = b.id and f.rol = 'ingeniero')
       and exists (select 1 from sgc.bitacora_orden_firmas f
                     where f.bitacora_id = b.id and f.rol = 'cliente')
        then 'firmada'
      when exists (select 1 from sgc.bitacora_orden_firmas f
                     where f.bitacora_id = b.id and f.rol = 'ingeniero')
        then 'emitida'
      else 'borrador'
    end as estado,
    (select count(*)::int from sgc.bitacora_archivos a where a.bitacora_id = b.id) as fotos,
    b.es_prueba
  from sgc.bitacoras b
  join sgc.bitacora_orden_detalle d on d.bitacora_id = b.id
  left join sgc.proyectos p on p.id = b.proyecto_id
  left join sgc.usuarios  u on u.id = b.usuario_id
  where b.tipo = 'orden_trabajo'
    and (p_proyecto is null or b.proyecto_id = p_proyecto)
    and (p_desde is null or b.fecha >= p_desde)
    and (p_hasta is null or b.fecha <= p_hasta)
    and (not coalesce(p_solo_mias, false) or b.usuario_id = auth.uid())
    and (
      p_estado is null or p_estado = '' or
      p_estado = case
        when exists (select 1 from sgc.bitacora_orden_firmas f where f.bitacora_id = b.id and f.rol = 'ingeniero')
         and exists (select 1 from sgc.bitacora_orden_firmas f where f.bitacora_id = b.id and f.rol = 'cliente')
          then 'firmada'
        when exists (select 1 from sgc.bitacora_orden_firmas f where f.bitacora_id = b.id and f.rol = 'ingeniero')
          then 'emitida'
        else 'borrador'
      end
    )
  order by b.fecha desc, d.numero desc;
$function$;
grant execute on function sgc.listar_ordenes_trabajo(uuid, date, date, text, boolean)
  to authenticated, service_role;

comment on function sgc.listar_ordenes_trabajo(uuid, date, date, text, boolean) is
  'BW1 — lista de órdenes de trabajo visibles para el usuario (RLS de bitácora), con número OT, estado derivado de firmas y conteo de fotos.';

commit;
