-- ════════════════════════════════════════════════════════════════════════════
-- AY5 — Almacenes duplicados: detección (fuzzy) + aviso al crear + fusión (admin)
-- ════════════════════════════════════════════════════════════════════════════
-- Aditivo/retrocompatible. Usa pg_trgm/unaccent (AW6). NO fusiona nada solo: la
-- lista se le presenta a Xaviel ANTES de fusionar (⏸). La fusión mueve stock,
-- movimientos y aperturas al canónico, desactiva el duplicado y audita.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = sgc, public;

-- ── Candidatos a duplicado: pares de bodegas, misma obra, nombre similar ─────
create or replace function sgc.almacenes_duplicados_candidatos(p_umbral numeric default 0.45)
returns table (
  a_id uuid, a_nombre text, b_id uuid, b_nombre text,
  proyecto_id uuid, proyecto text, similitud numeric,
  a_stock_items int, b_stock_items int, a_movimientos int, b_movimientos int,
  a_activa boolean, b_activa boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp', 'extensions'
as $$
  select a.id, a.nombre, b.id, b.nombre,
         a.proyecto_id, p.nombre as proyecto,
         round(similarity(sgc.f_unaccent(lower(a.nombre)), sgc.f_unaccent(lower(b.nombre)))::numeric, 2) as similitud,
         (select count(*)::int from sgc.stock_por_bodega s where s.bodega_id = a.id and s.cantidad <> 0),
         (select count(*)::int from sgc.stock_por_bodega s where s.bodega_id = b.id and s.cantidad <> 0),
         (select count(*)::int from sgc.salidas_inventario si where si.bodega_id = a.id)
           + (select count(*)::int from sgc.entradas_inventario ei where ei.bodega_id = a.id),
         (select count(*)::int from sgc.salidas_inventario si where si.bodega_id = b.id)
           + (select count(*)::int from sgc.entradas_inventario ei where ei.bodega_id = b.id),
         a.activo, b.activo
  from sgc.bodegas a
  join sgc.bodegas b
    on b.id > a.id
   and coalesce(a.proyecto_id::text,'∅') = coalesce(b.proyecto_id::text,'∅')
  left join sgc.proyectos p on p.id = a.proyecto_id
  where sgc.is_admin()
    and similarity(sgc.f_unaccent(lower(a.nombre)), sgc.f_unaccent(lower(b.nombre))) >= coalesce(p_umbral, 0.45)
  order by similitud desc, p.nombre nulls last;
$$;
grant execute on function sgc.almacenes_duplicados_candidatos(numeric) to authenticated, service_role;

-- ── Aviso preventivo: almacenes parecidos al crear (misma obra) ──────────────
create or replace function sgc.almacenes_similares(p_nombre text, p_proyecto_id uuid default null)
returns table (id uuid, nombre text, similitud numeric)
language sql stable security definer
set search_path to 'sgc', 'pg_temp', 'extensions'
as $$
  select b.id, b.nombre,
         round(similarity(sgc.f_unaccent(lower(b.nombre)), sgc.f_unaccent(lower(coalesce(p_nombre,''))))::numeric, 2)
  from sgc.bodegas b
  where b.activo
    and coalesce(b.proyecto_id::text,'∅') = coalesce(p_proyecto_id::text,'∅')
    and nullif(trim(coalesce(p_nombre,'')),'') is not null
    and similarity(sgc.f_unaccent(lower(b.nombre)), sgc.f_unaccent(lower(p_nombre))) >= 0.4
  order by 3 desc
  limit 5;
$$;
grant execute on function sgc.almacenes_similares(text, uuid) to authenticated, service_role;

-- ── Fusión de almacenes (SOLO admin, auditada) ⏸ usar tras revisar la lista ──
-- Mueve stock/aperturas/movimientos del duplicado al canónico, desactiva el
-- duplicado y deja traza. Reversible con cuidado (auditoría guarda el mapeo).
create or replace function sgc.fusionar_almacenes(p_canonico uuid, p_duplicado uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_can sgc.bodegas%rowtype; v_dup sgc.bodegas%rowtype;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede fusionar almacenes.' using errcode='42501'; end if;
  if p_canonico = p_duplicado then raise exception 'El canónico y el duplicado no pueden ser el mismo.'; end if;
  select * into v_can from sgc.bodegas where id = p_canonico;
  if not found then raise exception 'Almacén canónico no encontrado.'; end if;
  select * into v_dup from sgc.bodegas where id = p_duplicado;
  if not found then raise exception 'Almacén duplicado no encontrado.'; end if;

  -- stock_por_bodega: mover lo que no colisiona; sumar lo que sí; borrar duplicado.
  update sgc.stock_por_bodega d set bodega_id = p_canonico, updated_at = now()
   where d.bodega_id = p_duplicado
     and not exists (select 1 from sgc.stock_por_bodega c where c.bodega_id = p_canonico and c.articulo_id = d.articulo_id);
  update sgc.stock_por_bodega c
     set cantidad = c.cantidad + d.cantidad, updated_at = now()
    from sgc.stock_por_bodega d
   where c.bodega_id = p_canonico and d.bodega_id = p_duplicado and c.articulo_id = d.articulo_id;
  delete from sgc.stock_por_bodega where bodega_id = p_duplicado;

  -- stock_apertura: misma estrategia.
  update sgc.stock_apertura d set bodega_id = p_canonico, updated_at = now()
   where d.bodega_id = p_duplicado
     and not exists (select 1 from sgc.stock_apertura c where c.bodega_id = p_canonico and c.articulo_id = d.articulo_id);
  update sgc.stock_apertura c
     set cantidad = c.cantidad + d.cantidad, updated_at = now()
    from sgc.stock_apertura d
   where c.bodega_id = p_canonico and d.bodega_id = p_duplicado and c.articulo_id = d.articulo_id;
  delete from sgc.stock_apertura where bodega_id = p_duplicado;

  -- Movimientos: reapuntar al canónico (origen y destino-almacén).
  update sgc.salidas_inventario  set bodega_id = p_canonico where bodega_id = p_duplicado;
  update sgc.salidas_inventario  set destino_almacen_id = p_canonico where destino_almacen_id = p_duplicado;
  update sgc.entradas_inventario set bodega_id = p_canonico where bodega_id = p_duplicado;

  -- Desactivar el duplicado (no se borra: se conserva para trazabilidad).
  update sgc.bodegas set activo = false, nombre = nombre || ' (fusionado)' where id = p_duplicado;

  begin
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, datos_despues)
    values ('bodegas', p_duplicado, 'fusion_almacen', auth.uid(),
            jsonb_build_object('canonico', p_canonico, 'duplicado', p_duplicado,
                               'canonico_nombre', v_can.nombre, 'duplicado_nombre', v_dup.nombre));
  exception when others then null;
  end;
end $$;
grant execute on function sgc.fusionar_almacenes(uuid, uuid) to authenticated, service_role;

comment on function sgc.fusionar_almacenes(uuid, uuid) is
  'AY5 — fusiona el almacén duplicado en el canónico (stock/aperturas/movimientos), desactiva el duplicado y audita. Solo admin. ⏸ ejecutar tras revisar la lista de candidatos con Xaviel.';
