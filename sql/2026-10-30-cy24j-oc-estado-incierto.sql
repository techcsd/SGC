-- CY24 Fase C [feature #24] -- cuarta pieza: el estado INCIERTO (D3 / #23).
--
-- Una escritura a Odoo que da timeout o encuentra Odoo caído NO se reintenta a ciegas:
-- Odoo pudo haber aplicado la acción, así que oc_comando_registrar_inicio NO debe
-- reabrir un comando 'incierto' ni uno 'pendiente' (en vuelo o huérfano) -- reabrirlo
-- volvería a llamar a Odoo = reintento a ciegas o doble publicación concurrente. Solo
-- un comando en 'error' (Odoo respondió que no) puede reabrirse.
--
-- Esta pieza originalmente también tocaba ordenes_compra.odoo_sync_estado y
-- registrar_publicacion_oc (el "espejo" del estado de la OC) -- cy24k (2026-10-30,
-- aplicada a dev 2026-11-01, posterior a este archivo) eliminó esas columnas por
-- decisión del dueño: el estado de la OC se lee en vivo de Odoo, SGC solo guarda el
-- vínculo. registrar_publicacion_oc quedó sin uso (odoo-api.test.ts lo confirma: "ya
-- no se espeja estado en la OC"). Esta migración nunca se aplicó a dev -- se reescribe
-- aquí a lo que sigue siendo real: solo oc_comando_registrar_inicio. Detectado y
-- corregido al mergear dev -> main (regla 18 lo frenó en CI porque el archivo original
-- rompía contra el esquema actual).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

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

-- Misma firma que antes: el grant previo sigue vigente; se reafirma por claridad.
revoke all on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) from public, anon;
grant execute on function sgc.oc_comando_registrar_inicio(uuid, uuid, text, integer, uuid, boolean) to authenticated, service_role;

commit;
