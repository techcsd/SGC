-- 2026-11-12-do6-rrhh-leer-cv.sql
-- Ronda DO (DO4/DO8, DO-06) — CV leído por IA: misma arquitectura async/polling
-- que `leer-documento-flota` (sql/2026-10-30-db3b-lector-flota-async.sql) —
-- RPC rápido crea un trabajo, dispara la edge en segundo plano vía pg_net
-- (x-sync-secret), el navegador hace polling de la fila. Evita que el
-- navegador sostenga una llamada larga a Anthropic (mismo hotfix DB3).
--   node scripts/apply-migration.mjs sql/2026-11-12-do6-rrhh-leer-cv.sql --env dev

begin;

create table if not exists sgc.rrhh_candidatos_lecturas (
  id uuid primary key default gen_random_uuid(),
  candidato_id uuid not null references sgc.rrhh_candidatos(id) on delete cascade,
  usuario_id uuid not null references sgc.usuarios(id),
  estado text not null default 'procesando' check (estado in ('procesando', 'listo', 'error')),
  resultado jsonb,
  created_at timestamptz not null default now()
);
alter table sgc.rrhh_candidatos_lecturas enable row level security;
drop policy if exists "rrhh_candidatos_lecturas: dueño ve" on sgc.rrhh_candidatos_lecturas;
create policy "rrhh_candidatos_lecturas: dueño ve" on sgc.rrhh_candidatos_lecturas
  for select to authenticated using (usuario_id = auth.uid());
grant select on sgc.rrhh_candidatos_lecturas to authenticated;
grant select, insert, update, delete on sgc.rrhh_candidatos_lecturas to service_role;

-- Limpieza diaria — filas efímeras (igual que flota_documentos_lecturas).
create or replace function sgc.limpiar_rrhh_candidatos_lecturas()
returns void language sql security definer set search_path to 'sgc', 'pg_temp' as $$
  delete from sgc.rrhh_candidatos_lecturas where created_at < now() - interval '2 days';
$$;
grant execute on function sgc.limpiar_rrhh_candidatos_lecturas() to service_role;
do $$ begin perform cron.unschedule('sgc-limpiar-rrhh-cv-lecturas'); exception when others then null; end $$;
select cron.schedule('sgc-limpiar-rrhh-cv-lecturas', '10 8 * * *',
  $cron$ select sgc.limpiar_rrhh_candidatos_lecturas(); $cron$);

-- RPC: crea el trabajo y dispara la lectura real en segundo plano (pg_net,
-- fire-and-forget). Mismo gate de consentimiento IA que flota/leer-recibo
-- (DN-28 — CV de un candidato no es menos sensible que un dato de empleado).
create or replace function sgc.rrhh_candidato_lectura_crear(p_candidato_id uuid, p_archivo jsonb)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_id uuid;
  v_secret text;
  v_uso_hora int;
  v_lim_hora int;
begin
  if not sgc.puede_operar_submodulo('rrhh.onboarding') then
    raise exception 'No tienes acceso a Reclutamiento.' using errcode = '42501';
  end if;
  if not sgc.mi_consentimiento('ia') then
    raise exception 'Para leer el CV con inteligencia artificial, primero actívalo en Perfil › Privacidad.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.rrhh_candidatos where id = p_candidato_id) then
    raise exception 'Candidato no encontrado.' using errcode = '22023';
  end if;
  if p_archivo is null or (p_archivo->>'data') is null then
    raise exception 'Sin archivo para leer.' using errcode = '22023';
  end if;

  select coalesce((select nullif(valor,'')::int from sgc.parametros where clave = 'rrhh_leer_cv_limite_usuario_hora'), 20) into v_lim_hora;
  select count(*) into v_uso_hora from sgc.uso_ia
    where funcion = 'rrhh_leer_cv' and usuario_id = auth.uid() and created_at >= now() - interval '1 hour';
  if v_uso_hora >= v_lim_hora then
    raise exception 'Alcanzaste el límite de lecturas por hora. Llena los campos a mano.' using errcode = '22023';
  end if;

  insert into sgc.rrhh_candidatos_lecturas (candidato_id, usuario_id, estado) values (p_candidato_id, auth.uid(), 'procesando')
  returning id into v_id;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  if v_secret is null then
    update sgc.rrhh_candidatos_lecturas set estado = 'error', resultado = jsonb_build_object('error', 'Falta configuración del servidor.') where id = v_id;
    raise exception 'Falta el secreto infra_sync_secret en este entorno.' using errcode = '22023';
  end if;

  perform net.http_post(
    url := sgc.edge_url('rrhh-leer-cv'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('job_id', v_id, 'candidato_id', p_candidato_id, 'usuario_id', auth.uid(), 'archivo', p_archivo));
  return v_id;
end $function$;
grant execute on function sgc.rrhh_candidato_lectura_crear(uuid, jsonb) to authenticated;

commit;
