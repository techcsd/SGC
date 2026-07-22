-- ============================================================================
-- Actualización 4 — T9: catálogo administrable de motivos de multa.
-- ----------------------------------------------------------------------------
-- conductor_multas.motivo sigue siendo texto (retrocompatible); la UI ofrece un
-- desplegable desde este catálogo + "Otro" (texto libre). Idempotente.
-- ============================================================================

set search_path = sgc, public;

create table if not exists sgc.motivos_multa (
  id     integer generated always as identity primary key,
  nombre text not null unique,
  orden  integer not null default 100,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into sgc.motivos_multa (nombre, orden) values
  ('Exceso de velocidad', 1), ('Estacionamiento indebido', 2), ('Luz roja', 3),
  ('Documentación vencida', 4), ('Giro indebido', 5), ('Celular al conducir', 6), ('Otro', 99)
on conflict (nombre) do nothing;

alter table sgc.motivos_multa enable row level security;
drop policy if exists "motivos_multa: select" on sgc.motivos_multa;
create policy "motivos_multa: select" on sgc.motivos_multa for select to authenticated using (true);
drop policy if exists "motivos_multa: admin" on sgc.motivos_multa;
create policy "motivos_multa: admin" on sgc.motivos_multa for all to authenticated
  using (sgc.is_admin() or sgc.es_flota_elevado())
  with check (sgc.is_admin() or sgc.es_flota_elevado());

grant select on sgc.motivos_multa to authenticated, service_role;
grant insert, update, delete on sgc.motivos_multa to authenticated, service_role;
