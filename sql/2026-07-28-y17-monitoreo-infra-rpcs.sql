-- ============================================================================
-- Y17 — Monitoreo de Infraestructura · FASE 1 (helpers de alertas)
-- ============================================================================
-- raise/mark/resolve: para las edge functions (service_role).
-- acknowledge: acción de usuario (admin/tecnologia).
-- ============================================================================

-- Rango de severidad para comparar/escalar.
create or replace function sgc._sev_rank(p text)
returns int language sql immutable as $$
  select case p when 'critica' then 4 when 'alta' then 3 when 'media' then 2 when 'info' then 1 else 0 end;
$$;

-- Crea/actualiza una alerta con dedup por (source_type, source_id, alert_type) ACTIVA.
-- Anti-ruido: la fila se crea solo si no hay una activa; si existe, escala severidad
-- y actualiza el mensaje. Devuelve {alert_id, is_new, should_notify}.
create or replace function sgc.raise_infra_alert(
  p_source_type text,
  p_source_id   uuid,
  p_alert_type  text,
  p_severity    text,
  p_message     text
)
returns jsonb
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_existing sgc.alerts;
  v_id uuid;
  v_is_new boolean;
  v_sev text;
  v_should boolean;
begin
  -- Dedup por alerta NO resuelta (reconocida o no): mientras el problema persista
  -- no se crea una fila nueva. resolve_infra_alert la "cierra" al recuperarse el
  -- estado; una reaparición posterior sí crea una alerta fresca.
  select * into v_existing from sgc.alerts
  where source_type = p_source_type and source_id = p_source_id and alert_type = p_alert_type
    and resolved_at is null
  order by created_at desc limit 1;

  if not found then
    insert into sgc.alerts (source_type, source_id, alert_type, severity, message)
    values (p_source_type, p_source_id, p_alert_type, p_severity, p_message)
    returning id into v_id;
    v_is_new := true;
    v_sev := p_severity;
    -- notifica al crearse salvo 'info' (panel-only)
    v_should := (p_severity <> 'info');
  else
    v_id := v_existing.id;
    v_is_new := false;
    -- escala a la severidad mayor
    v_sev := case when sgc._sev_rank(p_severity) > sgc._sev_rank(v_existing.severity)
                  then p_severity else v_existing.severity end;
    update sgc.alerts set severity = v_sev, message = p_message where id = v_id;
    -- Reconocida → silenciada (no re-notifica aunque el problema siga).
    -- Si no, re-notifica solo alta/critica, máx 1 vez por día.
    v_should := v_existing.acknowledged_at is null
                and sgc._sev_rank(v_sev) >= sgc._sev_rank('alta')
                and (v_existing.last_notified_at is null
                     or v_existing.last_notified_at::date < current_date);
  end if;

  return jsonb_build_object('alert_id', v_id, 'is_new', v_is_new, 'should_notify', v_should, 'severity', v_sev);
end;
$$;
revoke all on function sgc.raise_infra_alert(text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function sgc.raise_infra_alert(text,uuid,text,text,text) to service_role;

-- Marca una alerta como notificada (registra canales usados).
create or replace function sgc.mark_alert_notified(p_alert_id uuid, p_channels jsonb)
returns void language plpgsql security definer set search_path = sgc, public as $$
begin
  update sgc.alerts
    set last_notified_at = now(),
        notified_channels = coalesce(notified_channels,'[]'::jsonb) || coalesce(p_channels,'[]'::jsonb)
  where id = p_alert_id;
end;
$$;
revoke all on function sgc.mark_alert_notified(uuid,jsonb) from public, anon, authenticated;
grant execute on function sgc.mark_alert_notified(uuid,jsonb) to service_role;

-- Resuelve (estado recuperado) las alertas activas de un tipo.
create or replace function sgc.resolve_infra_alert(p_source_type text, p_source_id uuid, p_alert_type text)
returns int language plpgsql security definer set search_path = sgc, public as $$
declare v_n int;
begin
  update sgc.alerts set resolved_at = now()
  where source_type = p_source_type and source_id = p_source_id and alert_type = p_alert_type
    and acknowledged_at is null and resolved_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function sgc.resolve_infra_alert(text,uuid,text) from public, anon, authenticated;
grant execute on function sgc.resolve_infra_alert(text,uuid,text) to service_role;

-- Reconoce una alerta (acción de usuario admin/tecnologia): traza quién y cuándo.
create or replace function sgc.acknowledge_alert(p_alert_id uuid)
returns void language plpgsql security definer set search_path = sgc, public as $$
begin
  if not sgc.es_tecnologia() then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update sgc.alerts
    set acknowledged_by = auth.uid(), acknowledged_at = now()
  where id = p_alert_id and acknowledged_at is null;
end;
$$;
grant execute on function sgc.acknowledge_alert(uuid) to authenticated, service_role;

-- Actualiza el estado denormalizado de un dominio (para el semáforo). Edge lo llama.
create or replace function sgc.set_domain_status(p_domain_id uuid, p_status text, p_expires date default null)
returns void language plpgsql security definer set search_path = sgc, public as $$
begin
  update sgc.monitored_domains
    set last_status = p_status, last_checked_at = now(),
        rdap_expires_at = coalesce(p_expires, rdap_expires_at)
  where id = p_domain_id;
end;
$$;
revoke all on function sgc.set_domain_status(uuid,text,date) from public, anon, authenticated;
grant execute on function sgc.set_domain_status(uuid,text,date) to service_role;
