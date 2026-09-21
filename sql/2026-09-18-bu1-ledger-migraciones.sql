-- BU1 F3.1 — Ledger de migraciones / edges / secrets por entorno (regla 18).
-- "Nada llega a producción sin haber vivido en dev": estas tablas son el registro
-- que hace cumplir la regla — `apply-migration.mjs --env prod` rechaza lo que no
-- esté en el ledger de DEV con el mismo checksum (salvo --force-prod --motivo).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-18-bu1-ledger-migraciones.sql --env dev  →  --env prod
-- Rollback: drop table sgc.secrets_aplicados, sgc.edges_desplegadas, sgc.migraciones_aplicadas;
begin;

-- Migraciones SQL aplicadas (una fila por archivo por base de datos).
create table if not exists sgc.migraciones_aplicadas (
  archivo      text primary key,
  checksum     text not null,
  entorno      text not null check (entorno in ('dev','prod')),
  aplicada_en  timestamptz not null default now(),
  aplicada_por text not null,
  forzada      boolean not null default false,
  motivo       text
);

-- Edges desplegadas (checksum del index.ts + _shared importados).
create table if not exists sgc.edges_desplegadas (
  slug           text not null,
  checksum       text not null,
  entorno        text not null check (entorno in ('dev','prod')),
  version        int,
  desplegada_en  timestamptz not null default now(),
  desplegada_por text not null,
  forzada        boolean not null default false,
  motivo         text,
  primary key (slug, checksum, entorno)
);

-- Secrets aplicados (solo el NOMBRE + entorno; nunca el valor).
create table if not exists sgc.secrets_aplicados (
  nombre      text not null,
  entorno     text not null check (entorno in ('dev','prod')),
  aplicado_en timestamptz not null default now(),
  primary key (nombre, entorno)
);

-- RLS: lectura solo para admins autenticados; la escritura la hacen los scripts
-- vía service role / postgres (Management API), que saltan RLS. No hay política
-- de escritura para `authenticated` a propósito.
alter table sgc.migraciones_aplicadas enable row level security;
alter table sgc.edges_desplegadas    enable row level security;
alter table sgc.secrets_aplicados     enable row level security;

drop policy if exists mig_aplicadas_sel on sgc.migraciones_aplicadas;
create policy mig_aplicadas_sel on sgc.migraciones_aplicadas for select to authenticated using (sgc.is_admin());

drop policy if exists edges_desplegadas_sel on sgc.edges_desplegadas;
create policy edges_desplegadas_sel on sgc.edges_desplegadas for select to authenticated using (sgc.is_admin());

drop policy if exists secrets_aplicados_sel on sgc.secrets_aplicados;
create policy secrets_aplicados_sel on sgc.secrets_aplicados for select to authenticated using (sgc.is_admin());

grant select on sgc.migraciones_aplicadas, sgc.edges_desplegadas, sgc.secrets_aplicados to authenticated;
grant select, insert, update, delete on sgc.migraciones_aplicadas, sgc.edges_desplegadas, sgc.secrets_aplicados to service_role;

commit;
