-- ============================================================================
-- DF2 — Agentes: datos, eventos y acciones (PROMPT 128, ronda DF).
-- Aditivo, fechado, idempotente. NO toca tablas de negocio (bitácoras,
-- inventario, conduces, dinero) — los agentes leen de ahí pero nunca escriben.
--
-- 6 agentes (Vigía/Auditor = Nivel 1 solo detectan; Capataz/Soporte = Nivel 2
-- pueden ejecutar una de las 4 acciones cerradas de abajo; Escriba = Nivel 3
-- propone código vía PR, nunca escribe solo — lo arma F4; Cronista = informe
-- diario, lo arma F5).
--
-- Acciones Nivel 2 — lista CERRADA (DF-09), ninguna otra:
--   1) reintentar_transcripcion_atascada
--   2) recordar_firma_conduce       (mensaje normal del sistema, vía sgc.notificar)
--   3) abrir_reporte_soporte        (por error repetido)
--   4) reiniciar_envio_atascado     (outbox del cliente — en la práctica: recordatorio)
-- Prohibido explícitamente: tocar bitácoras, inventario, conduces o dinero.
--
-- Retención de agente_eventos: 14 días (DF-12), cron diario de limpieza.
-- Cron del Vigía: cada 5 min (DF-07). Capataz/Soporte/Auditor: sin cron fijo
-- todavía (DF-07 dice "los otros según necesidad") — F5/F6 decidirán el disparador.
--
-- Tope de costo diario por agente: reusa sgc.uso_ia (NO duplica costo/tokens/
-- modelo en una tabla paralela) agrupando por funcion = 'agente_<clave>'.
-- Monto default $5/agente/día vía sgc.parametros (editable sin migración) —
-- el prompt no da un monto exacto (falta CONTEXTO-63 / DF-06), este es el
-- default razonable aplicado y reportado.
-- ============================================================================
begin;

-- ── 1) Catálogo de agentes ──────────────────────────────────────────────────
create table if not exists sgc.agentes (
  id         uuid primary key default gen_random_uuid(),
  clave      text not null unique check (clave in ('vigia','capataz','soporte','auditor','escriba','cronista')),
  nombre     text not null,
  rol        text not null,
  nivel_max  int  not null check (nivel_max in (1,2,3)),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table sgc.agentes is 'DF2 — catálogo de los 6 agentes que monitorean SGC/CSD App.';

insert into sgc.agentes (clave, nombre, rol, nivel_max) values
  ('vigia',    'Vigía',    'Detecta problemas deterministas cada 5 min (transcripciones atascadas, conduces sin firmar, errores repetidos, envíos atascados).', 2),
  ('capataz',  'Capataz',  'Revisa cobertura de trabajo (bitácoras del día, rutas sin arrancar) y puede recordar/reabrir según las 4 acciones permitidas.', 2),
  ('soporte',  'Soporte',  'Atiende reportes de usuario repetidos o sin responder y puede abrir/escalar un reporte de soporte.', 2),
  ('auditor',  'Auditor',  'Solo observa: audita consistencia de datos (RLS, grants, migraciones) y reporta hallazgos, nunca actúa.', 1),
  ('escriba',  'Escriba',  'Propone código vía PR a dev cuando se le pide (Nivel 3) — nunca mezcla a main ni actúa sin tu OK.', 3),
  ('cronista', 'Cronista', 'Arma el informe diario 6:30pm RD de SGC y CSD App — se guarda siempre, se envía solo con tu clic.', 1)
on conflict (clave) do nothing;

alter table sgc.agentes enable row level security;
drop policy if exists "agentes: ver" on sgc.agentes;
create policy "agentes: ver" on sgc.agentes for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.agentes to authenticated;
grant select, insert, update on sgc.agentes to service_role;

-- ── 2) Eventos (estado en vivo, para la oficina isométrica de F5) ──────────
create table if not exists sgc.agente_eventos (
  id             uuid primary key default gen_random_uuid(),
  agente_id      uuid not null references sgc.agentes(id) on delete cascade,
  tipo           text not null,
  estado         text not null check (estado in ('observando','trabajando','esperando_ok','error','inactivo')),
  resumen        text,
  evidencia_json jsonb not null default '{}'::jsonb,
  creado_en      timestamptz not null default now()
);
comment on table sgc.agente_eventos is 'DF2 — estado en vivo de cada agente. Retención 14 días (DF-12), ver cron agente-eventos-retencion.';
create index if not exists idx_agente_eventos_agente_fecha on sgc.agente_eventos(agente_id, creado_en desc);

alter table sgc.agente_eventos enable row level security;
drop policy if exists "agente_eventos: ver" on sgc.agente_eventos;
create policy "agente_eventos: ver" on sgc.agente_eventos for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.agente_eventos to authenticated;
grant select, insert on sgc.agente_eventos to service_role;

-- ── 3) Hallazgos (Nivel 1 — lo que detectan sin poder actuar, o antes de actuar) ──
create table if not exists sgc.agente_hallazgos (
  id         uuid primary key default gen_random_uuid(),
  agente_id  uuid not null references sgc.agentes(id) on delete cascade,
  severidad  text not null check (severidad in ('baja','media','alta','critica')),
  titulo     text not null,
  detalle    text,
  origen     text,
  estado     text not null default 'abierto' check (estado in ('abierto','en_progreso','resuelto','descartado')),
  creado_en  timestamptz not null default now()
);
comment on table sgc.agente_hallazgos is 'DF2 — hallazgos de los agentes (Nivel 1: detectar y avisar).';
create index if not exists idx_agente_hallazgos_estado on sgc.agente_hallazgos(estado, creado_en desc);

alter table sgc.agente_hallazgos enable row level security;
drop policy if exists "agente_hallazgos: ver" on sgc.agente_hallazgos;
create policy "agente_hallazgos: ver" on sgc.agente_hallazgos for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.agente_hallazgos to authenticated;
grant select, insert, update on sgc.agente_hallazgos to service_role;

-- ── 4) Acciones permitidas — lista CERRADA de Nivel 2 (DF-09) ──────────────
create table if not exists sgc.agente_acciones_permitidas (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique,
  descripcion text not null,
  nivel       int  not null default 2 check (nivel = 2)
);
comment on table sgc.agente_acciones_permitidas is 'DF2 — DF-09: lista CERRADA de acciones Nivel 2. Nunca agregar una que toque bitácoras/inventario/conduces/dinero.';

insert into sgc.agente_acciones_permitidas (clave, descripcion) values
  ('reintentar_transcripcion_atascada', 'Reintentar una transcripción de voz atascada (resetea el estado a pendiente, no toca el contenido de negocio).'),
  ('recordar_firma_conduce',            'Enviar un recordatorio normal del sistema a quien debe firmar un conduce (sgc.notificar, no modifica el conduce).'),
  ('abrir_reporte_soporte',             'Abrir un reporte de soporte cuando un error se repite (sgc.reportes_usuario), para que Tecnología lo vea.'),
  ('reiniciar_envio_atascado',          'Recordar al usuario que reabra la app para reintentar un envío atascado del outbox (no se puede reiniciar un outbox local desde el servidor; el equivalente seguro es el recordatorio).')
on conflict (clave) do nothing;

alter table sgc.agente_acciones_permitidas enable row level security;
drop policy if exists "agente_acciones_permitidas: ver" on sgc.agente_acciones_permitidas;
create policy "agente_acciones_permitidas: ver" on sgc.agente_acciones_permitidas for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.agente_acciones_permitidas to authenticated;
grant select on sgc.agente_acciones_permitidas to service_role;

-- ── 5) Acciones ejecutadas (bitácora de lo que hizo cada agente) ───────────
create table if not exists sgc.agente_acciones (
  id                   uuid primary key default gen_random_uuid(),
  agente_id            uuid not null references sgc.agentes(id) on delete cascade,
  accion_permitida_id  uuid not null references sgc.agente_acciones_permitidas(id),
  que_hizo             text not null,
  resultado            text,
  reversible           boolean not null default true,
  deshecha_en          timestamptz,
  creado_en            timestamptz not null default now()
);
comment on table sgc.agente_acciones is 'DF2 — qué acción Nivel 2 ejecutó cada agente, para el panel "Lo que arreglaron solos" con Deshacer (F5).';
create index if not exists idx_agente_acciones_fecha on sgc.agente_acciones(creado_en desc);

alter table sgc.agente_acciones enable row level security;
drop policy if exists "agente_acciones: ver" on sgc.agente_acciones;
create policy "agente_acciones: ver" on sgc.agente_acciones for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.agente_acciones to authenticated;
grant select, insert, update on sgc.agente_acciones to service_role;

-- ── 6) Aprobaciones (Nivel 3 — el Escriba propone, Xaviel aprueba; F4 la llena) ──
create table if not exists sgc.agente_aprobaciones (
  id                uuid primary key default gen_random_uuid(),
  agente_id         uuid references sgc.agentes(id),
  propuesta         text not null,
  rama              text,
  pr_url            text,
  pruebas_resultado jsonb,
  estado            text not null default 'pendiente' check (estado in ('pendiente','aprobada','ajuste','descartada')),
  decidida_por      uuid references sgc.usuarios(id),
  decidida_en       timestamptz,
  creado_en         timestamptz not null default now()
);
comment on table sgc.agente_aprobaciones is 'DF2/F4 — propuestas de código del Escriba. "Aprobada" solo habilita merge a dev, nunca mezcla a main sola.';

alter table sgc.agente_aprobaciones enable row level security;
drop policy if exists "agente_aprobaciones: ver" on sgc.agente_aprobaciones;
create policy "agente_aprobaciones: ver" on sgc.agente_aprobaciones for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
drop policy if exists "agente_aprobaciones: decidir" on sgc.agente_aprobaciones;
create policy "agente_aprobaciones: decidir" on sgc.agente_aprobaciones for update to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia())
  with check (sgc.is_admin() or sgc.es_tecnologia());
grant select, update on sgc.agente_aprobaciones to authenticated;
grant select, insert, update on sgc.agente_aprobaciones to service_role;

-- ── 7) Retención de eventos — 14 días (DF-12) ──────────────────────────────
create or replace function sgc.agente_eventos_purgar()
returns void language sql security definer set search_path to 'sgc', 'pg_temp'
as $function$
  delete from sgc.agente_eventos where creado_en < now() - interval '14 days';
$function$;

select cron.schedule('agente-eventos-retencion', '30 3 * * *',
  $cron$select sgc.agente_eventos_purgar();$cron$);

-- ── 8) Tope de costo diario por agente (reusa sgc.uso_ia, no duplica) ──────
insert into sgc.parametros (clave, valor, descripcion) values
  ('agente_costo_tope_diario_usd', '5', 'DF2 — tope de costo diario en USD por agente (funcion=''agente_<clave>'' en sgc.uso_ia). Default aplicado por falta de CONTEXTO-63/DF-06; ajustable sin migración.')
on conflict (clave) do nothing;

create or replace function sgc.agente_costo_hoy(p_agente text)
returns numeric language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(sum(costo_estimado), 0)
  from sgc.uso_ia
  where funcion = 'agente_' || p_agente
    and created_at::date = (now() at time zone 'America/Santo_Domingo')::date;
$function$;
grant execute on function sgc.agente_costo_hoy(text) to service_role, authenticated;

create or replace function sgc.agente_bajo_tope(p_agente text)
returns boolean language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select sgc.agente_costo_hoy(p_agente) <
         coalesce((select valor::numeric from sgc.parametros where clave = 'agente_costo_tope_diario_usd'), 5);
$function$;
grant execute on function sgc.agente_bajo_tope(text) to service_role, authenticated;

-- ── 9) Auditor — tablas con RLS activado sin ninguna policy ────────────────
create or replace function sgc.agente_auditor_rls_sin_policy()
returns table (tabla text)
language sql stable security definer set search_path to 'sgc', 'pg_catalog', 'pg_temp'
as $function$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'sgc' and c.relkind = 'r' and c.relrowsecurity
    and not exists (
      select 1 from pg_policies p where p.schemaname = 'sgc' and p.tablename = c.relname
    )
  order by c.relname;
$function$;
grant execute on function sgc.agente_auditor_rls_sin_policy() to service_role, authenticated;

-- ── 10) Cron del Vigía — cada 5 minutos (DF-07) ────────────────────────────
select cron.schedule('agente-vigia', '*/5 * * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/agente-vigia',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);

commit;
