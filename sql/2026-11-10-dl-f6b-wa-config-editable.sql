-- =============================================================================
-- F6.5/DL-27 (P3) — editar la config global del puente de grupos desde la
-- pantalla (modo por defecto, máx. respuestas/h, presupuesto de tokens,
-- recordatorio por WhatsApp, mínimo de mensajes para el recap), auditado.
-- Admin-only (misma fila singleton `wa_config`, id=true).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-10-dl-f6b-wa-config-editable.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

-- Todos los parámetros son requeridos a propósito (sin default): la pantalla
-- SIEMPRE manda el estado completo editado (lee → muestra → edita → guarda
-- todo), así `budget_tokens_dia = null` puede significar de verdad "sin tope"
-- sin ambigüedad con "no tocar este campo".
create or replace function sgc.wa_config_set(
  p_modo_por_defecto text,
  p_max_respuestas_grupo_hora integer,
  p_budget_tokens_dia bigint,
  p_recordatorio_whatsapp boolean,
  p_recap_minimo_mensajes integer
) returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_antes jsonb;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede cambiar la configuración del puente de WhatsApp.' using errcode = '42501';
  end if;
  if p_modo_por_defecto not in ('memoria','consulta','ignorar') then
    raise exception 'Modo por defecto inválido: %', p_modo_por_defecto using errcode = '22023';
  end if;
  if p_max_respuestas_grupo_hora < 1 then
    raise exception 'Máx. respuestas por hora debe ser al menos 1.' using errcode = '22023';
  end if;
  if p_recap_minimo_mensajes < 1 then
    raise exception 'El mínimo de mensajes para el recap debe ser al menos 1.' using errcode = '22023';
  end if;

  select to_jsonb(c) into v_antes from sgc.wa_config c where id = true;

  update sgc.wa_config set
    modo_por_defecto = p_modo_por_defecto,
    max_respuestas_grupo_hora = p_max_respuestas_grupo_hora,
    budget_tokens_dia = p_budget_tokens_dia,
    recordatorio_whatsapp = p_recordatorio_whatsapp,
    recap_minimo_mensajes = p_recap_minimo_mensajes,
    actualizado_en = now()
  where id = true;

  insert into sgc.audit_log (actor_id, action, metadata)
  values (auth.uid(), 'wa_config_actualizada', jsonb_build_object('antes', v_antes, 'despues', (select to_jsonb(c) from sgc.wa_config c where id = true)));
end;
$$;
grant execute on function sgc.wa_config_set(text, integer, bigint, boolean, integer) to authenticated;

commit;
