-- ============================================================================
-- Y17 — Módulo de Monitoreo de Infraestructura y Suscripciones · FASE 1 (esquema)
-- Ronda 28/07/2026 · PROMPT-5 · doc SGC-CSI-MOD-01
-- ============================================================================
-- Aditivo. Lectura solo admin/tecnologia (sgc.es_tecnologia(), PROMPT-1);
-- escritura de checks/alertas por service_role (edge functions).
-- ============================================================================

-- 1) Dominios vigilados --------------------------------------------------------
create table if not exists sgc.monitored_domains (
  id                    uuid primary key default gen_random_uuid(),
  domain                text not null unique,
  registrar             text,
  dns_provider          text,
  expected_mx           jsonb not null default '[]'::jsonb,
  expected_spf_includes text[] not null default '{}',
  dkim_selector         text,
  check_ssl             boolean not null default true,
  is_active             boolean not null default true,
  notes                 text,
  -- denormalizado por el edge para el semáforo del panel
  last_status           text,          -- ok | warning | critical
  last_checked_at       timestamptz,
  rdap_expires_at       date,
  created_at            timestamptz not null default now()
);
comment on table sgc.monitored_domains is 'Y17 — dominios/DNS vigilados (checks DoH+RDAP+SSL). SGC-CSI-MOD-01.';

-- 2) Suscripciones / pagos tecnológicos ---------------------------------------
create table if not exists sgc.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  provider             text,
  category             text,
  renewal_date         date,
  amount               numeric,
  currency             text default 'USD',
  payment_method       text,
  account_owner        text,
  internal_responsible text,
  impact_if_expired    text,
  panel_url            text,
  auto_renew           boolean not null default false,
  payment_ok           boolean not null default true,
  is_active            boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table sgc.subscriptions is 'Y17 — suscripciones/pagos tecnológicos con alertas por fecha de renovación. SGC-CSI-MOD-01.';

-- 3) Histórico de checks -------------------------------------------------------
create table if not exists sgc.domain_checks (
  id            uuid primary key default gen_random_uuid(),
  domain_id     uuid not null references sgc.monitored_domains(id) on delete cascade,
  check_type    text not null check (check_type in
                  ('dns_resolution','rdap_status','mx_records','spf','dkim','ssl','http')),
  status        text not null check (status in ('ok','warning','critical')),
  detail        text,
  raw_response  jsonb,
  checked_at    timestamptz not null default now()
);
create index if not exists idx_domain_checks_domain on sgc.domain_checks (domain_id, checked_at desc);
create index if not exists idx_domain_checks_type on sgc.domain_checks (check_type, checked_at desc);

-- 4) Alertas -------------------------------------------------------------------
create table if not exists sgc.alerts (
  id                uuid primary key default gen_random_uuid(),
  source_type       text not null check (source_type in ('domain','subscription')),
  source_id         uuid not null,
  alert_type        text not null,
  severity          text not null check (severity in ('info','media','alta','critica')),
  message           text not null,
  notified_channels jsonb not null default '[]'::jsonb,
  last_notified_at  timestamptz,
  acknowledged_by   uuid references sgc.usuarios(id) on delete set null,
  acknowledged_at   timestamptz,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_alerts_activas on sgc.alerts (source_type, source_id, alert_type)
  where acknowledged_at is null and resolved_at is null;
create index if not exists idx_alerts_created on sgc.alerts (created_at desc);
comment on table sgc.alerts is 'Y17 — alertas escalonadas persistentes hasta acknowledge. SGC-CSI-MOD-01.';

-- 5) RLS -----------------------------------------------------------------------
alter table sgc.monitored_domains enable row level security;
alter table sgc.subscriptions enable row level security;
alter table sgc.domain_checks enable row level security;
alter table sgc.alerts enable row level security;

-- monitored_domains: lectura + CRUD para tecnologia; escritura de checks por service_role.
drop policy if exists "monitored_domains: tecnologia" on sgc.monitored_domains;
create policy "monitored_domains: tecnologia" on sgc.monitored_domains
  for all to authenticated using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());

drop policy if exists "subscriptions: tecnologia" on sgc.subscriptions;
create policy "subscriptions: tecnologia" on sgc.subscriptions
  for all to authenticated using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());

-- domain_checks: solo lectura para tecnologia (inserta el edge con service_role).
drop policy if exists "domain_checks: read tecnologia" on sgc.domain_checks;
create policy "domain_checks: read tecnologia" on sgc.domain_checks
  for select to authenticated using (sgc.es_tecnologia());

-- alerts: solo lectura para tecnologia (crea/actualiza el edge; ack vía RPC).
drop policy if exists "alerts: read tecnologia" on sgc.alerts;
create policy "alerts: read tecnologia" on sgc.alerts
  for select to authenticated using (sgc.es_tecnologia());

-- 6) Grants (gotcha recurrente) ------------------------------------------------
grant select, insert, update, delete on sgc.monitored_domains, sgc.subscriptions to authenticated;
grant select on sgc.domain_checks, sgc.alerts to authenticated;
grant all on sgc.monitored_domains, sgc.subscriptions, sgc.domain_checks, sgc.alerts to service_role;

-- 7) Seed inicial (idempotente) — notas §3 ------------------------------------
insert into sgc.monitored_domains (domain, registrar, dns_provider, expected_mx, expected_spf_includes, dkim_selector, check_ssl, notes)
select 'constructorasd.com', 'Squarespace', 'Wix (NS10/NS11.WIXDNS.NET)',
  '["aspmx.l.google.com","alt1.aspmx.l.google.com","alt2.aspmx.l.google.com","alt3.aspmx.l.google.com","alt4.aspmx.l.google.com"]'::jsonb,
  array['_spf.google.com'], 'google', true,
  'Dominio principal de la empresa. Incidente 25-jul-2026 (clientHold). Correo Google Workspace.'
where not exists (select 1 from sgc.monitored_domains where domain='constructorasd.com');

insert into sgc.monitored_domains (domain, registrar, dns_provider, expected_mx, expected_spf_includes, dkim_selector, check_ssl, notes)
select 'plantstudiod.com', 'Squarespace', 'por confirmar',
  '["aspmx.l.google.com","alt1.aspmx.l.google.com","alt2.aspmx.l.google.com","alt3.aspmx.l.google.com","alt4.aspmx.l.google.com"]'::jsonb,
  array['_spf.google.com'], 'google', true,
  'PENDIENTE: "Acción necesaria" en Google Admin. Averiguar si alguien usa correo @plantstudiod.com.'
where not exists (select 1 from sgc.monitored_domains where domain='plantstudiod.com');

insert into sgc.subscriptions (name, provider, category, impact_if_expired, panel_url, auto_renew, notes)
select * from (values
  ('Dominio constructorasd.com', 'Squarespace', 'dominio', 'El dominio deja de resolver: web y correo caen (incidente 25-jul).', 'https://account.squarespace.com/domains', false, 'VERIFICAR auto-renew activado + tarjeta corporativa (no la del externo). Renovado hasta 2032 según registro.'),
  ('Web / DNS', 'Wix', 'hosting_dns', 'Se pierde la web y el control de DNS (name servers viven en Wix).', 'https://www.wix.com/account/sites', false, 'Conseguir acceso/co-administración de la cuenta Wix para la empresa.'),
  ('Google Workspace', 'Google', 'correo', 'Se pierde el correo corporativo y Drive.', 'https://admin.google.com/', false, 'Revisar # licencias vs # usuarios y método de pago.'),
  ('Proyecto SGC', 'Supabase', 'backend', 'Se cae la base de datos y las edge functions del SGC.', 'https://supabase.com/dashboard/project/jeeqhgccqefbqilntcpu', true, 'Plan del proyecto SGC.'),
  ('Hosting web SGC', 'Vercel', 'hosting', 'Se cae el frontend del SGC.', 'https://vercel.com/dashboard', true, 'Dominio sgcconstructorasd.com.')
) as v(name, provider, category, impact_if_expired, panel_url, auto_renew, notes)
where not exists (select 1 from sgc.subscriptions s where s.name = v.name and s.provider = v.provider);
