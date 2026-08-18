-- ============================================================================
-- PROMPT-21 (AU) — FASE 4 — Apertura con el catálogo COMPLETO (AU6). SGC padre.
--   Aditivo / retrocompatible. Migración fechada.
-- ----------------------------------------------------------------------------
-- Contexto (CONTEXTO-ACTUALIZACION-10.md, AU6):
--   Hoy la herramienta de Apertura (AS10) y el inventario del almacén (AS11) sólo
--   listan artículos que YA tuvieron stock/apertura en ese almacén — si un artículo
--   nunca se movió allí, no aparece para darle apertura. Intención de Xaviel:
--   "aplicar apertura a un almacén = que TODOS los artículos del sistema aparezcan
--   en ese almacén con 1,000".
--   Además (decisión de Xaviel en esta ronda): los artículos creados DESPUÉS de una
--   apertura entran con 1,000 automático en los almacenes ya aperturados (antes: 0).
--
-- Cambios:
--   (1) inventario_almacen: nueva sobrecarga con p_incluir_catalogo → lista el
--       catálogo completo (stock 0 / apertura 0 para los no movidos).
--   (2) _aplicar_apertura: núcleo de la apertura SIN gate admin (para triggers);
--       set_apertura se recrea delegando en él (conserva gate + guards).
--   (3) apertura_lote_preview: cuántos artículos tocaría el lote (para el preview).
--   (4) Trigger AFTER INSERT en articulos: 1,000 automático en almacenes aperturados.
-- ============================================================================

set search_path = sgc, public;

insert into sgc.parametros (clave, valor, descripcion) values
  ('apertura_nuevos_articulos', '1000',
   'AU6 — apertura automática que reciben los artículos nuevos en los almacenes ya aperturados (0 = desactivar).')
on conflict (clave) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) Núcleo reutilizable de apertura (SIN gate admin — uso interno/triggers)
-- ════════════════════════════════════════════════════════════════════════════
-- Re-basa apertura + stock a (cantidad + Σ movimientos) sin movimiento/kardex.
-- Idéntico al cuerpo de set_apertura (AP5) pero sin la comprobación de admin, para
-- que lo puedan invocar disparadores server-side de confianza.
create or replace function sgc._aplicar_apertura(
  p_articulo_id uuid,
  p_bodega_id   uuid,
  p_cantidad    numeric,
  p_actor       uuid default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_sigma   numeric;
  v_current numeric;
  v_old     numeric;
  v_target  numeric;
begin
  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad de apertura debe ser mayor o igual a 0.';
  end if;

  v_sigma   := sgc.stock_movimientos_sigma(p_articulo_id, p_bodega_id);
  v_current := coalesce((select cantidad from sgc.stock_por_bodega
                          where articulo_id = p_articulo_id and bodega_id = p_bodega_id), 0);
  v_old     := sgc.apertura_efectiva(p_articulo_id, p_bodega_id);
  v_target  := p_cantidad + v_sigma;

  if v_target < 0 then
    raise exception 'No puedes fijar la apertura en %: el almacén ya consumió más que eso (el disponible caería a %).',
      p_cantidad, v_target;
  end if;
  if v_target = v_current
     and exists (select 1 from sgc.stock_apertura
                 where articulo_id = p_articulo_id and bodega_id = p_bodega_id
                   and cantidad = p_cantidad) then
    return;  -- sin cambio
  end if;

  insert into sgc.stock_apertura(articulo_id, bodega_id, cantidad, updated_at, updated_by)
    values (p_articulo_id, p_bodega_id, p_cantidad, now(), p_actor)
  on conflict (articulo_id, bodega_id)
    do update set cantidad = excluded.cantidad, updated_at = now(), updated_by = p_actor;

  insert into sgc.stock_por_bodega(articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, v_target, now())
  on conflict (articulo_id, bodega_id)
    do update set cantidad = v_target, updated_at = now();

  insert into sgc.auditoria(tabla, registro_id, accion, actor_id, cambios, datos_antes, datos_despues)
    values ('stock_apertura',
            p_articulo_id::text || ':' || p_bodega_id::text,
            'UPDATE', p_actor,
            jsonb_build_object('op', 'set_apertura', 'delta_stock', v_target - v_current),
            jsonb_build_object('apertura', v_old),
            jsonb_build_object('apertura', p_cantidad));
end;
$$;
grant execute on function sgc._aplicar_apertura(uuid, uuid, numeric, uuid) to service_role;

-- set_apertura (AP5) recreado: conserva gate admin + guards, delega en el núcleo.
create or replace function sgc.set_apertura(
  p_articulo_id uuid,
  p_bodega_id   uuid,
  p_cantidad    numeric
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede editar el dato de apertura.'
      using errcode = '42501';
  end if;
  perform sgc._aplicar_apertura(p_articulo_id, p_bodega_id, p_cantidad, auth.uid());
end;
$$;
grant execute on function sgc.set_apertura(uuid, uuid, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) inventario_almacen — sobrecarga con catálogo completo
-- ════════════════════════════════════════════════════════════════════════════
-- p_incluir_catalogo=true → lista TODOS los artículos (aunque no tengan fila en
-- este almacén), con cantidad 0 / apertura 0. La firma de 3 args (AP2) se conserva.
create or replace function sgc.inventario_almacen(
  p_bodega_id       uuid,
  p_incluir_cero    boolean,
  p_busqueda        text,
  p_incluir_catalogo boolean
) returns table (
  articulo_id uuid, codigo text, nombre text, categoria text, unidad text,
  propiedad text, cantidad numeric, apertura numeric, es_cero boolean, es_prueba boolean
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_ver_inventario_bodega(p_bodega_id) then
    raise exception 'No tienes acceso al inventario de este almacén.' using errcode = '42501';
  end if;
  return query
  select a.id, a.codigo::text, a.nombre::text, c.nombre::text as categoria,
         a.unidad::text, a.propiedad::text,
         coalesce(s.cantidad, 0) as cantidad,
         sgc.apertura_efectiva(a.id, p_bodega_id) as apertura,
         coalesce(s.cantidad, 0) <= 0 as es_cero,
         coalesce(a.es_prueba, false) as es_prueba
  from sgc.articulos a
  left join sgc.categorias_inventario c on c.id = a.categoria_id
  left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
  left join sgc.stock_apertura   ap on ap.articulo_id = a.id and ap.bodega_id = p_bodega_id
  where (coalesce(p_incluir_catalogo, false)
         or s.articulo_id is not null or ap.articulo_id is not null)
    and coalesce(a.activo, true)
    and (not coalesce(a.es_prueba, false) or sgc.is_admin())
    and (p_incluir_cero or coalesce(s.cantidad, 0) > 0)
    and (p_busqueda is null or p_busqueda = ''
         or a.nombre ilike '%' || p_busqueda || '%'
         or a.codigo ilike '%' || p_busqueda || '%')
  order by a.nombre;
end;
$$;
grant execute on function sgc.inventario_almacen(uuid, boolean, text, boolean) to authenticated;
comment on function sgc.inventario_almacen(uuid, boolean, text, boolean) is
  'AU6 — inventario de un almacén con opción de catálogo completo: p_incluir_catalogo=true lista TODOS los artículos activos (stock/apertura 0 para los no movidos) para poder aperturarlos.';

-- ════════════════════════════════════════════════════════════════════════════
-- (3) Preview del lote: cuántos artículos tocaría (mismo universo que set_apertura_lote)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.apertura_lote_preview(
  p_bodega_id            uuid,
  p_incluir_todo_catalogo boolean default false,
  p_solo_faltantes        boolean default true
) returns integer
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int
  from sgc.articulos a
  where coalesce(a.activo, true)
    and (not coalesce(a.es_prueba, false))
    and (
      p_incluir_todo_catalogo
      or exists (select 1 from sgc.stock_por_bodega sb
                 where sb.articulo_id = a.id and sb.bodega_id = p_bodega_id)
    )
    and (
      not p_solo_faltantes
      or not exists (select 1 from sgc.stock_apertura ap
                     where ap.articulo_id = a.id and ap.bodega_id = p_bodega_id)
    );
$$;
grant execute on function sgc.apertura_lote_preview(uuid, boolean, boolean) to authenticated, service_role;
comment on function sgc.apertura_lote_preview(uuid, boolean, boolean) is
  'AU6 — cuenta cuántos artículos tocaría set_apertura_lote con los mismos filtros, para el preview "Se dará apertura a N artículos".';

-- ════════════════════════════════════════════════════════════════════════════
-- (4) Trigger: artículo nuevo → 1,000 automático en almacenes ya aperturados
-- ════════════════════════════════════════════════════════════════════════════
-- Un almacén está "aperturado" si tiene ≥1 fila en stock_apertura. Al crear un
-- artículo (no-prueba), recibe la apertura por defecto (parámetro) en esos almacenes.
create or replace function sgc.tg_articulo_apertura_automatica()
returns trigger
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_cant numeric := coalesce((select valor from sgc.parametros
                              where clave = 'apertura_nuevos_articulos')::numeric, 0);
  rec record;
begin
  if v_cant <= 0 then return new; end if;
  if coalesce(new.es_prueba, false) then return new; end if;

  for rec in
    select distinct ap.bodega_id
      from sgc.stock_apertura ap
      join sgc.bodegas b on b.id = ap.bodega_id
     where coalesce(b.activo, true)
       and not coalesce(b.es_prueba, false)
  loop
    perform sgc._aplicar_apertura(new.id, rec.bodega_id, v_cant, auth.uid());
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_articulo_apertura_automatica on sgc.articulos;
create trigger trg_articulo_apertura_automatica
  after insert on sgc.articulos
  for each row execute function sgc.tg_articulo_apertura_automatica();

comment on function sgc.tg_articulo_apertura_automatica() is
  'AU6 — al crear un artículo (no-prueba), le da apertura por defecto (parámetro apertura_nuevos_articulos, 1000) en todos los almacenes ya aperturados. Decisión de Xaviel PROMPT-21.';
