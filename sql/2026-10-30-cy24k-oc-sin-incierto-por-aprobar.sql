-- CY24k [feature #24] -- Fase C: se ELIMINA el estado `incierto` y se agrega `por_aprobar`.
--
-- Decisión del dueño: ante timeout/caída de Odoo la OC queda en `error` con un mensaje y
-- el usuario pulsa "Reintentar". El reintento es seguro porque `crear` busca primero por
-- `origin` en Odoo y confirmar/cancelar leen el estado antes de actuar (idempotentes).
-- No hay conciliación aparte.
--   1. odoo_comandos_oc.estado y ordenes_compra.odoo_sync_estado pierden 'incierto'
--      (filas existentes -> 'error').
--   2. Nuevo odoo_sync_estado 'por_aprobar': Odoo dejó la OC en 'to approve' (la compañía usa
--      doble validación y la aprueba un usuario autorizado EN ODOO; SGC no aprueba).
--   3. oc_comando_registrar_inicio: un comando 'error' se reabre; uno 'pendiente' se reabre
--      solo si lleva más de 2 min (edge caído a mitad); si es más reciente, hay otra llamada en vuelo.
--   4. mi_solicitud_compra_odoo_estado cubre 'por_aprobar' (BL2: no esconder un estado real).
-- Archivo nuevo a propósito (CD10 / regla 19). Dev primero (BU1).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
set local search_path = sgc, public;

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

  -- ordenes
  select c.conname into v_con from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'sgc.ordenes_compra'::regclass and c.contype = 'c' and a.attname = 'odoo_sync_estado';
  if v_con is null then raise exception 'No existe el check de ordenes_compra.odoo_sync_estado -- aplicar antes cy24'; end if;
  execute format('alter table sgc.ordenes_compra drop constraint %I', v_con);
  update sgc.ordenes_compra set odoo_sync_estado = 'error',
         odoo_sync_error = coalesce(odoo_sync_error, 'Sin respuesta de Odoo; reintentar.')
   where odoo_sync_estado = 'incierto';
  alter table sgc.ordenes_compra
    add constraint ordenes_compra_odoo_sync_estado_check
    check (odoo_sync_estado in ('pendiente', 'publicada', 'por_aprobar', 'confirmada', 'cancelada', 'error', 'conflicto'));
end;
$mig$;

create or replace function sgc.registrar_publicacion_oc(
  p_orden_id uuid, p_odoo_sync_estado text, p_odoo_state text default null,
  p_odoo_nombre text default null, p_odoo_total numeric default null, p_odoo_sync_error text default null,
  p_odoo_instancia_id uuid default null, p_odoo_id bigint default null
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
  if p_odoo_sync_estado not in ('pendiente', 'publicada', 'por_aprobar', 'confirmada', 'cancelada', 'error', 'conflicto') then
    raise exception 'p_odoo_sync_estado invalido: %', p_odoo_sync_estado;
  end if;
  update sgc.ordenes_compra
     set odoo_sync_estado = p_odoo_sync_estado,
         odoo_state = coalesce(p_odoo_state, odoo_state),
         odoo_nombre = coalesce(p_odoo_nombre, odoo_nombre),
         odoo_total = coalesce(p_odoo_total, odoo_total),
         odoo_sync_error = p_odoo_sync_error,
         odoo_instancia_id = coalesce(odoo_instancia_id, p_odoo_instancia_id),
         odoo_id = coalesce(odoo_id, p_odoo_id)
   where id = p_orden_id;
  return found;
end;
$fn$;

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

  -- La alta de producto sin resolver manda sobre el semáforo de sync: es la
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
    v_odoo_estado := case v_oc.odoo_sync_estado
      when 'pendiente' then 'pendiente de publicar'
      when 'publicada' then 'publicada'
      when 'por_aprobar' then 'pendiente de aprobación en Odoo'
      when 'confirmada' then 'confirmada'
      when 'cancelada' then 'cancelada'
      when 'error' then 'con un error de sincronización'
      when 'conflicto' then 'en conflicto'
      else null -- nunca se intentó publicar (comportamiento actual, CY24-1)
    end;
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

grant execute on function sgc.mi_solicitud_compra_odoo_estado(uuid) to authenticated;
revoke all on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text, uuid, bigint) from public, anon;
grant execute on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text, uuid, bigint) to authenticated, service_role;
revoke all on function sgc.oc_comando_finalizar(uuid, text, jsonb, text) from public, anon;
grant execute on function sgc.oc_comando_finalizar(uuid, text, jsonb, text) to authenticated, service_role;
revoke all on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) from public, anon;
grant execute on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) to authenticated, service_role;

commit;
