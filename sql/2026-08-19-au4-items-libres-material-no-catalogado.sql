-- ============================================================================
-- PROMPT-21 (AU) — FASE 3 — Items libres: material NO catalogado en el conduce
--   (AU4). SGC padre. Aditivo / retrocompatible. Migración fechada.
-- ----------------------------------------------------------------------------
-- Contexto (CONTEXTO-ACTUALIZACION-10.md, AU4):
--   Los choferes a veces mueven material que NO existe en el inventario. Hoy no
--   pueden hacer el conduce. Solución (estilo "Otros"): escriben el material como
--   NOTA en el conduce (item libre: nombre + cantidad + unidad de texto). El item
--   libre NO toca stock (no hay artículo) pero SÍ viaja en el conduce/PDF/
--   confirmación. Al admin le llega una ALERTA para crear ese artículo; al crearlo
--   se VINCULA el item libre al artículo nuevo (vínculo simple, sin stock
--   retroactivo — decisión de Xaviel: el item libre nunca movió stock; el artículo,
--   una vez creado, entra al flujo normal hacia adelante).
--
-- Modelo: una sola tabla sgc.salida_items_libres. La "bandeja de alertas" = items
-- libres pendientes de vínculo (articulo_vinculado_id is null). AT11: todo item
-- libre es visible en la bandeja para depurar el catálogo.
-- ============================================================================

set search_path = sgc, public;

-- ════════════════════════════════════════════════════════════════════════════
-- Tabla: items libres del conduce
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists sgc.salida_items_libres (
  id                    uuid primary key default gen_random_uuid(),
  salida_id             uuid not null references sgc.salidas_inventario(id) on delete cascade,
  nombre                text not null,
  cantidad              numeric not null default 1 check (cantidad > 0),
  unidad                text,
  articulo_vinculado_id uuid references sgc.articulos(id) on delete set null,
  es_prueba             boolean not null default false,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  vinculado_at          timestamptz,
  vinculado_por         uuid
);

comment on table sgc.salida_items_libres is
  'AU4 — material NO catalogado escrito como nota en un conduce (nombre+cantidad+unidad). No toca stock. articulo_vinculado_id se llena cuando el admin crea/vincula el artículo real.';

create index if not exists idx_salida_items_libres_salida on sgc.salida_items_libres(salida_id);
create index if not exists idx_salida_items_libres_pend on sgc.salida_items_libres(created_at desc)
  where articulo_vinculado_id is null;

alter table sgc.salida_items_libres enable row level security;

drop policy if exists "salida_items_libres: read auth" on sgc.salida_items_libres;
create policy "salida_items_libres: read auth" on sgc.salida_items_libres
  for select to authenticated using (auth.uid() is not null);
-- Escritura sólo por RPCs SECURITY DEFINER (owner bypassa RLS). Sin policies de write.

grant select on sgc.salida_items_libres to authenticated;
grant select, insert, update on sgc.salida_items_libres to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Adjuntar items libres a un conduce + alerta al admin/inventario
-- ════════════════════════════════════════════════════════════════════════════
-- p_items: [{nombre, cantidad, unidad}]. Lo llaman web/app al crear (o editar) el
-- conduce. Sólo el creador del conduce, el chofer asignado, o admin/inventario/flota.
create or replace function sgc.agregar_items_libres_conduce(
  p_salida_id uuid,
  p_items     jsonb
) returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  it jsonb; v_n int := 0; v_nombre text; v_cant numeric; v_unidad text;
  v_num text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or v_s.creado_por = v_uid
          or exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = v_uid)) then
    raise exception 'No autorizado para agregar materiales a este conduce.';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_nombre := nullif(trim(coalesce(it->>'nombre','')),'');
    if v_nombre is null then continue; end if;
    v_cant   := coalesce(nullif(it->>'cantidad','')::numeric, 1);
    if v_cant <= 0 then v_cant := 1; end if;
    v_unidad := nullif(trim(coalesce(it->>'unidad','')),'');

    insert into sgc.salida_items_libres (salida_id, nombre, cantidad, unidad, es_prueba, created_by)
    values (p_salida_id, v_nombre, v_cant, v_unidad, coalesce(v_s.es_prueba, false), v_uid);
    v_n := v_n + 1;
  end loop;

  -- Alerta al admin/inventario (regla AT11): "Material no catalogado en conduce #X".
  if v_n > 0 and not coalesce(v_s.es_prueba, false) then
    v_num := 'CND-' || upper(left(p_salida_id::text, 8));
    perform sgc.notificar_modulo(
      'inventario', 'material_no_catalogado',
      'Material no catalogado en un conduce',
      'El conduce '||v_num||' incluye '||v_n||' material(es) que no están en el catálogo. Revísalos y crea el artículo.',
      '/inventario/material-no-catalogado');
  end if;

  return v_n;
end;
$$;
grant execute on function sgc.agregar_items_libres_conduce(uuid, jsonb) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Bandeja: items libres pendientes (o todos) para depurar el catálogo
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.material_no_catalogado_pendientes(p_incluir_resueltos boolean default false)
returns table (
  id uuid, salida_id uuid, conduce_numero text, nombre text, cantidad numeric,
  unidad text, articulo_vinculado_id uuid, articulo_vinculado text,
  reportado_por text, proyecto text, created_at timestamptz, vinculado_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select il.id, il.salida_id,
         'CND-' || upper(left(il.salida_id::text, 8)) as conduce_numero,
         il.nombre, il.cantidad, il.unidad,
         il.articulo_vinculado_id, a.nombre as articulo_vinculado,
         u.nombre as reportado_por,
         p.nombre as proyecto,
         il.created_at, il.vinculado_at
  from sgc.salida_items_libres il
  left join sgc.salidas_inventario s on s.id = il.salida_id
  left join sgc.articulos a on a.id = il.articulo_vinculado_id
  left join sgc.usuarios  u on u.id = il.created_by
  left join sgc.proyectos p on p.id = s.proyecto_id
  where (sgc.is_admin() or sgc.tiene_modulo('inventario'))
    and (coalesce(p_incluir_resueltos, false) or il.articulo_vinculado_id is null)
    and (not coalesce(il.es_prueba, false) or sgc.is_admin())
  order by il.created_at desc;
$$;
grant execute on function sgc.material_no_catalogado_pendientes(boolean) to authenticated, service_role;

create or replace function sgc.material_no_catalogado_pendientes_count()
returns integer language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int
  from sgc.salida_items_libres il
  where (sgc.is_admin() or sgc.tiene_modulo('inventario'))
    and il.articulo_vinculado_id is null
    and (not coalesce(il.es_prueba, false) or sgc.is_admin());
$$;
grant execute on function sgc.material_no_catalogado_pendientes_count() to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Vincular un item libre a un artículo (real). Vínculo simple, sin stock retroactivo.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.vincular_item_libre_articulo(
  p_item_libre_id uuid,
  p_articulo_id   uuid
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.articulos where id = p_articulo_id) then
    raise exception 'Artículo no encontrado.';
  end if;
  update sgc.salida_items_libres
     set articulo_vinculado_id = p_articulo_id,
         vinculado_at = now(),
         vinculado_por = auth.uid()
   where id = p_item_libre_id;
  if not found then raise exception 'Item libre no encontrado.'; end if;
end;
$$;
grant execute on function sgc.vincular_item_libre_articulo(uuid, uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- conduce_detalle_app: incluir items_libres (viajan en la vista / PDF / confirmación)
-- ════════════════════════════════════════════════════════════════════════════
-- Recrea AS3 conservando todo su cuerpo y añadiendo el bloque items_libres.
create or replace function sgc.conduce_detalle_app(p_salida_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_out jsonb;
  v_puede boolean;
  v_fase text;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  v_puede := sgc.is_admin()
    or v_s.creado_por = auth.uid()
    or v_s.entregado_por = auth.uid()
    or v_s.recibido_por = auth.uid()
    or v_s.despachante_usuario_id = auth.uid()
    or exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = auth.uid())
    or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_puede then
    raise exception 'No autorizado para ver este conduce.';
  end if;

  v_fase := sgc.conduce_fase(v_s.id);

  select jsonb_build_object(
    'id', v_s.id,
    'numero', 'CND-' || upper(left(v_s.id::text, 8)),
    'fecha', v_s.fecha,
    'created_at', v_s.created_at,
    'estado', v_s.estado,
    'estado_label', sgc.label_estado_salida(v_s.estado),
    'fase', v_fase,
    'fase_label', sgc.label_fase_conduce(v_fase),
    'motivo', v_s.motivo,
    'motivo_label', sgc.label_motivo_salida(v_s.motivo),
    'responsable', v_s.responsable,
    'observaciones', v_s.observaciones,
    'proyecto_id', v_s.proyecto_id,
    'proyecto', (select nombre from sgc.proyectos where id = v_s.proyecto_id),
    'bodega_id', v_s.bodega_id,
    'bodega', (select nombre from sgc.bodegas where id = v_s.bodega_id),
    'destino_almacen_id', v_s.destino_almacen_id,
    'destino_almacen', (select nombre from sgc.bodegas where id = v_s.destino_almacen_id),
    'conductor_id', v_s.conductor_id,
    'conductor', (select u.nombre from sgc.conductores c
                    left join sgc.usuarios u on u.id = c.usuario_id
                  where c.id = v_s.conductor_id),
    'despachante', coalesce(
        nullif(v_s.despachante_nombre,''),
        (select nombre from sgc.usuarios  where id = v_s.despachante_usuario_id),
        (select nombre from sgc.empleados where id = v_s.despachante_empleado_id)),
    'despachante_usuario_id', v_s.despachante_usuario_id,
    'despachante_empleado_id', v_s.despachante_empleado_id,
    'carga_foto_path', v_s.carga_foto_path,
    'firma_despachante_pendiente', sgc.conduce_firma_despachante_pendiente(v_s.id),
    'creado_por', v_s.creado_por,
    'creado_por_nombre', (select nombre from sgc.usuarios where id = v_s.creado_por),
    'entregado_por', v_s.entregado_por,
    'entregado_por_nombre', (select nombre from sgc.usuarios where id = v_s.entregado_por),
    'entregado_en', v_s.entregado_en,
    'entrega_foto_path', v_s.entrega_foto_path,
    'entrega_receptor', v_s.entrega_receptor,
    'entrega_firma_path', v_s.entrega_firma_path,
    'firma_path', v_s.firma_path,
    'firma_pendiente_nombre', v_s.firma_pendiente_nombre,
    'recibido_por', v_s.recibido_por,
    'recibido_por_nombre', (select nombre from sgc.usuarios where id = v_s.recibido_por),
    'recibido_en', v_s.recibido_en,
    'recepcion_foto_path', v_s.recepcion_foto_path,
    'notas_recepcion', v_s.notas_recepcion,
    'ruta_id', v_s.ruta_id,
    'es_prueba', coalesce(v_s.es_prueba, false),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'detalle_id', d.id,
                'articulo_id', d.articulo_id,
                'articulo', a.nombre,
                'codigo', a.codigo,
                'unidad', a.unidad,
                'propiedad', a.propiedad,
                'cantidad', d.cantidad,
                'cantidad_recibida', d.cantidad_recibida)
                order by a.nombre)
              from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
              where d.salida_id = v_s.id), '[]'::jsonb),
    -- AU4 — items libres (material no catalogado) que viajan en el conduce.
    'items_libres', coalesce((select jsonb_agg(jsonb_build_object(
                'id', il.id,
                'nombre', il.nombre,
                'cantidad', il.cantidad,
                'unidad', il.unidad,
                'articulo_vinculado_id', il.articulo_vinculado_id)
                order by il.created_at)
              from sgc.salida_items_libres il where il.salida_id = v_s.id), '[]'::jsonb),
    'firmas', coalesce((select jsonb_agg(jsonb_build_object(
                'rol', sf.rol, 'nombre', sf.nombre, 'firma_path', sf.firma_path, 'firmado_en', sf.firmado_en))
               from sgc.salida_firmas sf where sf.salida_id = v_s.id), '[]'::jsonb),
    'transferencias', coalesce((select jsonb_agg(jsonb_build_object(
                'id', t.id, 'estado', t.estado, 'fase_al_transferir', t.fase_al_transferir,
                'de', (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.de_conductor_id),
                'a',  (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.a_conductor_id),
                'ofrecida_en', t.ofrecida_en, 'resuelta_en', t.resuelta_en)
                order by t.ofrecida_en)
               from sgc.conduce_transferencias t where t.salida_id = v_s.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
grant execute on function sgc.conduce_detalle_app(uuid) to authenticated, service_role;

comment on function sgc.conduce_detalle_app(uuid) is
  'AL9/AL13/AL4/AO4/AS3/AU4 — contrato ÚNICO del conduce (vista/PDF). Incluye despachante, labels, firma_despachante_pendiente, items catalogados e items_libres (material no catalogado).';
