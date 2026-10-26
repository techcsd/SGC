-- CY24 Fase A [feature: OC con productos desde Odoo, piloto] -- base + lectura
-- de compras. Sigue la issue #24 al pie de la letra (D1-D7, E1-E10).
--
-- Columnas de SYNC (distintas de las de identidad que ya trajo F5 --
-- odoo_id/odoo_instancia_id/etc en ordenes_compra ya existen y significan
-- "esta OC ES esa purchase.order"; las de aqui son el ESTADO de esa relacion,
-- no la identidad):
--   odoo_sync_estado: donde va el ciclo de publicacion (pendiente/publicada/
--     confirmada/cancelada/error/conflicto) -- NO es un estado de Odoo, es el
--     semaforo de SGC sobre si/como se publico.
--   odoo_state: el ultimo estado de Odoo tal cual LO DIJO Odoo (texto libre,
--     no se valida contra un catalogo -- Odoo puede agregar estados).
--   odoo_nombre/odoo_total: snapshot de 2 campos visibles de Odoo para no
--     tener que volver a consultar solo para mostrarlos en la lista.
--   odoo_sync_error: ultimo error SIN jerga (BS2) -- el detalle tecnico vive
--     en el log del servidor, no aqui.
--
-- articulos.origen: 'sgc' (default, creado en SGC) vs 'odoo' (articulo-sombra
-- creado para representar un producto que existe en Odoo pero no en SGC --
-- D-10 del contexto, puente transitorio hasta migrar recepciones). Columna
-- NUEVA con DEFAULT: no rompe ningun INSERT existente (ya se verifico en F5
-- que el patron "agregar columna nullable/con default" no afecta
-- SELECT */INSERT sin lista de columnas de este proyecto).
--
-- sgc.odoo_producto_solicitudes: cuando una linea de OC no tiene producto en
-- Odoo, se registra aqui una solicitud de alta en vez de publicar con texto
-- libre (D-11: prohibido en el alcance piloto). Resuelta por Compras
-- (D-09: el solicitante no resuelve lo suyo).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $preflight$
begin
  if to_regclass('sgc.ordenes_compra') is null or to_regclass('sgc.orden_compra_items') is null then
    raise exception 'Faltan sgc.ordenes_compra/orden_compra_items';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='sgc' and table_name='ordenes_compra' and column_name='odoo_sync_estado') then
    raise exception 'ordenes_compra.odoo_sync_estado ya existe -- revisar antes de reaplicar';
  end if;
end;
$preflight$;

alter table sgc.ordenes_compra
  add column odoo_sync_estado text check (odoo_sync_estado in ('pendiente', 'publicada', 'confirmada', 'cancelada', 'error', 'conflicto')),
  add column odoo_state text,
  add column odoo_nombre text,
  add column odoo_total numeric,
  add column odoo_sync_error text;
comment on column sgc.ordenes_compra.odoo_sync_estado is 'CY24 -- semaforo SGC del ciclo de publicacion. NULL = nunca se intento publicar (comportamiento actual, flag apagado por defecto).';

alter table sgc.orden_compra_items
  add column odoo_product_id bigint check (odoo_product_id is null or odoo_product_id > 0),
  add column odoo_uom_id bigint check (odoo_uom_id is null or odoo_uom_id > 0),
  add column odoo_snapshot jsonb;
comment on column sgc.orden_compra_items.odoo_snapshot is 'CY24 -- copia de lo que devolvio productos.obtener al elegir el producto (AT11: todo lo enviado debe poder verse).';

alter table sgc.articulos
  add column origen text not null default 'sgc' check (origen in ('sgc', 'odoo'));
comment on column sgc.articulos.origen is 'CY24/CY7 D-10 -- sgc: creado en SGC (todo lo existente hasta hoy). odoo: articulo-sombra creado para representar un producto de Odoo sin equivalente SGC -- puente transitorio.';

create table sgc.odoo_producto_solicitudes (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references sgc.ordenes_compra(id) on delete set null,
  orden_item_id uuid references sgc.orden_compra_items(id) on delete set null,
  descripcion_libre text not null check (length(btrim(descripcion_libre)) > 0),
  busqueda_previa text, -- lo que el solicitante escribio al "buscar y no encontrar" (exige busqueda previa, criterio 7 de CY24)
  estado text not null default 'pendiente' check (estado in ('pendiente', 'creado', 'vinculado_existente', 'rechazado')),
  articulo_resultante_id uuid references sgc.articulos(id), -- el articulo-sombra creado, o el existente al que se vinculo
  solicitado_por uuid not null references auth.users(id),
  solicitado_en timestamptz not null default now(),
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz,
  motivo_resolucion text,
  es_prueba boolean not null default false,

  constraint odoo_producto_solicitudes_resolutor_distinto check (resuelto_por is null or resuelto_por <> solicitado_por)
);
comment on table sgc.odoo_producto_solicitudes is 'CY24 Fase B -- bandeja "Productos por dar de alta en Odoo". El solicitante NUNCA resuelve lo suyo (D-09).';
create index odoo_producto_solicitudes_pendientes on sgc.odoo_producto_solicitudes (estado, solicitado_en) where estado = 'pendiente';
alter table sgc.odoo_producto_solicitudes enable row level security;

create policy odoo_producto_solicitudes_select on sgc.odoo_producto_solicitudes
  for select to authenticated
  using (solicitado_por = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy odoo_producto_solicitudes_insert on sgc.odoo_producto_solicitudes
  for insert to authenticated
  with check (solicitado_por = auth.uid());

grant select, insert on sgc.odoo_producto_solicitudes to authenticated;
grant select, insert, update on sgc.odoo_producto_solicitudes to service_role;

-- ── RPC: registrar el resultado de PUBLICAR una OC (Fase C la invoca; aqui
-- solo se prepara el "donde se guarda", Fase A no publica nada) ───────────
create or replace function sgc.registrar_publicacion_oc(
  p_orden_id uuid, p_odoo_sync_estado text, p_odoo_state text default null,
  p_odoo_nombre text default null, p_odoo_total numeric default null, p_odoo_sync_error text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras o service_role puede registrar el resultado de una publicacion' using errcode = '42501';
  end if;
  if p_odoo_sync_estado not in ('pendiente', 'publicada', 'confirmada', 'cancelada', 'error', 'conflicto') then
    raise exception 'p_odoo_sync_estado invalido: %', p_odoo_sync_estado;
  end if;
  update sgc.ordenes_compra
     set odoo_sync_estado = p_odoo_sync_estado,
         odoo_state = coalesce(p_odoo_state, odoo_state),
         odoo_nombre = coalesce(p_odoo_nombre, odoo_nombre),
         odoo_total = coalesce(p_odoo_total, odoo_total),
         odoo_sync_error = p_odoo_sync_error -- se pisa siempre: null = "sin error" explicito
   where id = p_orden_id;
  return found;
end;
$fn$;
comment on function sgc.registrar_publicacion_oc is 'SGC Odoo foundation v1 (CY24 Fase A) -- NO publica en Odoo, solo registra el resultado de una publicacion ya hecha (Fase C).';
revoke all on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text) from public, anon;
grant execute on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text) to authenticated, service_role;

-- ── RPC: resolver una solicitud de alta de producto (D-09: el solicitante no
-- resuelve lo suyo) ───────────────────────────────────────────────────────
create or replace function sgc.resolver_solicitud_producto(
  p_solicitud_id uuid, p_decision text, p_articulo_id uuid default null, p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_solicitud sgc.odoo_producto_solicitudes;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'Solo Compras puede resolver solicitudes de alta de producto' using errcode = '42501';
  end if;
  if p_decision not in ('creado', 'vinculado_existente', 'rechazado') then
    raise exception 'p_decision invalida: %', p_decision;
  end if;

  select * into v_solicitud from sgc.odoo_producto_solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_solicitud.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'motivo', format('la solicitud ya estaba %s', v_solicitud.estado));
  end if;
  if v_solicitud.solicitado_por = auth.uid() then
    raise exception 'No puedes resolver tu propia solicitud (D-9)' using errcode = '42501';
  end if;
  if p_decision in ('creado', 'vinculado_existente') and p_articulo_id is null then
    raise exception 'p_articulo_id es obligatorio para % ', p_decision;
  end if;

  update sgc.odoo_producto_solicitudes
     set estado = p_decision, articulo_resultante_id = p_articulo_id,
         resuelto_por = auth.uid(), resuelto_en = now(), motivo_resolucion = p_motivo
   where id = p_solicitud_id;

  -- Re-vincula automaticamente la linea de OC de origen, si la solicitud vino de una.
  if v_solicitud.orden_item_id is not null and p_decision in ('creado', 'vinculado_existente') then
    update sgc.orden_compra_items set articulo_id = p_articulo_id where id = v_solicitud.orden_item_id;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'articulo_id', p_articulo_id);
end;
$fn$;
comment on function sgc.resolver_solicitud_producto is 'SGC Odoo foundation v1 (CY24 Fase B) -- resuelve una solicitud de alta de producto; el solicitante nunca resuelve lo suyo.';
revoke all on function sgc.resolver_solicitud_producto(uuid, text, uuid, text) from public, anon;
grant execute on function sgc.resolver_solicitud_producto(uuid, text, uuid, text) to authenticated, service_role;

commit;
