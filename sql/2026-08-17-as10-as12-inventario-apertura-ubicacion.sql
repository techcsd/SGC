-- ============================================================================
-- PROMPT-17 (AS) — FASE 3 — Inventario/almacenes: herramienta de apertura en
--   lote (AS10), ubicación de almacén por proyecto o mapa (AS12).
--   Aditivo / retrocompatible.
-- ----------------------------------------------------------------------------
--   AS10: el MODELO de apertura ya existe (AP5: stock_apertura + set_apertura,
--         admin-only, sin movimientos ni timeline, re-base sin caída). Aquí SÓLO
--         se añade el set en LOTE para la herramienta admin. NO se corre ningún
--         seed masivo (el ⏸ de PROMPT-11 sigue en pausa; se dispara desde la UI
--         con el OK de Xaviel).
--   AS11: agregar artículo al almacén / ajustar stock ya tienen camino server:
--         set_apertura (stock inicial, admin) y ajustar_stock_articulo (ajuste,
--         admin|módulo inventario, deja traza en Conteos y ajustes). NO se crea un
--         tercer camino. (Todo el trabajo restante de AS11 es UI.)
--   AS12: ubicación del almacén — vincular a un proyecto (hereda y se mantiene
--         sincronizada con la ubicación de la obra AM7) o ubicación propia con el
--         input estándar (link/coords/pin/Places, AO2). Contrato para app y web.
--   AS13: Conteos + Ajustes YA están unificados (conteos_inventario discriminado
--         por tipo; una sola página "Conteos y ajustes"). Nada que migrar en BD.
-- ============================================================================

set search_path = sgc, public;

-- ════════════════════════════════════════════════════════════════════════════
-- AS10 — Apertura en LOTE (herramienta admin). Reusa set_apertura (reglas AP5).
-- ════════════════════════════════════════════════════════════════════════════
-- p_solo_faltantes = true → sólo artículos SIN fila de apertura explícita (no
-- pisa aperturas ya seteadas). p_articulo_ids → subconjunto; null → todo el
-- catálogo del almacén (los que ya tienen stock_por_bodega o, si se pide, todos).
create or replace function sgc.set_apertura_lote(
  p_bodega_id     uuid,
  p_cantidad      numeric,
  p_solo_faltantes boolean default true,
  p_articulo_ids  uuid[]  default null,
  p_incluir_todo_catalogo boolean default false
) returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_r record;
  v_n int := 0;
begin
  if not sgc.is_admin() then
    raise exception 'Sólo un administrador puede fijar la apertura.' using errcode = '42501';
  end if;
  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad de apertura no puede ser negativa.';
  end if;

  for v_r in
    select a.id as articulo_id
    from sgc.articulos a
    where coalesce(a.activo, true)
      and (p_articulo_ids is null or a.id = any(p_articulo_ids))
      and (not coalesce(a.es_prueba, false))
      -- universo: artículos con stock en el almacén, o todo el catálogo si se pide,
      -- o los indicados explícitamente en p_articulo_ids.
      and (
        p_incluir_todo_catalogo
        or p_articulo_ids is not null
        or exists (select 1 from sgc.stock_por_bodega sb
                   where sb.articulo_id = a.id and sb.bodega_id = p_bodega_id)
      )
      and (
        not p_solo_faltantes
        or not exists (select 1 from sgc.stock_apertura ap
                       where ap.articulo_id = a.id and ap.bodega_id = p_bodega_id)
      )
  loop
    perform sgc.set_apertura(v_r.articulo_id, p_bodega_id, p_cantidad);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;
grant execute on function sgc.set_apertura_lote(uuid, numeric, boolean, uuid[], boolean) to authenticated, service_role;
comment on function sgc.set_apertura_lote(uuid, numeric, boolean, uuid[], boolean) is
  'AS10 — fija la apertura (AP5) en lote para un almacén. Admin-only. Reusa set_apertura (sin movimientos, sin timeline, re-base sin caída). Devuelve cuántos artículos tocó.';

-- ════════════════════════════════════════════════════════════════════════════
-- AS12 — Ubicación del almacén (vincular a proyecto | ubicación propia)
-- ════════════════════════════════════════════════════════════════════════════
alter table sgc.bodegas
  add column if not exists ubicacion_metodo         text,
  add column if not exists ubicacion_hereda_proyecto boolean not null default false;
comment on column sgc.bodegas.ubicacion_metodo is
  'AS12 — cómo se fijó la ubicación: proyecto|maps_link|coords|pin|places.';
comment on column sgc.bodegas.ubicacion_hereda_proyecto is
  'AS12 — true si la ubicación se hereda del proyecto vinculado (se mantiene sincronizada con set_proyecto_ubicacion / cambios de la obra).';

create or replace function sgc.set_bodega_ubicacion(
  p_bodega_id   uuid,
  p_proyecto_id uuid    default null,   -- si viene → vincular y heredar del proyecto
  p_lat         numeric default null,
  p_lng         numeric default null,
  p_direccion   text    default null,
  p_metodo      text    default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_lat numeric; v_lng numeric; v_dir text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras')
          or (p_proyecto_id is not null and sgc.es_responsable_de_proyecto(p_proyecto_id))) then
    raise exception 'No autorizado para editar la ubicación del almacén.' using errcode = '42501';
  end if;

  if p_proyecto_id is not null then
    -- Vincular a la obra: hereda la ubicación estructurada del proyecto (AM7).
    select p.latitud, p.longitud, coalesce(p.direccion_geo, p.ubicacion)
      into v_lat, v_lng, v_dir
      from sgc.proyectos p where p.id = p_proyecto_id;
    update sgc.bodegas set
      proyecto_id               = p_proyecto_id,
      latitud                   = v_lat,
      longitud                  = v_lng,
      ubicacion                 = coalesce(v_dir, ubicacion),
      ubicacion_metodo          = 'proyecto',
      ubicacion_hereda_proyecto = true
    where id = p_bodega_id;
  else
    -- Ubicación propia (link/coords/pin/Places). Deja de heredar.
    if p_lat is not null and (p_lat < -90 or p_lat > 90) then
      raise exception 'Latitud fuera de rango.' using errcode = 'DR472'; end if;
    if p_lng is not null and (p_lng < -180 or p_lng > 180) then
      raise exception 'Longitud fuera de rango.' using errcode = 'DR472'; end if;
    update sgc.bodegas set
      latitud                   = round(p_lat, 6),
      longitud                  = round(p_lng, 6),
      ubicacion                 = coalesce(nullif(p_direccion,''), ubicacion),
      ubicacion_metodo          = coalesce(nullif(p_metodo,''), 'coords'),
      ubicacion_hereda_proyecto = false
    where id = p_bodega_id;
  end if;
end;
$$;
grant execute on function sgc.set_bodega_ubicacion(uuid, uuid, numeric, numeric, text, text) to authenticated, service_role;
comment on function sgc.set_bodega_ubicacion(uuid, uuid, numeric, numeric, text, text) is
  'AS12 — fija la ubicación de un almacén: vincular a proyecto (hereda AM7, se sincroniza) o ubicación propia (link/coords/pin/Places). Formaliza obra↔almacén (AH9).';

-- Sincronización: cuando cambia la ubicación de una obra, propaga a los almacenes
-- que heredan de ella (AS12 — "se mantiene sincronizada con la ubicación de la obra").
create or replace function sgc.tg_sync_ubicacion_bodegas_proyecto()
returns trigger
language plpgsql
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if new.latitud is distinct from old.latitud
     or new.longitud is distinct from old.longitud
     or coalesce(new.direccion_geo,'') is distinct from coalesce(old.direccion_geo,'') then
    update sgc.bodegas b set
      latitud   = new.latitud,
      longitud  = new.longitud,
      ubicacion = coalesce(new.direccion_geo, new.ubicacion, b.ubicacion)
    where b.proyecto_id = new.id and coalesce(b.ubicacion_hereda_proyecto, false);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_ubicacion_bodegas on sgc.proyectos;
create trigger trg_sync_ubicacion_bodegas
  after update of latitud, longitud, direccion_geo on sgc.proyectos
  for each row execute function sgc.tg_sync_ubicacion_bodegas_proyecto();
