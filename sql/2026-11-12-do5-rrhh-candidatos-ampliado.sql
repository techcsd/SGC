-- 2026-11-12-do5-rrhh-candidatos-ampliado.sql
-- Ronda DO (DO4/DO4b/DO8, DO-05/DO-06/DO-07) — Reclutamiento: más datos de intake,
-- CV leído por IA, y archivado en vez de borrado físico. Todo aditivo sobre
-- sgc.rrhh_candidatos (DN-27 P1, sql/2026-11-11-dn27-rrhh-p1-onboarding.sql).
--   node scripts/apply-migration.mjs sql/2026-11-12-do5-rrhh-candidatos-ampliado.sql --env dev

begin;

-- ── DO-05 — más campos de intake ───────────────────────────────────────────────────
alter table sgc.rrhh_candidatos add column if not exists experiencia_resumen text;
alter table sgc.rrhh_candidatos add column if not exists educacion text;
alter table sgc.rrhh_candidatos add column if not exists expectativa_salarial numeric;
alter table sgc.rrhh_candidatos add column if not exists fuente text;
alter table sgc.rrhh_candidatos add column if not exists telefono_alterno text;

-- ── DO-06 — CV leído por IA (edge function propia, no expuesto a Compa/MCP) ────────
alter table sgc.rrhh_candidatos add column if not exists cv_extraido jsonb;

-- ── DO-07 — archivado en vez de borrado físico ─────────────────────────────────────
alter table sgc.rrhh_candidatos add column if not exists archivado boolean not null default false;
alter table sgc.rrhh_candidatos add column if not exists archivado_en timestamptz;
alter table sgc.rrhh_candidatos add column if not exists archivado_por uuid references sgc.usuarios(id);

-- El borrado físico real (detrás de confirmación explícita, para limpiar registros
-- de prueba) necesita policy/grant de DELETE — la migración DN-27 nunca los creó,
-- así que eliminarCandidato() fallaba por RLS para todo el mundo hasta hoy.
drop policy if exists rrhh_candidatos_del on sgc.rrhh_candidatos;
create policy rrhh_candidatos_del on sgc.rrhh_candidatos for delete using (sgc.puede_operar_submodulo('rrhh.onboarding'));
grant delete on sgc.rrhh_candidatos to authenticated;

commit;
