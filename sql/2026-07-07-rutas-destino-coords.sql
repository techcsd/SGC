-- ─────────────────────────────────────────────────────────────────────────────
-- Intelligent Context System — weather at route destination (Flota)
--
-- Rutas currently store origen/destino as free text with no coordinates, so the
-- context system can't show destination weather. Add provider-independent
-- destination coordinates, plus an optional link to the destination obra
-- (proyecto) — the common case for a construction company is transport to a site,
-- and reusing proyecto.latitud/longitud keeps one source of truth for that point.
-- ─────────────────────────────────────────────────────────────────────────────

alter table sgc.rutas
  add column if not exists destino_lat         numeric(9,6),
  add column if not exists destino_lng         numeric(9,6),
  add column if not exists destino_proyecto_id uuid references sgc.proyectos(id) on delete set null;

create index if not exists rutas_destino_proyecto_idx
  on sgc.rutas (destino_proyecto_id);
