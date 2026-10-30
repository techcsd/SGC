-- CY24 Fase C [feature #24] -- segunda pieza: RPCs que envuelven la
-- idempotencia de sgc.odoo_comandos_oc (D3) para que el edge compras.crear
-- solo llame RPCs (mismo patron que el resto del repo), nunca toque la tabla
-- directo. Complementa sql/2026-10-30-cy24g-fase-c-comandos-oc.sql (tabla +
-- oc_para_publicar), ya aplicado -- este es un archivo nuevo a proposito
-- (no se edita un archivo ya aplicado a dev, CD10/regla 19).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

-- RPC: abre (o reabre, si quedo en error) un comando. Si ya hay uno
-- COMPLETADO para la misma clave, devuelve su resultado sin tocar Odoo
-- (idempotencia real, D3).
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
      and accion = p_accion and revision = p_revision;

  if found and v_existente.estado = 'completado' then
    return jsonb_build_object('ya_completado', true, 'resultado', v_existente.resultado, 'comando_id', v_existente.id);
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
comment on function sgc.oc_comando_registrar_inicio is 'CY24 Fase C -- abre un comando de sgc.odoo_comandos_oc; si ya hay uno completado para la misma clave, devuelve su resultado en vez de reabrir (D3: idempotencia real).';
revoke all on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) from public, anon;
grant execute on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) to authenticated, service_role;

-- RPC: cierra un comando ya abierto (completado/error/incierto) con su resultado.
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
  if p_estado not in ('completado', 'error', 'incierto') then
    raise exception 'p_estado invalido: %', p_estado;
  end if;
  update sgc.odoo_comandos_oc
     set estado = p_estado, resultado = p_resultado, error = p_error, finalizado_en = now()
   where id = p_comando_id;
  return found;
end;
$fn$;
comment on function sgc.oc_comando_finalizar is 'CY24 Fase C -- cierra un comando de sgc.odoo_comandos_oc con su resultado final.';
revoke all on function sgc.oc_comando_finalizar(uuid, text, jsonb, text) from public, anon;
grant execute on function sgc.oc_comando_finalizar(uuid, text, jsonb, text) to authenticated, service_role;

commit;
