-- ============================================================================
-- PROMPT-40 (BM) FASE 2 — BM4 (generalizado): grants explícitos de las sobrecargas
-- VIVAS de RPCs que el cliente llama y que hoy sólo son ejecutables por el
-- EXECUTE TO PUBLIC por defecto de Postgres.  Ronda 09/09/2026.  Idempotente.
--
-- RAÍZ: el auditor nuevo (scripts/audit-rpc-grants.mjs) + verificación contra
-- pg_proc en prod (09-sep) halló que la sobrecarga viva de estas RPCs NO tiene un
-- `grant execute ... to authenticated` en sql/ para su aridad actual (o no lo tiene
-- en absoluto — el grant vive fuera de sql/ o del PUBLIC por defecto).  Si ese
-- PUBLIC se revoca → 42501 permission denied for function → la app lo pinta
-- "Problema del sistema" en el intento 1 (exactamente el síntoma de BM1).  Este es
-- el mismo hueco que registrar_combustible_app(20) (BM1), replicado.
--
-- Las firmas se copian VERBATIM de pg_get_function_identity_arguments (prod) — así
-- el grant apunta a la sobrecarga que existe, sin riesgo de transcripción.  Grant es
-- idempotente: re-otorgar uno existente es no-op; otorgar el que falta lo añade.
--
-- registrar_combustible_app(20) NO va aquí: su grant ya está en el archivo BM1.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-09-bm4-grants-rpcs-vivas.sql
-- ============================================================================

begin;

-- Bitácora de obra (app) — la sobrecarga de 41 args (la más nueva, +p_horas_lluvia)
-- no tenía authenticated en prod (la de 36 sí).
grant execute on function sgc.crear_bitacora_app(
  p_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text, p_comentarios text,
  p_personal_carpinteria smallint, p_personal_acero smallint, p_trabajadores_casa smallint,
  p_otro_personal text, p_actividades jsonb, p_restricciones jsonb, p_incidente_tipo text,
  p_incidente_gravedad text, p_incidente_lesionados smallint, p_incidente_descripcion text,
  p_incidente_acciones text, p_fotos jsonb, p_capturado_en timestamp with time zone,
  p_llovio boolean, p_lluvia_detalle text, p_hubo_migracion boolean, p_migracion_obreros jsonb,
  p_hubo_equipos boolean, p_equipos_alquilados jsonb, p_bloque_entrepiso text,
  p_ingeniero_responsable text, p_hora_fin_trabajo time without time zone,
  p_incidente_subcontratista text, p_visita_tipo_visitante text, p_visita_nombre text,
  p_visita_organizacion text, p_visita_motivo text, p_incidente_equipo_nombre text,
  p_incidente_equipo_alquilado boolean, p_incidente_equipo_operativo boolean,
  p_incidente_suceso text, p_incidente_equipo_operativo_comentario text, p_sin_actividad boolean,
  p_motivo_sin_actividad text, p_motivo_sin_actividad_detalle text, p_horas_lluvia numeric
) to authenticated, service_role;

-- Entrega/handover de vehículo (app) — 13 args, sin authenticated en prod.
grant execute on function sgc.crear_entrega_vehiculo(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_km numeric, p_combustible text,
  p_tiene_danos boolean, p_danos jsonb, p_firma_url text, p_fotos jsonb, p_gps jsonb,
  p_capturado_en timestamp with time zone, p_observacion text, p_forzar_handover boolean
) to authenticated, service_role;

-- Salida de inventario (app) — 8 args.
grant execute on function sgc.registrar_salida_inventario(
  p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text,
  p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb
) to authenticated, service_role;

-- Recepción de conduce (app) — 4 args.
grant execute on function sgc.recibir_conduce_app(
  p_salida_id uuid, p_items jsonb, p_notas text, p_foto_path text
) to authenticated, service_role;

-- Solicitud de material (app) — 5 args.
grant execute on function sgc.crear_solicitud_app(
  p_id uuid, p_proyecto_id uuid, p_urgencia text, p_notas text, p_items jsonb
) to authenticated, service_role;

-- Notificar a un módulo — 7 args (la app la llama desde cl-liberacion.service).
grant execute on function sgc.notificar_modulo(
  p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text,
  p_referencia_id uuid, p_referencia_tipo text
) to authenticated, service_role;

-- Incentivo — listado (3 args, +p_incluir_prueba) y penalización (3 args).
grant execute on function sgc.incentivo_listado(
  p_anio integer, p_semana integer, p_incluir_prueba boolean
) to authenticated, service_role;

grant execute on function sgc.incentivo_set_penalizacion(
  p_gracia_dias integer, p_pts_dia numeric, p_tope numeric
) to authenticated, service_role;

commit;
