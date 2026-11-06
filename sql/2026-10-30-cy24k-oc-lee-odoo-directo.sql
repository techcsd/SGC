-- CY24k [feature #24] -- Fase C: SGC LEE el estado de la OC directo de Odoo (no lo espeja).
--
-- Decisión del dueño: odoo_sync_estado (y odoo_state/odoo_nombre/odoo_total/odoo_sync_error) NO
-- deben existir. SGC guarda solo el VÍNCULO (odoo_instancia_id + odoo_id); estado, número, total,
-- aprobación y recepción se leen de Odoo en vivo (acciones compras.obtener / compras.obtener_varias).
-- Un fallo ya no se persiste en la OC: se muestra al usuario y se reintenta (idempotente por
-- `origin` en Odoo; el comando en odoo_comandos_oc queda como bitácora/lock de concurrencia).
--   1. odoo_comandos_oc.estado pierde 'incierto' (filas existentes -> 'error'); un comando 'error'
--      se reabre, y uno 'pendiente' huérfano (> 2 min) también.
--   2. registrar_publicacion_oc se reemplaza por vincular_oc_odoo (solo fija el vínculo, una vez).
--   3. oc_para_publicar / oc_para_comando / mi_solicitud_compra_odoo_estado dejan de leer el espejo.
--   4. Se eliminan las 5 columnas espejo de ordenes_compra.
-- Archivo nuevo a propósito (CD10 / regla 19). Dev primero (BU1).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
set local search_path = sgc, public;

do $preflight$
begin
  -- Si hubiera filas con estado espejo pero SIN vínculo, se perdería su rastro: abortar y revisar.
  if exists (select 1 from sgc.ordenes_compra where odoo_sync_estado is not null and odoo_id is null) then
    raise exception 'Hay OC con odoo_sync_estado pero sin odoo_id -- revisar antes de eliminar el espejo';
  end if;
end;
$preflight$;

do $mig$
declare
  v_con text;
begin
  -- comandos
  select c.conname into v_con from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'sgc.odoo_comandos_oc'::regclass and c.contype = 'c' and a.attname = 'estado';
  if v_con is null then raise exception 'No existe el check de odoo_comandos_oc.estado -- aplicar antes cy24g'; end if;
  execute format('alter table sgc.odoo_comandos_oc drop constraint %I', v_con);
  update sgc.odoo_comandos_oc set estado = 'error', error = coalesce(error, 'Sin respuesta de Odoo; reintentar.') where estado = 'incierto';
  alter table sgc.odoo_comandos_oc
    add constraint odoo_comandos_oc_estado_check check (estado in ('pendiente', 'completado', 'error'));

end;
$mig$;

create or replace function sgc.oc_comando_finalizar(
  p_comando_id uuid, p_estado text, p_resultado jsonb default null, p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_estado not in ('completado', 'error') then
    raise exception 'p_estado invalido: %', p_estado;
  end if;
  update sgc.odoo_comandos_oc
     set estado = p_estado, resultado = p_resultado, error = p_error, finalizado_en = now()
   where id = p_comando_id;
  return found;
end;
$fn$;

create or replace function sgc.oc_comando_registrar_inicio(
  p_odoo_instancia_id uuid, p_orden_id uuid, p_accion text, p_revision integer,
  p_creado_por uuid, p_es_prueba boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_existente sgc.odoo_comandos_oc;
  v_comando_id uuid;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras puede publicar una orden de compra en Odoo' using errcode = '42501';
  end if;
  if p_accion not in ('crear', 'confirmar', 'cancelar') then
    raise exception 'accion invalida: %', p_accion;
  end if;

  select * into v_existente from sgc.odoo_comandos_oc
    where odoo_instancia_id = p_odoo_instancia_id and orden_id = p_orden_id
      and accion = p_accion and revision = p_revision
    for update;

  if found and v_existente.estado = 'completado' then
    return jsonb_build_object('ya_completado', true, 'resultado', v_existente.resultado, 'comando_id', v_existente.id);
  end if;

  -- Una llamada reciente en vuelo no se duplica; una de hace > 2 min quedó huérfana (edge caído) y se reabre.
  if found and v_existente.estado = 'pendiente' and v_existente.creado_en > now() - interval '2 minutes' then
    raise exception 'Esta acción sigue en curso en Odoo. Espera unos segundos y vuelve a intentar.'
      using errcode = '55000';
  end if;

  if found then
    update sgc.odoo_comandos_oc set estado = 'pendiente', error = null, creado_en = now() where id = v_existente.id;
    v_comando_id := v_existente.id;
  else
    insert into sgc.odoo_comandos_oc (odoo_instancia_id, orden_id, accion, revision, estado, es_prueba, creado_por)
      values (p_odoo_instancia_id, p_orden_id, p_accion, p_revision, 'pendiente', coalesce(p_es_prueba, false), p_creado_por)
      returning id into v_comando_id;
  end if;

  return jsonb_build_object('ya_completado', false, 'comando_id', v_comando_id);
end;
$fn$;
comment on function sgc.oc_comando_registrar_inicio is 'CY24k -- abre un comando de sgc.odoo_comandos_oc; completado => devuelve su resultado (D3); error o pendiente huerfano (>2 min) => se reabre para el reintento del usuario.';


-- Vínculo: reemplaza a registrar_publicacion_oc (que escribía el espejo).
drop function if exists sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text, uuid, bigint);

create or replace function sgc.vincular_oc_odoo(p_orden_id uuid, p_odoo_instancia_id uuid, p_odoo_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras o service_role puede vincular una orden con Odoo' using errcode = '42501';
  end if;
  if p_odoo_instancia_id is null or p_odoo_id is null or p_odoo_id <= 0 then
    raise exception 'Vínculo de Odoo inválido';
  end if;
  -- Se fija UNA sola vez: un reintento posterior nunca lo pisa.
  update sgc.ordenes_compra
     set odoo_instancia_id = coalesce(odoo_instancia_id, p_odoo_instancia_id),
         odoo_id = coalesce(odoo_id, p_odoo_id)
   where id = p_orden_id;
  return found;
end;
$fn$;
comment on function sgc.vincular_oc_odoo is 'CY24k -- fija el vínculo OC <-> purchase.order (una sola vez). El estado NO se guarda: se lee de Odoo.';
revoke all on function sgc.vincular_oc_odoo(uuid, uuid, bigint) from public, anon;
grant execute on function sgc.vincular_oc_odoo(uuid, uuid, bigint) to authenticated, service_role;

create or replace function sgc.oc_para_publicar(p_orden_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_oc sgc.ordenes_compra;
  v_proveedor sgc.proveedores;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
  v_lineas jsonb;
  v_lineas_sin_producto integer;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras puede publicar una orden de compra en Odoo' using errcode = '42501';
  end if;

  select * into v_oc from sgc.ordenes_compra where id = p_orden_id;
  if not found then raise exception 'Orden de compra no encontrada'; end if;

  -- D-16 / E10: una OC de prueba NUNCA se publica, aunque se pida.
  if coalesce(v_oc.es_prueba, false) then
    raise exception 'Una orden de compra de prueba no se publica en Odoo' using errcode = '22023';
  end if;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then
    raise exception 'No hay una instancia de Odoo habilitada para publicar' using errcode = '22023';
  end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  select * into v_proveedor from sgc.proveedores where id = v_oc.proveedor_id;
  -- E9: proveedor sin vinculo a Odoo bloquea la publicacion con mensaje claro.
  if v_proveedor.odoo_id is null then
    raise exception 'El proveedor de esta orden todavía no está vinculado a Odoo (%)', v_proveedor.nombre using errcode = '22023';
  end if;

  -- Criterio 6: una línea sin producto Odoo no se puede publicar; se indica cuáles faltan.
  select count(*) into v_lineas_sin_producto
    from sgc.orden_compra_items where orden_id = p_orden_id and odoo_product_id is null;
  if v_lineas_sin_producto > 0 then
    raise exception '% línea(s) de esta orden todavía no tienen producto de Odoo vinculado' , v_lineas_sin_producto using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', oci.id, 'odoo_product_id', oci.odoo_product_id, 'odoo_uom_id', oci.odoo_uom_id,
      'cantidad', oci.cantidad, 'precio_unitario', oci.precio_unitario, 'descripcion', oci.descripcion
    )), '[]'::jsonb)
    into v_lineas
    from sgc.orden_compra_items oci where oci.orden_id = p_orden_id;

  return jsonb_build_object(
    'odoo_instancia_id', v_instancia_id,
    'orden_id', v_oc.id,
    'numero', v_oc.numero,
    'odoo_proveedor_id', v_proveedor.odoo_id,
    'fecha', v_oc.fecha,
    'fecha_entrega_esperada', v_oc.fecha_entrega_esperada,
    'notas', v_oc.notas,
    'lineas', v_lineas,
    'odoo_id_existente', v_oc.odoo_id
  );
end;
$fn$;

create or replace function sgc.oc_para_comando(p_orden_id uuid, p_accion text)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_oc sgc.ordenes_compra;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
begin
  if p_accion not in ('confirmar', 'cancelar') then
    raise exception 'accion invalida para oc_para_comando: %', p_accion;
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras puede % una orden de compra en Odoo', p_accion using errcode = '42501';
  end if;

  select * into v_oc from sgc.ordenes_compra where id = p_orden_id;
  if not found then raise exception 'Orden de compra no encontrada'; end if;

  -- D-16/E10: igual que al publicar, una OC de prueba nunca toca Odoo.
  if coalesce(v_oc.es_prueba, false) then
    raise exception 'Una orden de compra de prueba no se publica en Odoo' using errcode = '22023';
  end if;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then
    raise exception 'No hay una instancia de Odoo habilitada para publicar' using errcode = '22023';
  end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  if v_oc.odoo_instancia_id is distinct from v_instancia_id or v_oc.odoo_id is null then
    raise exception 'Esta orden todavía no se ha publicado en Odoo' using errcode = '22023';
  end if;
  -- El estado (confirmada/cancelada/por aprobar/recibida) NO se espeja en SGC: lo valida el adaptador contra Odoo en vivo.

  return jsonb_build_object(
    'odoo_instancia_id', v_instancia_id, 'orden_id', v_oc.id, 'odoo_id', v_oc.odoo_id,
    'numero', v_oc.numero
  );
end;
$fn$;

create or replace function sgc.mi_solicitud_compra_odoo_estado(p_solicitud_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_solicitud sgc.solicitudes_compra;
  v_oc sgc.ordenes_compra;
  v_alta_pendiente sgc.odoo_producto_solicitudes;
  v_odoo_estado text;
  v_alta_estado text;
  v_alta_motivo text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;

  select * into v_solicitud
  from sgc.solicitudes_compra
  where id = p_solicitud_id and solicitante_id = auth.uid();

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;

  if v_solicitud.orden_compra_id is null then
    return jsonb_build_object('odoo_estado', null, 'alta_producto_estado', null, 'alta_producto_motivo', null);
  end if;

  select * into v_oc from sgc.ordenes_compra where id = v_solicitud.orden_compra_id;

  -- La alta de producto sin resolver manda sobre el estado de publicación: es la
  -- razón real por la que la OC está estancada.
  select ops.* into v_alta_pendiente
  from sgc.odoo_producto_solicitudes ops
  join sgc.orden_compra_items oci on oci.id = ops.orden_item_id
  where oci.orden_id = v_oc.id and ops.estado = 'pendiente'
  order by ops.solicitado_en desc
  limit 1;

  if v_alta_pendiente.id is not null then
    v_odoo_estado := 'pendiente de producto';
  else
    -- El estado vivo (borrador/por aprobar/confirmada/recibida) se lee de Odoo en la web; aquí solo el vínculo.
    v_odoo_estado := case when v_oc.odoo_id is not null then 'enviada a Odoo' else null end;
  end if;

  -- Última solicitud de alta de producto de esta OC, resuelta o no (para que
  -- el solicitante vea el desenlace aunque ya no esté "pendiente").
  select ops.* into v_alta_pendiente
  from sgc.odoo_producto_solicitudes ops
  join sgc.orden_compra_items oci on oci.id = ops.orden_item_id
  where oci.orden_id = v_oc.id
  order by ops.solicitado_en desc
  limit 1;

  v_alta_estado := case v_alta_pendiente.estado
    when 'pendiente' then 'pendiente'
    when 'creado' then 'resuelta'
    when 'vinculado_existente' then 'resuelta'
    when 'rechazado' then 'rechazada'
    else null
  end;
  v_alta_motivo := case when v_alta_pendiente.estado = 'rechazado' then v_alta_pendiente.motivo_resolucion else null end;

  return jsonb_build_object(
    'odoo_estado', v_odoo_estado,
    'alta_producto_estado', v_alta_estado,
    'alta_producto_motivo', v_alta_motivo
  );
end;
$$;

revoke all on function sgc.oc_para_publicar(uuid) from public, anon;
grant execute on function sgc.oc_para_publicar(uuid) to authenticated, service_role;
revoke all on function sgc.oc_para_comando(uuid, text) from public, anon;
grant execute on function sgc.oc_para_comando(uuid, text) to authenticated, service_role;
grant execute on function sgc.mi_solicitud_compra_odoo_estado(uuid) to authenticated;
revoke all on function sgc.oc_comando_finalizar(uuid, text, jsonb, text) from public, anon;
grant execute on function sgc.oc_comando_finalizar(uuid, text, jsonb, text) to authenticated, service_role;
revoke all on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) from public, anon;
grant execute on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) to authenticated, service_role;

-- Ya nada lee el espejo: se eliminan las columnas (el check de odoo_sync_estado cae con la columna).
alter table sgc.ordenes_compra
  drop column odoo_sync_estado,
  drop column odoo_state,
  drop column odoo_nombre,
  drop column odoo_total,
  drop column odoo_sync_error;

commit;
