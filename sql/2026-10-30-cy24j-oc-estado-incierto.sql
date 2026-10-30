-- CY24 Fase C [feature #24] -- cuarta pieza: el estado INCIERTO (D3 / #23).
--
-- Una escritura a Odoo que da timeout o encuentra Odoo caído NO se reintenta a ciegas:
-- Odoo pudo haber aplicado la acción. El edge deja el comando y la OC en 'incierto' y
-- la conciliación (buscar por origin) lo resuelve. Esto exige:
--   1. ordenes_compra.odoo_sync_estado acepte 'incierto' (hoy el check no lo incluye).
--   2. registrar_publicacion_oc lo acepte (misma firma: CREATE OR REPLACE, sin overload).
--   3. oc_comando_registrar_inicio NO reabra un comando 'incierto' ni uno 'pendiente'
--      (en vuelo o huérfano): reabrirlo volvería a llamar a Odoo = reintento a ciegas
--      o doble publicación concurrente. Solo un comando en 'error' (Odoo respondió que
--      no) puede reabrirse.
-- Archivo nuevo a propósito: no se edita uno ya aplicado (CD10 / regla 19). Dev primero (BU1).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $mig$
declare
  v_con text;
begin
  select c.conname into v_con
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'sgc.ordenes_compra'::regclass and c.contype = 'c' and a.attname = 'odoo_sync_estado';
  if v_con is null then
    raise exception 'No existe el check de ordenes_compra.odoo_sync_estado -- aplicar antes sql/2026-10-26-cy24-oc-odoo-a.sql';
  end if;
  execute format('alter table sgc.ordenes_compra drop constraint %I', v_con);
  alter table sgc.ordenes_compra
    add constraint ordenes_compra_odoo_sync_estado_check
    check (odoo_sync_estado in ('pendiente', 'publicada', 'confirmada', 'cancelada', 'error', 'incierto', 'conflicto'));
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
  if p_odoo_sync_estado not in ('pendiente', 'publicada', 'confirmada', 'cancelada', 'error', 'incierto', 'conflicto') then
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

  -- D3: incierto o en vuelo = no se sabe si Odoo lo aplicó. NUNCA reabrir (reintento a ciegas).
  if found and v_existente.estado in ('incierto', 'pendiente') then
    raise exception 'Esta acción ya se envió a Odoo y su resultado es incierto o sigue en curso. No se reenvía: espera la conciliación con Odoo.'
      using errcode = '55000';
  end if;

  if found then
    update sgc.odoo_comandos_oc set estado = 'pendiente', error = null where id = v_existente.id;
    v_comando_id := v_existente.id;
  else
    insert into sgc.odoo_comandos_oc (odoo_instancia_id, orden_id, accion, revision, estado, es_prueba, creado_por)
      values (p_odoo_instancia_id, p_orden_id, p_accion, p_revision, 'pendiente', coalesce(p_es_prueba, false), p_creado_por)
      returning id into v_comando_id;
  end if;

  return jsonb_build_object('ya_completado', false, 'comando_id', v_comando_id);
end;
$fn$;
comment on function sgc.oc_comando_registrar_inicio is 'CY24 Fase C -- abre un comando de sgc.odoo_comandos_oc; completado => devuelve su resultado (D3); incierto/pendiente => RECHAZA (nunca reintento a ciegas); solo error se reabre.';

-- Mismas firmas que antes: los grants previos siguen vigentes; se reafirman por claridad.
revoke all on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text, uuid, bigint) from public, anon;
grant execute on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text, uuid, bigint) to authenticated, service_role;
revoke all on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) from public, anon;
grant execute on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) to authenticated, service_role;

commit;
