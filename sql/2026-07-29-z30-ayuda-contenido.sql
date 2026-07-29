-- ============================================================================
-- Z30 — Contenido de ayuda ("Dudas" + "Guías visuales") en BD compartida
-- PROMPT-7 · FASE 5 · ADITIVO
-- ============================================================================
-- Mueve el contenido hoy hardcodeado en la web (dudas-content.ts) a una tabla
-- que consumen web y app SIN duplicar a mano. El filtrado por módulo/rol se
-- mantiene en cliente (igual que hoy). Seed idempotente por (tipo, slug).
-- ============================================================================
create table if not exists sgc.ayuda_contenido (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('guia','duda_categoria')),
  slug       text not null,                 -- id original (guia.id / categoria.id)
  contenido  jsonb not null,                -- mismo shape que GuiaVisual / DudaCategoria
  modulo     text,                          -- gating opcional por módulo
  solo_admin boolean not null default false,
  orden      int not null default 100,
  activo     boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_ayuda_contenido_tipo_slug
  on sgc.ayuda_contenido (tipo, slug);

alter table sgc.ayuda_contenido enable row level security;
drop policy if exists "ayuda_contenido: read" on sgc.ayuda_contenido;
create policy "ayuda_contenido: read" on sgc.ayuda_contenido
  for select to authenticated using (true);  -- filtrado por módulo/rol en cliente
drop policy if exists "ayuda_contenido: write tecnologia" on sgc.ayuda_contenido;
create policy "ayuda_contenido: write tecnologia" on sgc.ayuda_contenido
  for all to authenticated
  using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());
grant select, insert, update, delete on sgc.ayuda_contenido to authenticated;
grant all on sgc.ayuda_contenido to service_role;

-- El seed (desde dudas-content.ts) corre por script: scripts/seed-ayuda.mjs
-- (upsert por tipo+slug). Ver PROMPT-7-PENDIENTES-SGC.md.
