-- CY24 Fase B -- 2 ajustes pequeños sobre lo ya aplicado (migración nueva,
-- no se reescribe la ya pusheada, CD10):
-- 1. resolver_solicitud_producto: cuando la decisión es 'creado', marca el
--    articulo resultante con origen='odoo' (D-10, articulo-sombra) -- antes
--    no lo hacía, dejaba origen en su default 'sgc' aunque viniera de esta
--    bandeja.
-- 2. RPC nueva crear_solicitud_producto_odoo: alta de una solicitud desde la
--    pantalla, con el paso anti-duplicado "ya busqué y no existe" (criterio 7
--    de CY24 -- exige p_busqueda_previa no vacío, no basta "no lo encontré").
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

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

  if v_solicitud.orden_item_id is not null and p_decision in ('creado', 'vinculado_existente') then
    update sgc.orden_compra_items set articulo_id = p_articulo_id where id = v_solicitud.orden_item_id;
  end if;

  -- CY7 D-10: un articulo creado DESDE esta bandeja es, por definicion, un
  -- puente hacia un producto de Odoo -- se marca como tal.
  if p_decision = 'creado' then
    update sgc.articulos set origen = 'odoo' where id = p_articulo_id;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'articulo_id', p_articulo_id);
end;
$fn$;
comment on function sgc.resolver_solicitud_producto is 'SGC Odoo foundation v1 (CY24 Fase B) -- resuelve una solicitud de alta de producto; el solicitante nunca resuelve lo suyo; "creado" marca origen=odoo.';

create or replace function sgc.crear_solicitud_producto_odoo(
  p_descripcion_libre text, p_busqueda_previa text, p_orden_id uuid default null, p_orden_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(btrim(coalesce(p_descripcion_libre, '')), '') is null then
    raise exception 'La descripción del material es obligatoria';
  end if;
  -- Criterio 7 de CY24: "Solicitar alta" exige haber buscado antes -- no basta
  -- "no lo encontré" sin haber escrito qué se buscó.
  if nullif(btrim(coalesce(p_busqueda_previa, '')), '') is null then
    raise exception 'Escribe qué buscaste antes de pedir el alta (para que Compras no repita la búsqueda)';
  end if;

  insert into sgc.odoo_producto_solicitudes (orden_id, orden_item_id, descripcion_libre, busqueda_previa, solicitado_por)
    values (p_orden_id, p_orden_item_id, btrim(p_descripcion_libre), btrim(p_busqueda_previa), v_uid)
    returning id into v_id;

  return v_id;
end;
$fn$;
comment on function sgc.crear_solicitud_producto_odoo is 'SGC Odoo foundation v1 (CY24 Fase B) -- alta de una solicitud de producto, exige busqueda previa (criterio 7).';
revoke all on function sgc.crear_solicitud_producto_odoo(text, text, uuid, uuid) from public, anon;
grant execute on function sgc.crear_solicitud_producto_odoo(text, text, uuid, uuid) to authenticated, service_role;

-- RPC de conteo para el badge del menu/dashboard (regla 1) -- respeta la MISMA
-- RLS que la tabla (admin/compras ven todo, los demas solo lo suyo).
create or replace function sgc.productos_por_dar_de_alta_count()
returns integer
language sql
security invoker
stable
set search_path to 'sgc', 'pg_temp'
as $fn$
  select count(*)::integer from sgc.odoo_producto_solicitudes where estado = 'pendiente';
$fn$;
comment on function sgc.productos_por_dar_de_alta_count is 'CY24 Fase B -- conteo para el badge del menu. SECURITY INVOKER a proposito: respeta la RLS real de quien pregunta.';
grant execute on function sgc.productos_por_dar_de_alta_count() to authenticated;

commit;
