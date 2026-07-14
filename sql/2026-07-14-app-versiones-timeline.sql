-- ============================================================================
-- Historial de versiones (línea de tiempo) — web + app móvil
-- ----------------------------------------------------------------------------
-- Extiende sgc.app_versiones (R15) para que sirva de changelog/timeline por
-- plataforma, visible solo para admin en SGC web y en la app móvil.
--   + plataforma ('web'|'movil'), fecha, titulo, cambios (jsonb: array de strings)
--   + unique (plataforma, version) para seed idempotente
--   version_publicada() ahora filtra plataforma='movil' (el gate de rollout es
--   solo de la app móvil; las filas 'web' son informativas y no lo afectan).
-- Aditivo/retrocompatible. Idempotente.
--
-- Nota de fechas: las de la semana del 07–14/07/2026 son exactas; las de los
-- primeros hitos son aproximadas (no había versionado formal al inicio).
-- ============================================================================

set search_path = sgc, public;

alter table sgc.app_versiones
  add column if not exists plataforma text not null default 'movil',
  add column if not exists fecha      date,
  add column if not exists titulo     text,
  add column if not exists cambios    jsonb not null default '[]'::jsonb;

do $$ begin
  alter table sgc.app_versiones
    add constraint app_versiones_plataforma_chk check (plataforma in ('web','movil'));
exception when duplicate_object then null; end $$;

create unique index if not exists uq_app_versiones_plat_ver
  on sgc.app_versiones(plataforma, version);

-- El gate de rollout (versión publicada/mínima) es exclusivo de la app móvil.
create or replace function sgc.version_publicada()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $$
  select jsonb_build_object(
    'version_publicada', (select version from sgc.app_versiones where publicada and plataforma='movil'
                            order by coalesce(publicada_at, created_at) desc limit 1),
    'notas',             (select notas   from sgc.app_versiones where publicada and plataforma='movil'
                            order by coalesce(publicada_at, created_at) desc limit 1),
    'apk_url',           (select apk_url from sgc.app_versiones where publicada and plataforma='movil'
                            order by coalesce(publicada_at, created_at) desc limit 1),
    'version_minima',    (select version from sgc.app_versiones where minima and plataforma='movil'
                            order by coalesce(publicada_at, created_at) desc limit 1)
  );
$$;
grant execute on function sgc.version_publicada() to authenticated, service_role;

-- ── Seed del historial (idempotente por plataforma+version) ─────────────────
-- Refresca solo el contenido (titulo/fecha/cambios); no toca publicada/minima.
insert into sgc.app_versiones (plataforma, version, fecha, titulo, cambios) values
  -- ── WEB (SGC) ──────────────────────────────────────────────────────────
  ('web','1.0','2026-06-20','ERP base', jsonb_build_array(
     'Dashboard con indicadores (KPIs)',
     'Inventario: artículos, bodegas, entradas/salidas y conduces',
     'Solicitudes de material y órdenes de compra',
     'Documentos: plantillas → rellenar → descargar',
     'Proyectos y Administración (usuarios, roles, permisos)')),
  ('web','1.1','2026-07-02','Módulos nuevos + seguridad', jsonb_build_array(
     'Legal: expedientes, contratos y aprobaciones',
     'Tareas: asignar y dar seguimiento',
     'Mensajería: chat interno en tiempo real',
     'RRHH: empleados, asistencia y ausencias/vacaciones',
     'Ranking de encargados (KPI)',
     'Blindaje de permisos (RLS) de todo el esquema y dominio sgcconstructorasd.com')),
  ('web','1.2','2026-07-07','Reunión 07/07 (A1–A9)', jsonb_build_array(
     'Renombrado Requisición/Almacén',
     'Control de material por fase de obra',
     'Alertas antifraude silenciosas',
     'Checklists de Flota',
     'Módulo Tecnología y expediente de obra')),
  ('web','1.3','2026-07-11','Ejecución de obra (Olas 1–3)', jsonb_build_array(
     'Centro de notificaciones',
     'Mapeo de kit de materiales',
     'Ejecución de obra con vaciados y No Conformidades',
     'Checklists de Liberación (CL-01..07) con ciclo de firmas',
     'Endurecimiento de permisos del cuadre')),
  ('web','1.4','2026-07-13','Flota v2', jsonb_build_array(
     'Pre-uso v2: checklist de 33 puntos con veredicto y fotos',
     'Combustible v2: galones, rendimiento y consumo',
     'Dashboards de flotilla y avisos de flota',
     'Mantenimiento por kilometraje',
     'Correos automáticos de eventos de flota')),
  ('web','1.5','2026-07-14','Mejoras reunión 14/07 (R1–R29)', jsonb_build_array(
     'Multi-asignación de vehículos + perfiles de vehículo y conductor',
     'Reporte semanal + tablero de cumplimiento',
     'Inventario por categorías (destacadas) + stepper + homologación de texto',
     'Arreglo del PDF de conduces',
     'Partidas de obra + métrica % pagado vs trabajado',
     'Bitácora: lluvia, migración, cantidades y descripción de incidente',
     'Versionado por etapas, roles nuevos y guías visuales en Dudas',
     'Fotos en los reportes de usuario')),
  ('web','1.6','2026-07-14','Reporte semanal v2 + resumen de inventario', jsonb_build_array(
     'Plantilla oficial del reporte semanal (9 preguntas por sección)',
     'Paso de resumen/review editable antes de confirmar en salidas y entradas',
     'Historial de versiones (esta línea de tiempo)')),
  -- ── APP MÓVIL (csd-app) ────────────────────────────────────────────────
  ('movil','1.0.0','2026-06-25','Fundaciones', jsonb_build_array(
     'Inicio de sesión + PIN',
     'Motor sin conexión (cola de sincronización)',
     'Diseño para campo (botones grandes) e instalable como PWA',
     'Inicio con accesos por módulo',
     'Listas de materiales seleccionables y bitácora')),
  ('movil','1.1.3','2026-07-05','Onboarding + pulido', jsonb_build_array(
     'Tour guiado en el inicio (reproducible desde Soporte)',
     'Esqueletos de carga y confirmación al cerrar sesión',
     'Rastro de auditoría')),
  ('movil','1.2.0','2026-07-11','Mantenimiento + rutas', jsonb_build_array(
     'Reportar mantenimiento por vehículo (sin conexión)',
     'Rutas de hoy con "cómo llegar" (abre el mapa del teléfono)')),
  ('movil','1.2.1','2026-07-11','Reportar problema', jsonb_build_array(
     'Reporte de cualquier incidencia desde la app')),
  ('movil','1.2.2','2026-07-12','Estabilidad', jsonb_build_array(
     'Arreglos de firma, reintentos de sincronización y desplazamiento',
     'Ajustes de pantalla (notch, alturas)')),
  ('movil','1.3.0','2026-07-13','Flota v2', jsonb_build_array(
     'Pre-uso v2: niveles, 7 fotos guiadas, veredicto y PDF para compartir',
     'Combustible v2: galones + 2 fotos + cálculo en vivo',
     'Checklist de Liberación (CL-01..07) con firmas')),
  ('movil','1.3.1','2026-07-13','Ajustes Flota v2', jsonb_build_array(
     'Base de kilometraje de combustible sin conexión',
     'Bloqueo de firma en pre-uso')),
  ('movil','1.3.2','2026-07-13','Seguridad del conductor', jsonb_build_array(
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
     'Reporte semanal v2: preguntas oficiales agrupadas por sección'))
on conflict (plataforma, version) do update set
  fecha   = excluded.fecha,
  titulo  = excluded.titulo,
  cambios = excluded.cambios;
