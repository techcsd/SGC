// BK5 — Catálogo de parámetros de configuración del sistema.
//
// Fuente única de metadatos (descripción, tipo, validación, grupo y TABLA de
// origen) para las dos tablas clave/valor que hoy existen:
//   • sgc.parametros    — umbrales/roles generales (se editan con UPDATE directo).
//   • sgc.flota_config  — umbrales de flota/combustible (se editan por el RPC
//                         set_flota_config, gate admin/flota).
//
// La pantalla admin/parametros usa este catálogo para MOSTRAR ambas tablas en un
// solo lugar, agrupadas, con el input y la validación correctos por clave. Una
// clave que no esté aquí igual se muestra (fuente inferida por si viene de
// flota_config), como texto libre — pero lo suyo es catalogarla.

export type ParamTipo = 'entero' | 'decimal' | 'bool' | 'csv' | 'texto';
export type ParamFuente = 'parametros' | 'flota';

export interface ParamMeta {
  descripcion: string;
  tipo: ParamTipo;
  grupo: string;
  fuente: ParamFuente;
  min?: number;
  max?: number;
}

// Grupos en el orden en que se pintan.
export const PARAM_GRUPOS: string[] = [
  'Cuadre / antifraude',
  'Combustible',
  'Rendimiento',
  'Capacidad de tanque',
  'GPS / tracking',
  'Estado del conductor',
  'Vencimientos',
  'Roles y permisos',
  'Notificaciones',
  'Flags de funciones',
  'Integraciones',
  'Otros',
];

export const PARAM_CATALOGO: Record<string, ParamMeta> = {
  // ── Cuadre / antifraude (parametros) ──────────────────────────────────────
  alerta_cuadre_umbral_advertencia: { descripcion: '% de desvío del cuadre que dispara ADVERTENCIA', tipo: 'entero', grupo: 'Cuadre / antifraude', fuente: 'parametros', min: 1, max: 500 },
  alerta_cuadre_umbral_alerta: { descripcion: '% de desvío del cuadre que dispara ALERTA', tipo: 'entero', grupo: 'Cuadre / antifraude', fuente: 'parametros', min: 1, max: 500 },
  umbral_anormal_pct: { descripcion: 'Desviación ± del baseline que marca una echada "anormal" (%)', tipo: 'entero', grupo: 'Cuadre / antifraude', fuente: 'flota', min: 1, max: 100 },

  // ── Combustible (flota_config) ────────────────────────────────────────────
  precio_gal_min: { descripcion: 'Banda de precio RD$/galón — mínimo (bloqueo fuera de banda)', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 1, max: 100000 },
  precio_gal_max: { descripcion: 'Banda de precio RD$/galón — máximo', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 1, max: 100000 },
  umbral_km_echada: { descripcion: 'Salto de km máximo entre echadas antes de sospechar error', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 1, max: 100000 },
  umbral_consumo_pct: { descripcion: '% bajo el promedio que dispara alerta de consumo', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 1, max: 99 },
  otros_umbral_dias: { descripcion: '"Otros" combustible: ventana de días para repeticiones', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 1, max: 365 },
  otros_umbral_repeticiones: { descripcion: '"Otros" combustible: nº de repeticiones que alerta', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 1, max: 100 },
  conciliacion_dias_tolerancia: { descripcion: 'Conciliación: días de diferencia aceptados factura↔registro', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 0, max: 60 },
  conciliacion_gal_tolerancia: { descripcion: 'Conciliación: galones de diferencia aceptados', tipo: 'decimal', grupo: 'Combustible', fuente: 'flota', min: 0, max: 100 },
  conciliacion_monto_tolerancia: { descripcion: 'Conciliación: RD$ de diferencia aceptados', tipo: 'entero', grupo: 'Combustible', fuente: 'flota', min: 0, max: 100000 },

  // ── Rendimiento (flota_config) ────────────────────────────────────────────
  rendimiento_minimo_km_gal: { descripcion: 'Piso absoluto de coherencia de consumo (km/gal)', tipo: 'decimal', grupo: 'Rendimiento', fuente: 'flota', min: 0, max: 1000 },
  rendimiento_maximo_km_gal: { descripcion: 'Techo absoluto de consumo (km/gal); arriba = error', tipo: 'decimal', grupo: 'Rendimiento', fuente: 'flota', min: 0, max: 1000 },
  rendimiento_min_horas_gal: { descripcion: 'Piso de consumo por horómetro (h/gal)', tipo: 'decimal', grupo: 'Rendimiento', fuente: 'flota', min: 0, max: 1000 },
  rendimiento_max_horas_gal: { descripcion: 'Techo de consumo por horómetro (h/gal)', tipo: 'decimal', grupo: 'Rendimiento', fuente: 'flota', min: 0, max: 1000 },
  dist_min_km: { descripcion: 'Km mínimos entre echadas para medir rendimiento', tipo: 'entero', grupo: 'Rendimiento', fuente: 'flota', min: 0, max: 100000 },
  dist_min_horas: { descripcion: 'Horas mínimas entre echadas (equipos por horómetro)', tipo: 'decimal', grupo: 'Rendimiento', fuente: 'flota', min: 0, max: 100000 },
  min_registros_baseline: { descripcion: 'Echadas plausibles mínimas para confiar el promedio propio', tipo: 'entero', grupo: 'Rendimiento', fuente: 'flota', min: 1, max: 100 },

  // ── Capacidad de tanque (flota_config) ────────────────────────────────────
  tanque_cap_motocicleta: { descripcion: 'Tope de tanque — motocicleta (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 10000 },
  tanque_cap_automovil: { descripcion: 'Tope de tanque — automóvil (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 10000 },
  tanque_cap_suv: { descripcion: 'Tope de tanque — SUV (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 10000 },
  tanque_cap_pickup: { descripcion: 'Tope de tanque — pickup (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 10000 },
  tanque_cap_camion: { descripcion: 'Tope de tanque — camión (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 10000 },
  tanque_cap_pesado: { descripcion: 'Tope de tanque — equipo pesado (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 10000 },
  tanque_cap_default: { descripcion: 'Tope de tanque — tipo desconocido/"otro" (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 10000 },
  tanque_cap_no_vehiculo: { descripcion: 'Tope de echada a depósito/planta/bidones (no vehículo) (gal)', tipo: 'entero', grupo: 'Capacidad de tanque', fuente: 'flota', min: 1, max: 100000 },
  tanque_margen_alerta: { descripcion: 'Factor de confirmación: galones > cap × este factor', tipo: 'decimal', grupo: 'Capacidad de tanque', fuente: 'flota', min: 0, max: 10 },
  tanque_margen_bloqueo: { descripcion: 'Factor de bloqueo duro: galones > cap × este factor', tipo: 'decimal', grupo: 'Capacidad de tanque', fuente: 'flota', min: 0, max: 10 },

  // ── GPS / tracking (parametros) ───────────────────────────────────────────
  gps_distance_filter_m: { descripcion: 'Filtro de distancia del GPS del dispositivo (m)', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 0, max: 100000 },
  gps_downsample_m: { descripcion: 'Downsample de puntos: distancia mínima entre puntos guardados (m)', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 0, max: 100000 },
  gps_flush_seg: { descripcion: 'Intervalo de envío de puntos acumulados (s)', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 3600 },
  gps_hueco_minutos: { descripcion: 'Minutos sin punto que se consideran un hueco de trayecto', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 1440 },
  gps_parada_min_min: { descripcion: 'Minutos quieto que cuentan como parada (stay-point)', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 1440 },
  gps_parada_radio_m: { descripcion: 'Radio de una parada (m)', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 100000 },
  gps_precision_max_m: { descripcion: 'Precisión máxima aceptada de un punto (m); peor = se descarta', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 100000 },
  gps_retencion_dias: { descripcion: 'Días que se retiene el histórico de posiciones', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 3650 },
  gps_tramo_gap_min: { descripcion: 'Minutos de corte entre tramos del recorrido', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 1440 },
  gps_velocidad_max_kmh: { descripcion: 'Velocidad máxima plausible; arriba = punto descartado (km/h)', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 1000 },
  ruta_dedup_ventana_min: { descripcion: 'Ventana para deduplicar rutas por contenido (min)', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 0, max: 1440 },
  tracking_activo_min: { descripcion: 'Minutos sin punto tras los que un chofer deja de estar "en vivo"', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'parametros', min: 1, max: 1440 },
  max_audio_notas: { descripcion: 'Nº máximo de notas de voz por registro', tipo: 'entero', grupo: 'GPS / tracking', fuente: 'flota', min: 0, max: 100 },

  // ── Estado del conductor (parametros) ─────────────────────────────────────
  estado_horario_inicio: { descripcion: 'Hora de inicio de jornada (0–23)', tipo: 'entero', grupo: 'Estado del conductor', fuente: 'parametros', min: 0, max: 23 },
  estado_horario_fin: { descripcion: 'Hora de fin de jornada (0–23)', tipo: 'entero', grupo: 'Estado del conductor', fuente: 'parametros', min: 0, max: 23 },
  estado_disponible_horas: { descripcion: 'Horas sin ruta tras las que el conductor se marca DISPONIBLE', tipo: 'entero', grupo: 'Estado del conductor', fuente: 'parametros', min: 1, max: 168 },
  estado_en_ruta_horas: { descripcion: 'Horas de ruta activa antes de recordatorio de estado', tipo: 'entero', grupo: 'Estado del conductor', fuente: 'parametros', min: 1, max: 168 },
  estado_inactivo_horas: { descripcion: 'Horas sin actividad tras las que se marca INACTIVO', tipo: 'entero', grupo: 'Estado del conductor', fuente: 'parametros', min: 1, max: 168 },

  // ── Vencimientos (flota_config) ───────────────────────────────────────────
  umbral_licencia_dias: { descripcion: 'Días antes del vencimiento de licencia para avisar', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 365 },
  umbral_por_vencer_licencia: { descripcion: 'Ventana "por vencer" (amarillo) de licencia (días)', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 365 },
  umbral_por_vencer_matricula: { descripcion: 'Ventana "por vencer" de matrícula (días)', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 365 },
  umbral_por_vencer_seguro: { descripcion: 'Ventana "por vencer" de seguro (días)', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 365 },
  umbral_por_vencer_placa_pp: { descripcion: 'Ventana "por vencer" de placa/permiso provisional (días)', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 365 },
  pp_vigencia_dias_default: { descripcion: 'Vigencia por defecto de un permiso provisional (días)', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 3650 },
  umbral_precita_km: { descripcion: 'Km restantes para sugerir pre-cita de mantenimiento', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 100000 },
  umbral_precita_horas: { descripcion: 'Horas restantes para sugerir pre-cita (horómetro)', tipo: 'entero', grupo: 'Vencimientos', fuente: 'flota', min: 1, max: 100000 },

  // ── Roles y permisos (parametros, CSV de roles) ───────────────────────────
  confirmacion_roles_globales: { descripcion: 'Roles que confirman recepción en cualquier bodega (CSV)', tipo: 'csv', grupo: 'Roles y permisos', fuente: 'parametros' },
  confirmacion_roles_almacen: { descripcion: 'Roles que confirman recepción en almacén (CSV)', tipo: 'csv', grupo: 'Roles y permisos', fuente: 'parametros' },
  confirmacion_roles_obra: { descripcion: 'Roles que confirman recepción en obra (CSV)', tipo: 'csv', grupo: 'Roles y permisos', fuente: 'parametros' },
  despachante_roles_elegibles: { descripcion: 'Roles elegibles para despachar un conduce (CSV)', tipo: 'csv', grupo: 'Roles y permisos', fuente: 'parametros' },
  despachante_cargo_keywords: { descripcion: 'Palabras clave de cargo que habilitan despachar (CSV)', tipo: 'csv', grupo: 'Roles y permisos', fuente: 'parametros' },
  multa_roles_elevados: { descripcion: 'Roles con acceso elevado a multas (CSV)', tipo: 'csv', grupo: 'Roles y permisos', fuente: 'parametros' },

  // ── Notificaciones (parametros, CSV de roles destinatarios) ───────────────
  aviso_vehiculo_roles: { descripcion: 'Roles que reciben avisos de vehículo (CSV)', tipo: 'csv', grupo: 'Notificaciones', fuente: 'parametros' },
  mantenimiento_aviso_roles: { descripcion: 'Roles que reciben avisos de mantenimiento (CSV)', tipo: 'csv', grupo: 'Notificaciones', fuente: 'parametros' },
  incentivo_informe_roles: { descripcion: 'Roles que reciben el informe de incentivo (CSV)', tipo: 'csv', grupo: 'Notificaciones', fuente: 'parametros' },
  resumen_operaciones_roles: { descripcion: 'Roles que reciben el resumen semanal de operaciones (CSV)', tipo: 'csv', grupo: 'Notificaciones', fuente: 'parametros' },

  // ── Flags de funciones (parametros, booleanos) ────────────────────────────
  conduce_wizard_web_habilitado: { descripcion: 'Habilita el asistente de conduce en la web', tipo: 'bool', grupo: 'Flags de funciones', fuente: 'parametros' },
  requisicion_auto_conduce: { descripcion: 'Genera conduce automáticamente al aprobar una requisición', tipo: 'bool', grupo: 'Flags de funciones', fuente: 'parametros' },
  requisicion_validar_equipo: { descripcion: 'Valida el equipo de la obra al crear una requisición', tipo: 'bool', grupo: 'Flags de funciones', fuente: 'parametros' },

  // ── Integraciones / general (parametros) ──────────────────────────────────
  apertura_nuevos_articulos: { descripcion: 'Stock de apertura por defecto para artículos nuevos', tipo: 'entero', grupo: 'Otros', fuente: 'parametros', min: 0, max: 1000000 },
  bitacora_max_fotos: { descripcion: 'Máximo de fotos por registro de bitácora', tipo: 'entero', grupo: 'Otros', fuente: 'parametros', min: 1, max: 100 },
  google_maps_api_key: { descripcion: 'Google Maps — key de SERVIDOR (edge). Sensible.', tipo: 'texto', grupo: 'Integraciones', fuente: 'parametros' },
  google_maps_browser_key: { descripcion: 'Google Maps — key de NAVEGADOR (restringida por dominio)', tipo: 'texto', grupo: 'Integraciones', fuente: 'parametros' },
  despachante_test_user_id: { descripcion: 'Usuario de prueba para despacho (UUID). Vacío en prod.', tipo: 'texto', grupo: 'Otros', fuente: 'parametros' },
};

/** Metadatos de una clave; si no está catalogada, inferimos por la tabla de origen. */
export function metaDe(clave: string, fuenteReal: ParamFuente): ParamMeta {
  return (
    PARAM_CATALOGO[clave] ?? {
      descripcion: '',
      tipo: 'texto',
      grupo: 'Otros',
      fuente: fuenteReal,
    }
  );
}

/** Valida un valor contra su metadato. Devuelve null si es válido, o el mensaje de error. */
export function validarValor(meta: ParamMeta, valor: string): string | null {
  const v = (valor ?? '').trim();
  switch (meta.tipo) {
    case 'entero':
    case 'decimal': {
      if (v === '') return 'Requerido.';
      const n = Number(v);
      if (!Number.isFinite(n)) return 'Debe ser un número.';
      if (meta.tipo === 'entero' && !Number.isInteger(n)) return 'Debe ser un número entero.';
      if (meta.min != null && n < meta.min) return `Mínimo ${meta.min}.`;
      if (meta.max != null && n > meta.max) return `Máximo ${meta.max}.`;
      return null;
    }
    case 'bool':
      return v === 'true' || v === 'false' ? null : 'Debe ser true o false.';
    case 'csv':
    case 'texto':
      return null;
  }
}
