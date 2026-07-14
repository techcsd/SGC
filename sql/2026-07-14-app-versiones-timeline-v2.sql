-- ============================================================================
-- Historial de versiones v2 — cambios etiquetados + enlaces por versión
-- ----------------------------------------------------------------------------
-- Mejora el timeline (research de changelogs: "Keep a Changelog" + timelines SaaS):
--   - cambios pasa de array de strings a array de objetos {t, d}:
--       t = etiqueta ('nuevo'|'mejora'|'arreglo'|'seguridad'), d = descripción.
--   - `url` (nuevo): enlace por versión.
--       · web   → URL inmutable del deploy Vercel de esa versión (navegable por admin).
--       · móvil → se usa apk_url (bucket app-releases) para descargar ese APK.
-- Móvil: apk_url para las 10 versiones (todas existen en el bucket).
-- Web: url para las 4 versiones recientes mapeables a su deploy; las viejas quedan
--   sin enlace (se aplicará hacia adelante, como acordado).
-- Borra e inserta solo filas de seed. Idempotente. 1.4.0 móvil sigue sin publicar.
-- ============================================================================

set search_path = sgc, public;

alter table sgc.app_versiones add column if not exists url text;

delete from sgc.app_versiones where plataforma in ('web','movil');

-- Base pública del bucket de APKs.
-- https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-<v>.apk

insert into sgc.app_versiones (plataforma, version, fecha, titulo, url, apk_url, cambios) values
  -- ── WEB (SGC) ──────────────────────────────────────────────────────────
  ('web','1.0','2026-06-30','ERP base', null, null, '[
     {"t":"nuevo","d":"Dashboard con indicadores (KPIs)"},
     {"t":"nuevo","d":"Inventario: artículos, bodegas, entradas/salidas y conduces"},
     {"t":"nuevo","d":"Solicitudes de material y órdenes de compra"},
     {"t":"nuevo","d":"Documentos: plantillas → rellenar → descargar"},
     {"t":"nuevo","d":"Proyectos y Administración (usuarios, roles, permisos)"}]'::jsonb),
  ('web','1.1','2026-07-02','Dashboard real + blindaje de permisos', null, null, '[
     {"t":"mejora","d":"Dashboard reconstruido con KPIs y gráficas reales"},
     {"t":"mejora","d":"Interconexión del dashboard con Bitácora, Solicitudes y Documentos"},
     {"t":"seguridad","d":"Blindaje de permisos (RLS) de todas las tablas del esquema"}]'::jsonb),
  ('web','1.2','2026-07-07','Módulos nuevos', null, null, '[
     {"t":"nuevo","d":"Legal: expedientes, contratos y aprobaciones"},
     {"t":"nuevo","d":"Tareas: asignar y dar seguimiento"},
     {"t":"nuevo","d":"Mensajería: chat interno en tiempo real (DMs, grupos, archivos)"},
     {"t":"nuevo","d":"RRHH: ausencias/vacaciones y documentos de empleado"},
     {"t":"nuevo","d":"Ranking de encargados (KPI) y sección de clima/ubicación"},
     {"t":"nuevo","d":"Dominio sgcconstructorasd.com"}]'::jsonb),
  ('web','1.3','2026-07-12','Reunión 07/07 (A1–A9)', null, null, '[
     {"t":"mejora","d":"Renombrado Requisición/Almacén y control de material por fase"},
     {"t":"seguridad","d":"Alertas antifraude silenciosas"},
     {"t":"nuevo","d":"Checklists de Flota, módulo Tecnología y expediente de obra"},
     {"t":"nuevo","d":"Dashboard personalizado por rol y almacén por obra"}]'::jsonb),
  ('web','1.4','2026-07-13','Ejecución de obra (Olas 1–3)', 'https://sgc-n8pawnu5v-xaviel-csd.vercel.app', null, '[
     {"t":"nuevo","d":"Centro de notificaciones"},
     {"t":"nuevo","d":"Mapeo de kit de materiales (kit ↔ artículos)"},
     {"t":"nuevo","d":"Registro de vaciados y No Conformidades (CSD-OPE-01)"},
     {"t":"nuevo","d":"Checklists de Liberación (CL-01..07) con ciclo de firmas"}]'::jsonb),
  ('web','1.5','2026-07-14','Flota v2', 'https://sgc-k83pc70ee-xaviel-csd.vercel.app', null, '[
     {"t":"nuevo","d":"Pre-uso v2: checklist de 33 puntos con veredicto y fotos"},
     {"t":"nuevo","d":"Combustible v2: galones, rendimiento y consumo"},
     {"t":"nuevo","d":"Panel del día, avisos de flota y dashboard de combustible"},
     {"t":"nuevo","d":"Mantenimiento por kilometraje y correos automáticos"}]'::jsonb),
  ('web','1.6','2026-07-14','Mejoras reunión 14/07 (R1–R29)', 'https://sgc-c6743yysp-xaviel-csd.vercel.app', null, '[
     {"t":"nuevo","d":"Multi-asignación de vehículos + perfiles de vehículo y conductor"},
     {"t":"nuevo","d":"Reporte semanal + tablero de cumplimiento"},
     {"t":"mejora","d":"Inventario por categorías (destacadas) + stepper + homologación de texto"},
     {"t":"arreglo","d":"Arreglo del PDF de conduces"},
     {"t":"nuevo","d":"Partidas de obra + métrica % pagado vs trabajado"},
     {"t":"nuevo","d":"Bitácora: lluvia, migración, cantidades y descripción de incidente"},
     {"t":"nuevo","d":"Versionado por etapas, roles nuevos y guías visuales en Dudas"},
     {"t":"nuevo","d":"Fotos en los reportes de usuario"}]'::jsonb),
  ('web','1.7','2026-07-14','Reporte semanal v2 + resumen de inventario', 'https://sgc-rjqfuz6fq-xaviel-csd.vercel.app', null, '[
     {"t":"mejora","d":"Plantilla oficial del reporte semanal (9 preguntas por sección)"},
     {"t":"nuevo","d":"Paso de resumen/review editable antes de confirmar en salidas y entradas"},
     {"t":"nuevo","d":"Historial de versiones (esta línea de tiempo)"}]'::jsonb),
  -- ── APP MÓVIL (csd-app) — apk_url a cada versión del bucket ─────────────
  ('movil','1.0.0','2026-07-08','Fundaciones', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.0.0.apk', '[
     {"t":"nuevo","d":"Inicio de sesión + PIN y re-bloqueo al volver del fondo"},
     {"t":"nuevo","d":"Motor sin conexión (cola de sincronización)"},
     {"t":"nuevo","d":"Diseño para campo (botones grandes) e instalable como PWA"},
     {"t":"nuevo","d":"Inicio con accesos por módulo; listas de materiales seleccionables"},
     {"t":"nuevo","d":"Conteo rápido de inventario y avisos de incidentes por correo"}]'::jsonb),
  ('movil','1.1.0','2026-07-11','Administración + Soporte en la app', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.1.0.apk', '[
     {"t":"nuevo","d":"Secciones de Administración y Soporte dentro de la app"},
     {"t":"nuevo","d":"Catálogos de bitácora gestionados e historial de conteos"},
     {"t":"nuevo","d":"Unidades de medida y reporte de problemas"}]'::jsonb),
  ('movil','1.1.3','2026-07-11','Onboarding + pulido', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.1.3.apk', '[
     {"t":"nuevo","d":"Tour guiado en el inicio (reproducible desde Soporte)"},
     {"t":"mejora","d":"Esqueletos de carga y confirmación al cerrar sesión"},
     {"t":"nuevo","d":"Rastro de auditoría"}]'::jsonb),
  ('movil','1.2.0','2026-07-12','Mantenimiento + rutas', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.2.0.apk', '[
     {"t":"nuevo","d":"Reportar mantenimiento por vehículo (con fotos, sin conexión)"},
     {"t":"nuevo","d":"Rutas de hoy con cómo llegar (abre el mapa del teléfono)"}]'::jsonb),
  ('movil','1.2.1','2026-07-13','Reportar problema', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.2.1.apk', '[
     {"t":"nuevo","d":"Reporte de cualquier incidencia/mejora desde la app"}]'::jsonb),
  ('movil','1.2.2','2026-07-13','Estabilidad', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.2.2.apk', '[
     {"t":"arreglo","d":"Arreglos de firma, reintentos de sincronización y desplazamiento"},
     {"t":"arreglo","d":"Ajustes de pantalla (notch, alturas, orientación)"}]'::jsonb),
  ('movil','1.3.0','2026-07-14','Flota v2', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.3.0.apk', '[
     {"t":"nuevo","d":"Pre-uso v2: niveles, 7 fotos guiadas, veredicto y PDF para compartir"},
     {"t":"nuevo","d":"Combustible v2: galones + 2 fotos + cálculo en vivo"},
     {"t":"nuevo","d":"Checklist de Liberación (CL-01..07) con firmas"}]'::jsonb),
  ('movil','1.3.1','2026-07-14','Ajustes Flota v2', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.3.1.apk', '[
     {"t":"arreglo","d":"Base de kilometraje de combustible sin conexión"},
     {"t":"arreglo","d":"Bloqueo de firma en pre-uso"}]'::jsonb),
  ('movil','1.3.2','2026-07-14','Seguridad del conductor', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.3.2.apk', '[
     {"t":"seguridad","d":"Bloqueo si no estás autorizado para la clase del vehículo"},
     {"t":"mejora","d":"Umbrales de Flota configurables"}]'::jsonb),
  ('movil','1.4.0','2026-07-14','Mejoras 14/07 + Inventario por hojas', null,
     'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/csd-app-1.4.0.apk', '[
     {"t":"nuevo","d":"Auto-asignarte un vehículo + auto-registro de conductor"},
     {"t":"nuevo","d":"Reporte semanal y creación de rutas desde el móvil"},
     {"t":"nuevo","d":"Desbloqueo con huella / Face ID"},
     {"t":"mejora","d":"Pantallas vacías con acción (nunca callejones sin salida)"},
     {"t":"mejora","d":"Inventario por categorías + stepper + gestión de almacenes"},
     {"t":"nuevo","d":"Bitácora: lluvia, migración y cantidades"},
     {"t":"nuevo","d":"Perfiles de vehículo y conductor + versionado por etapas"},
     {"t":"nuevo","d":"Inventario por HOJAS: categorías → resumen → éxito con compartir por WhatsApp"},
     {"t":"mejora","d":"Reporte semanal v2: preguntas oficiales agrupadas por sección"}]'::jsonb);
