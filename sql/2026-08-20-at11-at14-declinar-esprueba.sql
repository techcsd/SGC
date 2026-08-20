-- ============================================================================
-- AT11 — Declinar material no catalogado (→ historial) + AT14 — es_prueba en
-- "Vehículos en uso" (vehiculos_asignados). Aditivo y retrocompatible.
-- ============================================================================
set search_path = sgc, public;

-- ── AT11 — estado "declinado" para los items libres (material no catalogado) ─
-- Hoy el estado es implícito: articulo_vinculado_id null = pendiente, no-null =
-- catalogado. Falta un tercer estado: DECLINADO (no se creará el artículo).
alter table sgc.salida_items_libres add column if not exists declinado_at    timestamptz;
alter table sgc.salida_items_libres add column if not exists declinado_por    uuid references sgc.usuarios(id);
alter table sgc.salida_items_libres add column if not exists declinar_motivo  text;
-- Cuando el motivo es "ya existe", se apunta el artículo correcto (data valiosa
-- para arreglar el matching de AT7) y se puede vincular el pedido a ese artículo.
alter table sgc.salida_items_libres add column if not exists sugerido_articulo_id uuid references sgc.articulos(id);

-- Declinar un item libre (solo gestión de inventario/admin). Sale de la bandeja
-- hacia historial y se notifica al que lo reportó (si no, lo vuelve a pedir).
create or replace function sgc.declinar_item_libre(
  p_item_libre_id uuid, p_motivo text, p_sugerido_articulo_id uuid default null
) returns void
language plpgsql security definer set search_path = sgc, public as $$
declare v_row sgc.salida_items_libres%rowtype; v_art_nombre text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
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

  -- Notificar al reportante con el motivo.
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

-- Revertir un declinado hecho por error (vuelve a la bandeja como pendiente).
create or replace function sgc.revertir_declinacion_item_libre(p_item_libre_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.salida_items_libres
     set declinado_at = null, declinado_por = null, declinar_motivo = null, sugerido_articulo_id = null
   where id = p_item_libre_id and articulo_vinculado_id is null;
end;
$$;
grant execute on function sgc.revertir_declinacion_item_libre(uuid) to authenticated, service_role;

-- Recrear listado + count para EXCLUIR declinados de "pendientes" y exponer el
-- estado declinado en el histórico (incluir_resueltos trae catalogados + declinados).
-- (DROP porque cambia el tipo de retorno — se añaden columnas de declinación.)
drop function if exists sgc.material_no_catalogado_pendientes(boolean);
create or replace function sgc.material_no_catalogado_pendientes(p_incluir_resueltos boolean default false)
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
   where (sgc.is_admin() or sgc.tiene_modulo('inventario'))
     and ((not il.es_prueba) or sgc.is_admin())
     and (
       p_incluir_resueltos
       or (il.articulo_vinculado_id is null and il.declinado_at is null)  -- solo pendientes reales
     )
   order by il.created_at desc;
$$;
grant execute on function sgc.material_no_catalogado_pendientes(boolean) to authenticated, service_role;

create or replace function sgc.material_no_catalogado_pendientes_count()
returns int language sql stable security definer set search_path = sgc, public as $$
  select count(*)::int from sgc.salida_items_libres il
   where (sgc.is_admin() or sgc.tiene_modulo('inventario'))
     and ((not il.es_prueba) or sgc.is_admin())
     and il.articulo_vinculado_id is null
     and il.declinado_at is null;   -- AT11: los declinados no cuentan como pendientes
$$;
grant execute on function sgc.material_no_catalogado_pendientes_count() to authenticated, service_role;

-- ── AT14 — "Vehículos en uso": ocultar el "En uso por X" de vehículos de prueba
-- a los no-admin (era la única fuente "en uso" sin filtro de es_prueba). ─────
create or replace function sgc.vehiculos_asignados()
returns table(vehiculo_id uuid, usuario_id uuid, nombre text, motivo text)
language sql stable security definer
set search_path to 'sgc','pg_temp' as $$
  select e.vehiculo_id, e.conductor_usuario_id, u.nombre, 'custodia'::text
    from sgc.vehiculo_entregas e
    join sgc.usuarios u on u.id = e.conductor_usuario_id
    join sgc.vehiculos v on v.id = e.vehiculo_id
   where e.tipo = 'recepcion' and e.estado = 'abierta'
     and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
  union
  select va.vehiculo_id, va.usuario_id, u.nombre, 'asignacion'::text
    from sgc.vehiculo_asignaciones va
    join sgc.usuarios u on u.id = va.usuario_id
    join sgc.vehiculos v on v.id = va.vehiculo_id
   where va.activa
     and ((not coalesce(v.es_prueba, false)) or sgc.is_admin());
$$;
grant execute on function sgc.vehiculos_asignados() to authenticated, service_role;
