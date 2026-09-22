-- BV4 (capa 1/2) — Una obra con requisición activa: lo que llega MATCHEA lo pendiente;
-- lo extra ya entra al inventario por su cuenta. Esta migración crea la traza y el
-- MOTOR de emparejamiento (solo REGISTRA cobertura; NO completa requisiciones ni se
-- engancha a la recepción todavía — eso es la capa 2, tras probar el matching).
-- Nota #53. NO catalogados viven en salida_items_libres (descripcion).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv4-vincular-requisiciones.sql --env dev  →  --env prod
-- Rollback: drop function vincular_movimiento_requisiciones(text,uuid); drop table sgc.requisicion_cubierta_por;
begin;

create table if not exists sgc.requisicion_cubierta_por (
  id                   uuid primary key default gen_random_uuid(),
  requisicion_item_id  uuid not null references sgc.solicitud_material_items(id) on delete cascade,
  movimiento_tipo      text not null check (movimiento_tipo in ('salida', 'entrada')),
  movimiento_id        uuid not null,
  cantidad             numeric not null,
  via                  text not null check (via in ('articulo', 'nombre')),
  score                numeric,
  revisar              boolean not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists idx_req_cubierta_item on sgc.requisicion_cubierta_por(requisicion_item_id);
create index if not exists idx_req_cubierta_mov on sgc.requisicion_cubierta_por(movimiento_tipo, movimiento_id);

alter table sgc.requisicion_cubierta_por enable row level security;
drop policy if exists req_cubierta_sel on sgc.requisicion_cubierta_por;
create policy req_cubierta_sel on sgc.requisicion_cubierta_por for select to authenticated using (true);
grant select on sgc.requisicion_cubierta_por to authenticated;
grant all on sgc.requisicion_cubierta_por to service_role;

-- Motor: empareja los ítems de un movimiento con los renglones PENDIENTES de las
-- requisiciones de la MISMA obra (fase pendiente/en_proceso), por fecha de necesidad.
-- Catálogo → articulo_id (via='articulo', score 1). No catalogado → nombre normalizado
-- trigram ≥0.6 (via='nombre', revisar si <0.8). Idempotente por movimiento. Devuelve
-- cuántos renglones cubrió. NO completa la requisición (capa 2).
create or replace function sgc.vincular_movimiento_requisiciones(p_tipo text, p_id uuid)
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
    -- Una salida YA ligada a una requisición se contabiliza como su despacho explícito
    -- (origen_requisicion_id) → NO generamos cobertura implícita (evita doble conteo).
    select proyecto_id into v_proy from sgc.salidas_inventario where id = p_id and origen_requisicion_id is null;
  elsif p_tipo = 'entrada' then
    select b.proyecto_id into v_proy from sgc.entradas_inventario e join sgc.bodegas b on b.id = e.bodega_id where e.id = p_id;
  end if;
  if v_proy is null then return 0; end if;

  drop table if exists _pend;
  create temp table _pend on commit drop as
    select pi.item_id,
           pi.articulo_id,
           upper(unaccent(coalesce(smi.descripcion, ''))) as desc_norm,
           pi.pendiente::numeric as rem,
           s.fecha_necesidad,
           s.created_at
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
    -- item libre YA vinculado a un artículo del catálogo → matchea por artículo
    select 'articulo'::text, li.articulo_vinculado_id, null::text, li.cantidad::numeric
    from sgc.salida_items_libres li
    where p_tipo = 'salida' and li.salida_id = p_id and li.articulo_vinculado_id is not null and coalesce(li.cantidad, 0) > 0
    union all
    -- item libre sin vincular → matchea por nombre normalizado (trigram)
    select 'nombre'::text, null::uuid, upper(unaccent(coalesce(li.nombre, ''))), li.cantidad::numeric
    from sgc.salida_items_libres li
    where p_tipo = 'salida' and li.salida_id = p_id and li.articulo_vinculado_id is null and coalesce(li.cantidad, 0) > 0
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

grant execute on function sgc.vincular_movimiento_requisiciones(text, uuid) to authenticated, service_role;

commit;
