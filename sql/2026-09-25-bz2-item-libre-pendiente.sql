-- ════════════════════════════════════════════════════════════════════════════
-- BZ2 — UN SOLO "pendiente" para el material no catalogado.
-- Nota #78: en "Conduces por implementar" aparecen conduces ya gestionados, y al
-- pulsar "Implementar" la bandeja sale vacía.
-- ════════════════════════════════════════════════════════════════════════════
-- Causa exacta (regla 14 — dos definiciones de "pendiente"):
--   • conduces_por_implementar()/_count() contaban `articulo_vinculado_id is null`
--     (ay13:24,36) — SIN excluir los DECLINADOS (AT11: declinado_at).
--   • la bandeja material_no_catalogado_pendientes() SÍ excluye declinados (at11).
--   Un item DECLINADO sigue con articulo_vinculado_id null → el conduce se queda en
--   "por implementar" con "1 de 2", el badge cuenta de más, y "Implementar" abre una
--   bandeja que (correctamente) no lo muestra → vacía.
-- Fix: UNA función `item_libre_pendiente(il)` = sin vincular Y sin declinar, usada por
-- la lista, el count, la bandeja y el hook BV4. "Implementar" abrirá la bandeja
-- filtrada por conduce (frontend) mostrando también resueltos/declinados con su estado.
-- 2ª causa hallada en dev (Raykler es flota-elevado SIN módulo `inventario`): BW2 abrió
-- crear/vincular a es_flota_elevado, pero la LECTURA de la bandeja y `declinar` seguían
-- exigiendo módulo `inventario` → Raykler veía el conduce en la lista (gate flota) pero
-- la bandeja salía vacía y no podía declinar. Aquí se alinea: acceso a la bandeja ⊇
-- acceso a la lista de conduces, y declinar/revertir igualan a crear/vincular (BW2).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-25-bz2-item-libre-pendiente.sql --env dev  →  --env prod --yes
-- Rollback: las funciones vuelven a su predicado inline anterior (au4/ay13/at11/bv4f).
begin;

-- ── Predicado ÚNICO de "item libre pendiente" ─────────────────────────────────
-- Un material no catalogado sigue PENDIENTE mientras no se haya vinculado a un
-- artículo (AU4) NI se haya declinado (AT11). Fuente única de verdad.
create or replace function sgc.item_libre_pendiente(il sgc.salida_items_libres)
returns boolean
language sql
immutable
as $$
  select il.articulo_vinculado_id is null and il.declinado_at is null;
$$;
grant execute on function sgc.item_libre_pendiente(sgc.salida_items_libres) to authenticated, service_role;
comment on function sgc.item_libre_pendiente(sgc.salida_items_libres) is
  'BZ2 — predicado ÚNICO: un item libre (material no catalogado) está pendiente si no '
  'está vinculado (AU4) ni declinado (AT11). Lo usan lista, count, bandeja y hook BV4.';

-- ── AY13 — Listado de conduces por implementar (usa el predicado único) ───────
create or replace function sgc.conduces_por_implementar()
returns table (
  salida_id       uuid,
  conduce_numero  text,
  fecha           date,
  estado          text,
  estado_label    text,
  proyecto        text,
  bodega          text,
  creado_por      text,
  pendientes      int,
  total_libres    int,
  es_prueba       boolean,
  created_at      timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id as salida_id,
         'CND-' || upper(left(s.id::text, 8)) as conduce_numero,
         s.fecha, s.estado, sgc.label_estado_salida(s.estado) as estado_label,
         p.nombre as proyecto, b.nombre as bodega,
         u.nombre as creado_por,
         count(*) filter (where sgc.item_libre_pendiente(il))::int as pendientes,
         count(*)::int as total_libres,
         coalesce(s.es_prueba, false) as es_prueba,
         s.created_at
  from sgc.salida_items_libres il
  join sgc.salidas_inventario s on s.id = il.salida_id
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.usuarios  u on u.id = s.creado_por
  where (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota'))
    and (not coalesce(s.es_prueba, false) or sgc.is_admin())
  group by s.id, p.nombre, b.nombre, u.nombre
  having count(*) filter (where sgc.item_libre_pendiente(il)) > 0
  order by s.created_at desc;
$$;
grant execute on function sgc.conduces_por_implementar() to authenticated, service_role;

create or replace function sgc.conduces_por_implementar_count()
returns integer language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(distinct il.salida_id)::int
  from sgc.salida_items_libres il
  join sgc.salidas_inventario s on s.id = il.salida_id
  where (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota'))
    and sgc.item_libre_pendiente(il)
    and (not coalesce(s.es_prueba, false) or sgc.is_admin());
$$;
grant execute on function sgc.conduces_por_implementar_count() to authenticated, service_role;

-- ── AU4/AT11 — Bandeja de material no catalogado (predicado único + filtro por conduce) ──
-- p_salida_id: al pulsar "Implementar" desde un conduce, se filtra por ese conduce y
-- se MUESTRAN también sus resueltos/declinados (con estado), para que el gestor vea qué
-- pasó con cada material. Sin p_salida_id, se comporta como hoy (solo pendientes, o
-- todos si p_incluir_resueltos).
drop function if exists sgc.material_no_catalogado_pendientes(boolean);
create or replace function sgc.material_no_catalogado_pendientes(
  p_incluir_resueltos boolean default false,
  p_salida_id         uuid    default null
)
returns table (
  id uuid, salida_id uuid, conduce_numero text, nombre text, cantidad numeric,
  unidad text, articulo_vinculado_id uuid, articulo_vinculado text, reportado_por text,
  proyecto text, created_at timestamptz, vinculado_at timestamptz,
  declinado_at timestamptz, declinado_por text, declinar_motivo text, sugerido_articulo text
) language sql stable security definer set search_path = sgc, public as $$
  select il.id, il.salida_id, 'CND-' || upper(left(il.salida_id::text, 8)) as conduce_numero,
         il.nombre, il.cantidad, il.unidad, il.articulo_vinculado_id,
         av.nombre as articulo_vinculado, ru.nombre as reportado_por,
         p.nombre as proyecto, il.created_at, il.vinculado_at,
         il.declinado_at, du.nombre as declinado_por, il.declinar_motivo, sa.nombre as sugerido_articulo
    from sgc.salida_items_libres il
    left join sgc.articulos av on av.id = il.articulo_vinculado_id
    left join sgc.articulos sa on sa.id = il.sugerido_articulo_id
    left join sgc.usuarios ru on ru.id = il.created_by
    left join sgc.usuarios du on du.id = il.declinado_por
    left join sgc.salidas_inventario s on s.id = il.salida_id
    left join sgc.proyectos p on p.id = s.proyecto_id
   -- acceso a la bandeja ⊇ acceso a la lista de conduces (is_admin/inventario/flota/elevado)
   where (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota') or sgc.es_flota_elevado())
     and ((not il.es_prueba) or sgc.is_admin())
     and (p_salida_id is null or il.salida_id = p_salida_id)
     -- Al filtrar por conduce se muestran también resueltos/declinados (ver qué pasó).
     and (p_incluir_resueltos or p_salida_id is not null or sgc.item_libre_pendiente(il))
   order by il.created_at desc;
$$;
grant execute on function sgc.material_no_catalogado_pendientes(boolean, uuid) to authenticated, service_role;

create or replace function sgc.material_no_catalogado_pendientes_count()
returns int language sql stable security definer set search_path = sgc, public as $$
  select count(*)::int from sgc.salida_items_libres il
   where (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota') or sgc.es_flota_elevado())
     and ((not il.es_prueba) or sgc.is_admin())
     and sgc.item_libre_pendiente(il);
$$;
grant execute on function sgc.material_no_catalogado_pendientes_count() to authenticated, service_role;

-- ── AT11 — declinar/revertir alineados a crear/vincular (es_flota_elevado, BW2) ──
create or replace function sgc.declinar_item_libre(
  p_item_libre_id uuid, p_motivo text, p_sugerido_articulo_id uuid default null
) returns void
language plpgsql security definer set search_path = sgc, public as $$
declare v_row sgc.salida_items_libres%rowtype; v_art_nombre text;
begin
  if not (sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into v_row from sgc.salida_items_libres where id = p_item_libre_id;
  if not found then raise exception 'Item no encontrado' using errcode = 'AT404'; end if;
  if v_row.articulo_vinculado_id is not null then
    raise exception 'Este material ya fue catalogado; no se puede declinar.' using errcode = 'AT409';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indica el motivo del rechazo.' using errcode = 'AT422';
  end if;

  update sgc.salida_items_libres
     set declinado_at = now(), declinado_por = auth.uid(),
         declinar_motivo = trim(p_motivo), sugerido_articulo_id = p_sugerido_articulo_id
   where id = p_item_libre_id;

  if v_row.created_by is not null then
    if p_sugerido_articulo_id is not null then
      select nombre into v_art_nombre from sgc.articulos where id = p_sugerido_articulo_id;
    end if;
    perform sgc.notificar(v_row.created_by, 'info', 'Material no catalogado declinado',
      format('«%s» no se agregará al catálogo. Motivo: %s%s', v_row.nombre, trim(p_motivo),
             case when v_art_nombre is not null then format(' (ya existe como: %s)', v_art_nombre) else '' end),
      '/inventario/material-no-catalogado');
  end if;
end;
$$;
grant execute on function sgc.declinar_item_libre(uuid, text, uuid) to authenticated, service_role;

create or replace function sgc.revertir_declinacion_item_libre(p_item_libre_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public as $$
begin
  if not (sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.salida_items_libres
     set declinado_at = null, declinado_por = null, declinar_motivo = null, sugerido_articulo_id = null
   where id = p_item_libre_id and articulo_vinculado_id is null;
end;
$$;
grant execute on function sgc.revertir_declinacion_item_libre(uuid) to authenticated, service_role;

-- ── BV4 — Hook de emparejamiento: un item libre solo cubre requisición si está PENDIENTE ──
-- (un item declinado no debe matchear por nombre). Recrea la def viva (3-arg, bv4f)
-- cambiando solo el predicado de la rama "item libre sin vincular".
create or replace function sgc.vincular_movimiento_requisiciones(p_tipo text, p_id uuid, p_solo_articulo boolean default false)
returns integer language plpgsql security definer set search_path to 'sgc', 'extensions', 'pg_temp' as $fn$
declare
  v_proy    uuid;
  v_n       int := 0;
  m         record;
  v_left    numeric;
  v_item    uuid;
  v_rem     numeric;
  v_sim     numeric;
  v_score   numeric;
  v_revisar boolean;
begin
  if exists (select 1 from sgc.requisicion_cubierta_por where movimiento_tipo = p_tipo and movimiento_id = p_id) then
    return 0; -- idempotente
  end if;

  if p_tipo = 'salida' then
    select proyecto_id into v_proy from sgc.salidas_inventario where id = p_id and origen_requisicion_id is null;
  elsif p_tipo = 'entrada' then
    select b.proyecto_id into v_proy from sgc.entradas_inventario e join sgc.bodegas b on b.id = e.bodega_id where e.id = p_id;
  end if;
  if v_proy is null then return 0; end if;

  drop table if exists _pend;
  create temp table _pend on commit drop as
    select pi.item_id, pi.articulo_id,
           upper(unaccent(coalesce(smi.descripcion, ''))) as desc_norm,
           pi.pendiente::numeric as rem, s.fecha_necesidad, s.created_at
    from sgc.solicitudes_material s
    join lateral sgc.requisicion_pendiente_items(s.id) pi on pi.pendiente > 0
    join sgc.solicitud_material_items smi on smi.id = pi.item_id
    where s.proyecto_id = v_proy
      and sgc.requisicion_fase(s.id) in ('pendiente', 'en_proceso');

  if not exists (select 1 from _pend) then return 0; end if;

  for m in
    select 'articulo'::text as via, ds.articulo_id, null::text as desc_norm, ds.cantidad::numeric as qty
    from sgc.detalle_salidas ds where p_tipo = 'salida' and ds.salida_id = p_id and coalesce(ds.cantidad, 0) > 0
    union all
    select 'articulo'::text, li.articulo_vinculado_id, null::text, li.cantidad::numeric
    from sgc.salida_items_libres li
    where p_tipo = 'salida' and li.salida_id = p_id and li.articulo_vinculado_id is not null and coalesce(li.cantidad, 0) > 0
    union all
    -- nombre (trigram): solo items libres PENDIENTES (sin vincular y sin declinar, BZ2);
    -- se omite en modo solo-artículo (backfill histórico).
    select 'nombre'::text, null::uuid, upper(unaccent(coalesce(li.nombre, ''))), li.cantidad::numeric
    from sgc.salida_items_libres li
    where p_tipo = 'salida' and not p_solo_articulo
      and li.salida_id = p_id and sgc.item_libre_pendiente(li) and coalesce(li.cantidad, 0) > 0
  loop
    v_left := m.qty;
    loop
      exit when v_left <= 0;
      v_item := null; v_rem := null; v_sim := null;
      if m.via = 'articulo' then
        select item_id, rem into v_item, v_rem from _pend
          where rem > 0 and articulo_id = m.articulo_id
          order by fecha_necesidad asc nulls last, created_at asc limit 1;
        v_score := 1.0; v_revisar := false;
      else
        select item_id, rem, similarity(desc_norm, m.desc_norm)
          into v_item, v_rem, v_sim from _pend
          where rem > 0 and desc_norm <> '' and similarity(desc_norm, m.desc_norm) >= 0.6
          order by similarity(desc_norm, m.desc_norm) desc, fecha_necesidad asc nulls last, created_at asc limit 1;
        v_score := round(coalesce(v_sim, 0)::numeric, 2);
        v_revisar := coalesce(v_sim, 0) < 0.8;
      end if;
      exit when v_item is null;

      insert into sgc.requisicion_cubierta_por (requisicion_item_id, movimiento_tipo, movimiento_id, cantidad, via, score, revisar)
      values (v_item, p_tipo, p_id, least(v_left, v_rem), m.via, v_score, v_revisar);
      update _pend set rem = rem - least(v_left, v_rem) where item_id = v_item;
      v_left := v_left - least(v_left, v_rem);
      v_n := v_n + 1;
    end loop;
  end loop;

  return v_n;
end $fn$;
grant execute on function sgc.vincular_movimiento_requisiciones(text, uuid, boolean) to authenticated, service_role;

commit;
