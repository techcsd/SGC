-- W3 (E2E dev <-> Odoo staging, 16-nov-2026). Dos huecos reales hallados al encender la integracion:
--  1) NO existia ningun scheduler del worker odoo-sync (solo el conciliador tenia cron): los eventos solo se publicaban a mano.
--  2) El «reintento» ignoraba el backoff: odoo_v1_finalizar_evento descartaba p_reintentar_en y el evento volvia a 'pendiente' al instante,
--     asi que un evento fuera de canary / instancia sin permiso / Odoo caido se reclamaba en CADA pasada (martilleo + intentos sin tope).
-- Aditiva. Con ninguna politica habilitada el cron no dispara nada (sin eventos reclamables).

alter table sgc.odoo_eventos add column if not exists proximo_intento_en timestamptz;
comment on column sgc.odoo_eventos.proximo_intento_en is 'W3: backoff. Un evento en reintento no se reclama antes de esta hora (null = ya).';

create or replace function sgc.odoo_v1_reclamar_eventos(p_instancia uuid, p_procesador text, p_limite integer default 20, p_lease_segundos integer default 120)
returns setof sgc.odoo_eventos language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $function$
declare
  v_limite integer := greatest(1, least(100, coalesce(p_limite, 20)));
  v_lease integer := greatest(30, least(900, coalesce(p_lease_segundos, 120)));
  v_token uuid := gen_random_uuid();
begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo admin o service_role puede reclamar eventos' using errcode = '42501';
  end if;
  if p_procesador is null or length(btrim(p_procesador)) = 0 then
    raise exception 'p_procesador es obligatorio';
  end if;

  return query
  with candidatos as (
    select e.id
    from sgc.odoo_eventos e
    join sgc.odoo_publicacion_politica pol on pol.agregado_tipo = e.agregado_tipo and pol.habilitada
    where e.odoo_instancia_id = p_instancia
      and e.es_prueba = false -- D-16: prueba nunca publica, aunque se pida
      and (
        (e.estado in ('pendiente', 'reintento') and (e.proximo_intento_en is null or e.proximo_intento_en <= now()))
        or (e.estado = 'procesando' and e.lease_hasta < now()) -- lease vencido: se puede reclamar de nuevo
      )
      and not exists (
        select 1 from sgc.odoo_eventos previo
        where previo.agregado_tipo = e.agregado_tipo and previo.agregado_id = e.agregado_id
          and previo.revision < e.revision
          and previo.estado not in ('completado', 'cancelado')
      )
    order by e.creado_en
    limit v_limite
    for update of e skip locked
  )
  update sgc.odoo_eventos e
     set estado = 'procesando', lease_token = v_token, lease_hasta = now() + (v_lease || ' seconds')::interval,
         intentos = e.intentos + 1, actualizado_en = now()
    from candidatos c
   where e.id = c.id
  returning e.*;
end;
$function$;

create or replace function sgc.odoo_v1_finalizar_evento(p_evento uuid, p_lease uuid, p_estado text, p_resultado jsonb default null, p_error text default null, p_reintentar_en timestamptz default null)
returns boolean language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $function$
declare
  v_evento sgc.odoo_eventos;
begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo admin o service_role puede finalizar eventos' using errcode = '42501';
  end if;
  if p_estado not in ('completado', 'reintento', 'error', 'incierto') then
    raise exception 'p_estado invalido: %', p_estado;
  end if;
  if p_estado = 'reintento' and p_reintentar_en is null then
    raise exception 'reintento requiere p_reintentar_en';
  end if;

  select * into v_evento from sgc.odoo_eventos where id = p_evento and lease_token = p_lease for update;
  if not found then
    return false; -- lease vencido/incorrecto: el llamador no debe asumir que su resultado cuenta
  end if;

  update sgc.odoo_eventos
     set estado = case when p_estado = 'reintento' then 'pendiente' else p_estado end,
         resultado = coalesce(p_resultado, resultado),
         error = p_error,
         proximo_intento_en = case when p_estado = 'reintento' then p_reintentar_en else null end,
         lease_token = null, lease_hasta = null,
         actualizado_en = now()
   where id = p_evento;

  insert into sgc.odoo_intentos (evento_id, procesador, lease_token, estado_resultado, resultado, error, reclamado_en)
    values (p_evento, 'rpc', p_lease, p_estado, p_resultado, p_error, v_evento.actualizado_en);

  return true;
end;
$function$;

-- Scheduler del worker: cada minuto, solo si hay eventos reclamables y la instancia habilitada permite movimientos.
create or replace function sgc.odoo_sync_disparar() returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_inst uuid; v_n integer;
begin
  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then return; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada and (permitir_salida or permitir_entrada);
  if v_inst is null then return; end if;
  -- solo llama a la edge si hay algo reclamable (cola vacia = cero invocaciones)
  if not exists (
    select 1 from sgc.odoo_eventos e join sgc.odoo_publicacion_politica pol on pol.agregado_tipo = e.agregado_tipo and pol.habilitada
     where e.odoo_instancia_id = v_inst and not e.es_prueba
       and ((e.estado = 'pendiente' and (e.proximo_intento_en is null or e.proximo_intento_en <= now())) or (e.estado = 'procesando' and e.lease_hasta < now()))
  ) then return; end if;
  perform net.http_post(url := sgc.edge_url('odoo-sync'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := jsonb_build_object('instancia_id', v_inst, 'limite', 20));
end $fn$;
revoke all on function sgc.odoo_sync_disparar() from public, anon, authenticated;
grant execute on function sgc.odoo_sync_disparar() to service_role;

do $$ begin perform cron.unschedule('sgc-odoo-sync'); exception when others then null; end $$;
select cron.schedule('sgc-odoo-sync', '* * * * *', $cron$ select sgc.odoo_sync_disparar() $cron$);

-- Un evento que vuelve a 'pendiente' desde error/incierto/bloqueado (boton «Reintentar») no espera el backoff anterior.
create or replace function sgc.odoo_eventos_limpiar_backoff() returns trigger language plpgsql as $fn$
begin
  if new.estado = 'pendiente' and old.estado in ('error', 'incierto', 'bloqueado', 'cancelado') then new.proximo_intento_en := null; end if;
  return new;
end $fn$;
drop trigger if exists odoo_eventos_limpiar_backoff on sgc.odoo_eventos;
create trigger odoo_eventos_limpiar_backoff before update of estado on sgc.odoo_eventos for each row execute function sgc.odoo_eventos_limpiar_backoff();
