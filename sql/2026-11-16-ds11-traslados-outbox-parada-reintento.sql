-- DS-10/DS-11/DS-12 (ronda DS, 16-nov-2026): soporte de BD para publicar traslados A/B desde el outbox existente (CY6).
-- ADITIVA. El outbox ya captura `salida_inventario` (trigger odoo_v1_capturar_evento_documento); lo que faltaba:
--  1) marcar el resultado de sincronizacion en la salida SIN re-disparar el trigger de captura (bucle),
--  2) encolar el paso B cuando la parada de ruta queda 'entregada' (ADR 4/21) sin esperar la confirmacion administrativa,
--  3) «Reintentar» (admin/Tecnologia): devuelve a pendiente los eventos en error/incierto de una salida.
-- Todo sigue APAGADO: el worker solo reclama eventos de tipos con fila habilitada en sgc.odoo_publicacion_politica.

create or replace function sgc.odoo_v1_marcar_salida_sync(
  p_salida uuid, p_instancia uuid, p_picking_a bigint, p_picking_b bigint, p_estado text, p_error text default null
) returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (auth.role() = 'service_role' or sgc.is_admin()) then
    raise exception 'Solo service_role o admin puede marcar la sincronizacion' using errcode = '42501';
  end if;
  if p_estado not in ('pendiente','sincronizado','incierto','error') then raise exception 'estado invalido: %', p_estado; end if;
  perform set_config('sgc.odoo_importando', 'true', true); -- evita que este UPDATE genere otro evento
  update sgc.salidas_inventario
     set odoo_instancia_id = coalesce(p_instancia, odoo_instancia_id),
         odoo_picking_salida_id = coalesce(p_picking_a, odoo_picking_salida_id),
         odoo_picking_entrada_id = coalesce(p_picking_b, odoo_picking_entrada_id),
         odoo_sync_estado = p_estado,
         odoo_sync_error = case when p_estado = 'sincronizado' then null else p_error end,
         odoo_sync_intentos = case when p_estado = 'sincronizado' then 0 else odoo_sync_intentos + 1 end,
         odoo_sync_en = now()
   where id = p_salida;
end $fn$;
revoke all on function sgc.odoo_v1_marcar_salida_sync(uuid, uuid, bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function sgc.odoo_v1_marcar_salida_sync(uuid, uuid, bigint, bigint, text, text) to authenticated, service_role; -- gatea adentro

-- Encolar una revision nueva de la salida (misma forma de payload que el trigger de captura).
create or replace function sgc.odoo_v1_encolar_salida(p_salida uuid, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_inst uuid; v_n integer; v_rev integer; v_payload jsonb; v_prueba boolean; v_id uuid;
begin
  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then return null; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada;
  select to_jsonb(s) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(d)) filter (where d.id is not null), '[]'::jsonb), 'motivo_evento', p_motivo)
    into v_payload from sgc.salidas_inventario s left join sgc.detalle_salidas d on d.salida_id = s.id where s.id = p_salida group by s.id;
  if v_payload is null then return null; end if;
  v_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  select coalesce(max(revision), 0) + 1 into v_rev from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and agregado_id = p_salida::text;
  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_inst, 'salida_inventario', p_salida::text, 'actualizar', v_rev, v_payload, v_prueba)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function sgc.odoo_v1_encolar_salida(uuid, text) from public, anon, authenticated;
grant execute on function sgc.odoo_v1_encolar_salida(uuid, text) to service_role;

-- Paso B: la parada queda 'entregada' -> evento para cada salida de esa parada (idempotente por revision; el worker
-- tambien es idempotente por origin). Nunca debe romper la operacion de la ruta: cualquier fallo se ignora.
create or replace function sgc.odoo_v1_trg_parada_entregada() returns trigger
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare r record;
begin
  if new.estado = 'entregada' and old.estado is distinct from 'entregada' then
    for r in select id from sgc.salidas_inventario where ruta_parada_id = new.id and estado = 'despachado' loop
      begin perform sgc.odoo_v1_encolar_salida(r.id, 'parada_entregada'); exception when others then null; end;
    end loop;
  end if;
  return new;
end $fn$;
drop trigger if exists odoo_v1_parada_entregada on sgc.ruta_paradas;
create trigger odoo_v1_parada_entregada after update of estado on sgc.ruta_paradas
  for each row execute function sgc.odoo_v1_trg_parada_entregada();

-- «Reintentar» desde Tecnologia / detalle del conduce: eventos en error o incierto de esa salida vuelven a pendiente.
create or replace function sgc.odoo_reintentar_salida(p_salida uuid) returns integer
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia() or auth.role() = 'service_role') then
    raise exception 'Solo Tecnologia o un administrador puede reintentar la sincronizacion' using errcode = '42501';
  end if;
  update sgc.odoo_eventos set estado = 'pendiente', lease_token = null, lease_hasta = null, error = null, actualizado_en = now()
   where agregado_tipo = 'salida_inventario' and agregado_id = p_salida::text and estado in ('error','incierto');
  get diagnostics v_n = row_count;
  perform set_config('sgc.odoo_importando', 'true', true);
  update sgc.salidas_inventario set odoo_sync_estado = 'pendiente', odoo_sync_error = null where id = p_salida and odoo_sync_estado in ('error','incierto');
  return v_n;
end $fn$;
revoke all on function sgc.odoo_reintentar_salida(uuid) from public, anon;
grant execute on function sgc.odoo_reintentar_salida(uuid) to authenticated, service_role;
