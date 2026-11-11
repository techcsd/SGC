-- ============================================================================
-- DM2 (ronda DM, PROMPT 140 F7) — Agente de Pendientes (N3): recopila a diario
-- y a la semana lo que sigue abierto (reportes de Soporte, errores del sistema
-- sin atender, preguntas que Compa no pudo contestar, hallazgos de WhatsApp en
-- seguimiento) y lo deja en una nota que se reescribe — nunca se envía solo
-- más que el aviso corto. Mismo marco de DF2/DF3 (sgc.agentes, patrón
-- agente-cronista): 100% determinista, cero costo de IA.
--
-- Aditivo, fechado, idempotente. No toca tablas de negocio.
-- ============================================================================
begin;

-- ── 1) Catálogo de agentes — agrega 'pendientes' a la lista cerrada ────────
alter table sgc.agentes drop constraint if exists agentes_clave_check;
alter table sgc.agentes add constraint agentes_clave_check
  check (clave in ('vigia','capataz','soporte','auditor','escriba','cronista','pendientes'));

insert into sgc.agentes (clave, nombre, rol, nivel_max) values
  ('pendientes', 'Agente de Pendientes',
   'Reúne a diario (7am RD) y a la semana (lunes 7:15am RD) los reportes de Soporte, errores del sistema, preguntas sin responder de Compa y hallazgos de WhatsApp en seguimiento, y los deja en una nota fija que se reescribe. Nunca envía nada por su cuenta, solo un aviso corto.',
   1)
on conflict (clave) do nothing;

-- ── 2) Configuración por persona (DM-35: "tú eliges el destino") ──────────
create table if not exists sgc.agente_pendientes_config (
  usuario_id  uuid primary key references sgc.usuarios(id) on delete cascade,
  modo        text not null default 'nota_fija' check (modo in ('nota_fija','nota_existente','nota_nueva','preguntar')),
  nota_id     uuid references sgc.notas(id) on delete set null,
  fuentes     text[] not null default array['soporte','errores','gaps','whatsapp'],
  activo      boolean not null default true,
  updated_at  timestamptz not null default now()
);
comment on table sgc.agente_pendientes_config is
  'DM2 — config por persona del Agente de Pendientes. modo=nota_fija (default) reescribe una nota ancla "Pendientes"; nota_existente usa nota_id; nota_nueva crea una por corrida; preguntar deja un aviso con un borrador a confirmar (patrón claude_borradores).';

alter table sgc.agente_pendientes_config enable row level security;
drop policy if exists "agente_pendientes_config: ver/editar lo mío" on sgc.agente_pendientes_config;
create policy "agente_pendientes_config: ver/editar lo mío" on sgc.agente_pendientes_config
  for all to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin())
  with check (usuario_id = auth.uid() or sgc.is_admin());
grant select, insert, update, delete on sgc.agente_pendientes_config to authenticated;
grant select, insert, update on sgc.agente_pendientes_config to service_role;

create or replace function sgc.agente_pendientes_set_config(
  p_modo text default 'nota_fija', p_nota_id uuid default null,
  p_fuentes text[] default null, p_activo boolean default true
) returns sgc.agente_pendientes_config
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_row sgc.agente_pendientes_config;
begin
  if p_modo not in ('nota_fija','nota_existente','nota_nueva','preguntar') then
    raise exception 'Modo inválido.' using errcode = '22023';
  end if;
  insert into sgc.agente_pendientes_config (usuario_id, modo, nota_id, fuentes, activo, updated_at)
  values (auth.uid(), p_modo, p_nota_id, coalesce(p_fuentes, array['soporte','errores','gaps','whatsapp']), p_activo, now())
  on conflict (usuario_id) do update set
    modo = excluded.modo, nota_id = excluded.nota_id, fuentes = excluded.fuentes,
    activo = excluded.activo, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$function$;
grant execute on function sgc.agente_pendientes_set_config(text, uuid, text[], boolean) to authenticated;

-- Semilla: Xaviel con el default (DM-35: "una nota fija que se actualiza").
insert into sgc.agente_pendientes_config (usuario_id, modo)
select id, 'nota_fija' from sgc.usuarios where nombre = 'Xaviel Terrero'
on conflict (usuario_id) do nothing;

-- ── 2b) Permisos por fuente, para una persona arbitraria (lo usa el edge,
-- service_role, que no tiene auth.uid() propio) — reusa es_tecnologia()/
-- puede_ver_submodulo() en vez de reinventar la lógica de roles (DM-33: "cada
-- fuente respeta los permisos de quien recibe").
create or replace function sgc.agente_pendientes_permisos(p_usuario uuid)
returns table(ve_tecnologia boolean, ve_wa boolean)
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
  return query select sgc.es_tecnologia(), sgc.puede_ver_submodulo('tecnologia.wa_grupos');
end;
$function$;
grant execute on function sgc.agente_pendientes_permisos(uuid) to service_role;

-- ── 3) Familia en el motor de avisos (DM-37) — nace apagada en prod, encendida en dev ──
insert into sgc.envios_automaticos (familia, nombre, activo) values
  ('agente_pendientes', 'Agente de Pendientes (diario/semanal)',
   (select coalesce(valor, '') = 'dev' from sgc.config_entorno where clave = 'entorno'))
on conflict (familia) do nothing;

-- ── 4) "Probar ahora" — ignora el interruptor, manda SOLO a quien lo pide (CU3) ──
create or replace function sgc.agente_pendientes_probar() returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_secret text;
  v_url    text;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'Solo Tecnología puede probar el Agente de Pendientes.' using errcode = '42501';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  if v_secret is null then
    raise exception 'Falta el secreto infra_sync_secret en este entorno.' using errcode = '22023';
  end if;
  v_url := sgc.edge_url('agente-pendientes');
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('modo', 'prueba', 'usuario_id', auth.uid())
  );
end;
$function$;
grant execute on function sgc.agente_pendientes_probar() to authenticated;

-- ── 5) Crons — diario 7:00am RD y semanal lunes 7:15am RD (RD = UTC-4 todo el año) ──
select cron.schedule('agente-pendientes-diario', '0 11 * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/agente-pendientes',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{"modo":"diario"}'::jsonb);$cron$);

select cron.schedule('agente-pendientes-semanal', '15 11 * * 1', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/agente-pendientes',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{"modo":"semanal"}'::jsonb);$cron$);

commit;
