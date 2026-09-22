-- BV4 (backfill articulo-only) — el motor gana un parámetro p_solo_articulo. En true
-- ignora el emparejamiento por nombre (trigram) y solo liga por articulo_id (alta
-- confianza). Es lo que usa el backfill histórico (el nombre solo aplica hacia adelante).
-- El hook de recepción llama con 2 args → resuelve al default (false) = comportamiento igual.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv4f-solo-articulo.sql --env dev  →  --env prod
begin;

drop function if exists sgc.vincular_movimiento_requisiciones(text, uuid);

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
    -- nombre (trigram): se omite en modo solo-artículo (backfill histórico).
    select 'nombre'::text, null::uuid, upper(unaccent(coalesce(li.nombre, ''))), li.cantidad::numeric
    from sgc.salida_items_libres li
    where p_tipo = 'salida' and not p_solo_articulo
      and li.salida_id = p_id and li.articulo_vinculado_id is null and coalesce(li.cantidad, 0) > 0
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
