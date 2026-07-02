-- Data-integrity hardening from a full app audit: DB-level backstops for
-- values that had no CHECK/NOT NULL despite the frontend already treating
-- them as constrained. These are a second line of defense — the frontend
-- fixes shipped alongside this file are the first — so a bad value can
-- never land in the table even via a raw API call or a future bug.
--
-- Deliberately NOT constraining sgc.proyecto_empleados.rol or
-- sgc.solicitud_material_items.unidad to a fixed enum, despite being
-- flagged by the audit: both are genuinely free-text by design (job
-- title on a team, and a material's unit of measure varies too much to
-- enumerate) — the frontend renders them as plain text inputs, not
-- selects, so a CHECK here would just break real usage.

-- rutas: estado has no enum CHECK despite only 4 real values existing
-- in the frontend (RutaEstado); km/tiempo columns have no non-negative
-- check despite representing physical distances/durations.
alter table sgc.rutas
  add constraint rutas_estado_check check (estado in ('planificada', 'en_curso', 'completada', 'cancelada')),
  add constraint rutas_km_estimado_check check (km_estimado is null or km_estimado >= 0),
  add constraint rutas_km_real_check check (km_real is null or km_real >= 0),
  add constraint rutas_tiempo_estimado_check check (tiempo_estimado_min is null or tiempo_estimado_min >= 0),
  add constraint rutas_tiempo_real_check check (tiempo_real_min is null or tiempo_real_min >= 0);

-- bitacora_archivos: a negative file size is meaningless.
alter table sgc.bitacora_archivos
  add constraint bitacora_archivos_tamano_check check (tamano_bytes is null or tamano_bytes >= 0);

-- Audit-trail columns on documents that are always populated by the
-- frontend today (verified 0 existing NULLs) — enforce it at the DB
-- level so a future bug fails loudly instead of silently orphaning a
-- legal/financial document with no recorded author.
alter table sgc.documentos_generados alter column generado_por set not null;
alter table sgc.documentos_proyecto alter column subido_por set not null;
