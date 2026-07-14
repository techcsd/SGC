-- ============================================================================
-- Historial de versiones — corrección de fechas y contenido con datos REALES
-- de git (ambos repos). El desarrollo estuvo muy comprimido (2026-06-30 → 07-14),
-- así que se reemplaza el seed inicial por uno alineado a los merges/deploys.
--   - Web renumerado a 8 hitos (v1.0 → v1.7).
--   - Móvil: fechas reales (arrancó 2026-07-08) + se agrega v1.1.0 (Admin+Soporte).
-- Borra e inserta solo filas de seed (la tabla no tiene versiones creadas por el
-- admin todavía). Idempotente. La 1.4.0 móvil sigue SIN publicar.
-- ============================================================================

set search_path = sgc, public;

delete from sgc.app_versiones where plataforma in ('web','movil');

insert into sgc.app_versiones (plataforma, version, fecha, titulo, cambios) values
  -- ── WEB (SGC) — orden ascendente por versión ───────────────────────────
  ('web','1.0','2026-06-30','ERP base', jsonb_build_array(
     'Dashboard con indicadores (KPIs)',
     'Inventario: artículos, bodegas, entradas/salidas y conduces',
     'Solicitudes de material y órdenes de compra',
     'Documentos: plantillas → rellenar → descargar',
     'Proyectos y Administración (usuarios, roles, permisos)')),
  ('web','1.1','2026-07-02','Dashboard real + blindaje de permisos', jsonb_build_array(
     'Dashboard reconstruido con KPIs y gráficas reales',
     'Interconexión del dashboard con Bitácora, Solicitudes y Documentos',
     'Blindaje de permisos (RLS) de todas las tablas del esquema')),
  ('web','1.2','2026-07-07','Módulos nuevos', jsonb_build_array(
     'Legal: expedientes, contratos y aprobaciones',
     'Tareas: asignar y dar seguimiento',
     'Mensajería: chat interno en tiempo real (DMs, grupos, archivos)',
     'RRHH: ausencias/vacaciones y documentos de empleado',
     'Ranking de encargados (KPI) y sección de clima/ubicación',
     'Dominio sgcconstructorasd.com')),
  ('web','1.3','2026-07-12','Reunión 07/07 (A1–A9)', jsonb_build_array(
     'Renombrado Requisición/Almacén y control de material por fase',
     'Alertas antifraude silenciosas',
     'Checklists de Flota; módulo Tecnología; expediente de obra',
     'Dashboard personalizado por rol y almacén por obra')),
  ('web','1.4','2026-07-13','Ejecución de obra (Olas 1–3)', jsonb_build_array(
     'Centro de notificaciones',
     'Mapeo de kit de materiales (kit ↔ artículos)',
     'Registro de vaciados y No Conformidades (CSD-OPE-01)',
     'Checklists de Liberación (CL-01..07) con ciclo de firmas')),
  ('web','1.5','2026-07-14','Flota v2', jsonb_build_array(
     'Pre-uso v2: checklist de 33 puntos con veredicto y fotos',
     'Combustible v2: galones, rendimiento y consumo',
     'Panel del día, avisos de flota y dashboard de combustible',
     'Mantenimiento por kilometraje y correos automáticos')),
  ('web','1.6','2026-07-14','Mejoras reunión 14/07 (R1–R29)', jsonb_build_array(
     'Multi-asignación de vehículos + perfiles de vehículo y conductor',
     'Reporte semanal + tablero de cumplimiento',
     'Inventario por categorías (destacadas) + stepper + homologación de texto',
     'Arreglo del PDF de conduces',
     'Partidas de obra + métrica % pagado vs trabajado',
     'Bitácora: lluvia, migración, cantidades y descripción de incidente',
     'Versionado por etapas, roles nuevos y guías visuales en Dudas',
     'Fotos en los reportes de usuario')),
  ('web','1.7','2026-07-14','Reporte semanal v2 + resumen de inventario', jsonb_build_array(
     'Plantilla oficial del reporte semanal (9 preguntas por sección)',
     'Paso de resumen/review editable antes de confirmar en salidas y entradas',
     'Historial de versiones (esta línea de tiempo)')),
  -- ── APP MÓVIL (csd-app) — orden ascendente por versión ─────────────────
  ('movil','1.0.0','2026-07-08','Fundaciones', jsonb_build_array(
     'Inicio de sesión + PIN y re-bloqueo al volver del fondo',
     'Motor sin conexión (cola de sincronización)',
     'Diseño para campo (botones grandes) e instalable como PWA',
     'Inicio con accesos por módulo; listas de materiales seleccionables',
     'Conteo rápido de inventario y avisos de incidentes por correo')),
  ('movil','1.1.0','2026-07-11','Administración + Soporte en la app', jsonb_build_array(
     'Secciones de Administración y Soporte dentro de la app',
     'Catálogos de bitácora gestionados e historial de conteos',
     'Unidades de medida y reporte de problemas')),
  ('movil','1.1.3','2026-07-11','Onboarding + pulido', jsonb_build_array(
     'Tour guiado en el inicio (reproducible desde Soporte)',
     'Esqueletos de carga y confirmación al cerrar sesión',
     'Rastro de auditoría')),
  ('movil','1.2.0','2026-07-12','Mantenimiento + rutas', jsonb_build_array(
     'Reportar mantenimiento por vehículo (con fotos, sin conexión)',
     'Rutas de hoy con "cómo llegar" (abre el mapa del teléfono)')),
  ('movil','1.2.1','2026-07-13','Reportar problema', jsonb_build_array(
     'Reporte de cualquier incidencia/mejora desde la app')),
  ('movil','1.2.2','2026-07-13','Estabilidad', jsonb_build_array(
     'Arreglos de firma, reintentos de sincronización y desplazamiento',
     'Ajustes de pantalla (notch, alturas, orientación)')),
  ('movil','1.3.0','2026-07-14','Flota v2', jsonb_build_array(
     'Pre-uso v2: niveles, 7 fotos guiadas, veredicto y PDF para compartir',
     'Combustible v2: galones + 2 fotos + cálculo en vivo',
     'Checklist de Liberación (CL-01..07) con firmas')),
  ('movil','1.3.1','2026-07-14','Ajustes Flota v2', jsonb_build_array(
     'Base de kilometraje de combustible sin conexión',
     'Bloqueo de firma en pre-uso')),
  ('movil','1.3.2','2026-07-14','Seguridad del conductor', jsonb_build_array(
     'Bloqueo si no estás autorizado para la clase del vehículo',
     'Umbrales de Flota configurables')),
  ('movil','1.4.0','2026-07-14','Mejoras 14/07 + Inventario por hojas', jsonb_build_array(
     'Auto-asignarte un vehículo + auto-registro de conductor',
     'Reporte semanal y creación de rutas desde el móvil',
     'Desbloqueo con huella / Face ID',
     'Pantallas vacías con acción (nunca callejones sin salida)',
     'Inventario por categorías + stepper + gestión de almacenes',
     'Bitácora: lluvia, migración y cantidades',
     'Perfiles de vehículo y conductor + versionado por etapas',
     'Inventario por HOJAS: categorías → resumen → éxito con compartir por WhatsApp',
     'Reporte semanal v2: preguntas oficiales agrupadas por sección'));
