-- sql/2026-10-30-db3b-lector-flota-async.sql — Hotfix (reporte real de Xaviel,
-- 30-oct-2026): "No se pudo contactar el servicio" al subir MARBETES.pdf (24
-- páginas) en Cargar documentos. Causa real: una llamada SÍNCRONA del
-- navegador a la edge de lectura tarda 8-13s incluso dividida en tandas
-- paralelas — eso roza el límite del relay de Supabase, que responde con el
-- header `x-relay-error` y supabase-js lo traduce exactamente a este mensaje
-- de "fallo de transporte" (confirmado: llamadas directas server-to-server a
-- la misma edge SÍ terminan en 200 OK en ese mismo tiempo — el problema es
-- sostener la conexión del navegador esos segundos, no la lectura en sí).
--
-- Fix estructural: el navegador deja de esperar la llamada lenta. Un RPC
-- rápido crea un "trabajo" y dispara la lectura real en SEGUNDO PLANO vía
-- pg_net (mismo patrón ya probado en `pagos_obra_enviar` →
-- `pagos-descargo-enviar`); el navegador hace polling de una fila (select
-- casi instantáneo, nunca sostiene una conexión larga).
--
--   node scripts/apply-migration.mjs sql/2026-10-30-db3b-lector-flota-async.sql --env dev

create table if not exists sgc.flota_documentos_lecturas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references sgc.usuarios(id),
  estado text not null default 'procesando' check (estado in ('procesando', 'listo', 'error')),
  resultado jsonb,
  created_at timestamptz not null default now()
);
alter table sgc.flota_documentos_lecturas enable row level security;
drop policy if exists "flota_documentos_lecturas: dueño ve" on sgc.flota_documentos_lecturas;
create policy "flota_documentos_lecturas: dueño ve" on sgc.flota_documentos_lecturas
  for select to authenticated using (usuario_id = auth.uid());
grant select on sgc.flota_documentos_lecturas to authenticated;
grant select, insert, update, delete on sgc.flota_documentos_lecturas to service_role;

-- Limpieza diaria — filas efímeras (un trabajo vive segundos); nadie necesita
-- ver el de ayer y la tabla no debe crecer sin límite.
create or replace function sgc.limpiar_flota_documentos_lecturas()
returns void language sql security definer set search_path to 'sgc', 'pg_temp' as $$
  delete from sgc.flota_documentos_lecturas where created_at < now() - interval '2 days';
$$;
grant execute on function sgc.limpiar_flota_documentos_lecturas() to service_role;
do $$ begin perform cron.unschedule('sgc-limpiar-flota-doc-lecturas'); exception when others then null; end $$;
select cron.schedule('sgc-limpiar-flota-doc-lecturas', '0 8 * * *',
  $cron$ select sgc.limpiar_flota_documentos_lecturas(); $cron$);

-- RPC: crea el trabajo y dispara la lectura real en segundo plano (pg_net,
-- fire-and-forget: el RPC no espera la respuesta de la edge). Repite el gate
-- de consentimiento/rate-limit que antes vivía en la edge síncrona — sigue
-- siendo responsabilidad del servidor, no del cliente.
create or replace function sgc.flota_documento_lectura_crear(p_archivos jsonb)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_id uuid;
  v_secret text;
  v_uso_hora int;
  v_uso_dia int;
  v_lim_hora int;
  v_lim_dia int;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No tienes acceso a Flota.' using errcode = '42501';
  end if;
  if not sgc.mi_consentimiento('ia') then
    raise exception 'Para leer documentos con inteligencia artificial, primero actívalo en Perfil › Privacidad.' using errcode = '42501';
  end if;
  if p_archivos is null or jsonb_array_length(p_archivos) = 0 then
    raise exception 'Sin archivos para leer.' using errcode = '22023';
  end if;

  select coalesce((select nullif(valor,'')::int from sgc.parametros where clave = 'leer_documento_flota_limite_usuario_hora'), 20) into v_lim_hora;
  select coalesce((select nullif(valor,'')::int from sgc.parametros where clave = 'leer_documento_flota_limite_diario_global'), 200) into v_lim_dia;
  select count(*) into v_uso_hora from sgc.uso_ia
    where funcion = 'leer_documento_flota' and usuario_id = auth.uid() and created_at >= now() - interval '1 hour';
  select count(*) into v_uso_dia from sgc.uso_ia
    where funcion = 'leer_documento_flota' and created_at >= current_date;
  if v_uso_hora >= v_lim_hora then
    raise exception 'Alcanzaste el límite de lecturas por hora. Llena los campos a mano.' using errcode = '22023';
  end if;
  if v_uso_dia >= v_lim_dia then
    raise exception 'Se alcanzó el límite diario de lecturas del sistema. Llena los campos a mano.' using errcode = '22023';
  end if;

  insert into sgc.flota_documentos_lecturas (usuario_id, estado) values (auth.uid(), 'procesando')
  returning id into v_id;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  if v_secret is null then
    update sgc.flota_documentos_lecturas set estado = 'error', resultado = jsonb_build_object('error', 'Falta configuración del servidor.') where id = v_id;
    raise exception 'Falta el secreto infra_sync_secret en este entorno.' using errcode = '22023';
  end if;

  perform net.http_post(
    url := sgc.edge_url('leer-documento-flota'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('job_id', v_id, 'usuario_id', auth.uid(), 'archivos', p_archivos));
  return v_id;
end $function$;
grant execute on function sgc.flota_documento_lectura_crear(jsonb) to authenticated;
