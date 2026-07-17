-- ============================================================================
-- Ronda 17/07/2026 — C3: nota + tags del conductor
-- ----------------------------------------------------------------------------
-- Columnas aditivas: nota (texto libre) y tags (text[]). Retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- tags nullable (no NOT NULL): el front envía null cuando no hay tags, así que
-- una restricción NOT NULL rompería el insert/update.
alter table sgc.conductores
  add column if not exists nota text,
  add column if not exists tags text[];

-- Índice GIN para poder filtrar por tag más adelante (dashboard/app).
create index if not exists idx_conductores_tags on sgc.conductores using gin (tags);
