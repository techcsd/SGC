/**
 * CL2/CL5 — Registro ÚNICO del movimiento de la web (fuente del catálogo
 * `admin/animaciones` y de `sgc.movimiento_catalogo`). Cada `celebrar()`,
 * `momento()` y cada directiva usan un id de aquí (via `MOTION_IDS`), para que no
 * exista animación "suelta". La prueba unitaria (`catalogo-movimiento.spec.ts`)
 * verifica que todo id usado está registrado y que todo id registrado se usa.
 *
 * Niveles (docs/MOVIMIENTO.md): grande (overlay ≤1.6s) · mediano (~0.8s sin velo) ·
 * base (micro-movimiento de pantalla: listas, KPIs, pestañas, estado…).
 */
export type MovimientoNivel = 'grande' | 'mediano' | 'base';
export type MovimientoSistema = 'web' | 'app';

export interface MovimientoEntry {
  id: string;
  nombre: string;
  nivel: MovimientoNivel;
  sistema: MovimientoSistema;
  /** Dónde sale (texto corto para el catálogo). */
  donde: string;
  /** Pantallas/áreas donde aplica. */
  pantallas: string[];
  duracionMs: number;
  curva: string;
  /** Qué hace con "reducidas" / prefers-reduced-motion. */
  reducido: string;
  desdeVersion: string;
  /** Clave de vista previa en el catálogo (CL5). */
  previewKey: string;
  estado: 'en_uso' | 'pendiente';
}

/** Ids canónicos — ÚNICA forma de referenciar una animación en el código. */
export const MOTION_IDS = {
  // Grandes (overlay) — CJ2/CJ3
  celebracionConduce: 'celebracion-conduce',
  celebracionRuta: 'celebracion-ruta',
  // Medianos (0.8s, sin velo) — CL2/CL5
  momentoEntrada: 'momento-entrada',
  momentoSalida: 'momento-salida',
  momentoAprobado: 'momento-aprobado',
  momentoFirma: 'momento-firma',
  momentoCombustible: 'momento-combustible',
  momentoChecklist: 'momento-checklist',
  momentoMantenimiento: 'momento-mantenimiento',
  momentoMensaje: 'momento-mensaje',
  momentoDocumento: 'momento-documento',
  // Base (micro-movimiento de pantalla)
  baseStagger: 'base-stagger',
  baseCountUp: 'base-count-up',
  baseEstadoPulse: 'base-estado-pulse',
} as const;

export type MotionId = (typeof MOTION_IDS)[keyof typeof MOTION_IDS];

const V = '1.163.0';

export const CATALOGO_MOVIMIENTO: MovimientoEntry[] = [
  {
    id: MOTION_IDS.celebracionConduce, nombre: 'Conduce creado', nivel: 'grande', sistema: 'web',
    donde: 'Al emitir un conduce (normal o externo)', pantallas: ['inventario/conduce', 'inventario/conduce-externo-form'],
    duracionMs: 1600, curva: 'var(--ease-out)', reducido: 'Solo el check + el texto', desdeVersion: '1.159.0',
    previewKey: 'celebracion-conduce', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.celebracionRuta, nombre: 'Ruta creada', nivel: 'grande', sistema: 'web',
    donde: 'Al crear una ruta', pantallas: ['flota/rutas'],
    duracionMs: 1600, curva: 'var(--ease-out)', reducido: 'Solo el check + el texto', desdeVersion: '1.159.0',
    previewKey: 'celebracion-ruta', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoEntrada, nombre: 'Entrada registrada', nivel: 'mediano', sistema: 'web',
    donde: 'Caja que entra al almacén', pantallas: ['inventario/entradas', 'inventario/confirmaciones'],
    duracionMs: 800, curva: 'var(--ease-out)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-entrada', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoSalida, nombre: 'Salida / despacho', nivel: 'mediano', sistema: 'web',
    donde: 'Caja que sale', pantallas: ['inventario/salidas', 'bitacora/entregas'],
    duracionMs: 800, curva: 'var(--ease-in)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-salida', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoAprobado, nombre: 'Aprobación', nivel: 'mediano', sistema: 'web',
    donde: 'Sello APROBADA', pantallas: ['compras/ordenes', 'inventario/requisiciones', 'rrhh/ausencias', 'legal/aprobaciones'],
    duracionMs: 800, curva: 'var(--ease-out)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-aprobado', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoFirma, nombre: 'Firma', nivel: 'mediano', sistema: 'web',
    donde: 'Trazo de firma', pantallas: ['legal/contratos', 'legal/firmas-pendientes', 'documentos/generar'],
    duracionMs: 800, curva: 'var(--ease-out)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-firma', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoCombustible, nombre: 'Combustible', nivel: 'mediano', sistema: 'web',
    donde: 'Gota que se llena', pantallas: ['flota/combustible', 'flota/combustible-log'],
    duracionMs: 800, curva: 'var(--ease-out)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-combustible', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoChecklist, nombre: 'Checklist / inspección', nivel: 'mediano', sistema: 'web',
    donde: 'Puntos tachados en cascada', pantallas: ['flota/checklists', 'inventario/conteos'],
    duracionMs: 800, curva: 'var(--ease-out)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-checklist', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoMantenimiento, nombre: 'Mantenimiento cerrado', nivel: 'mediano', sistema: 'web',
    donde: 'La llave gira', pantallas: ['flota/mantenimientos'],
    duracionMs: 800, curva: 'var(--ease-out)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-mantenimiento', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoMensaje, nombre: 'Mensaje / nota enviada', nivel: 'mediano', sistema: 'web',
    donde: 'Avión de papel', pantallas: ['mensajes', 'notas'],
    duracionMs: 800, curva: 'var(--ease-in)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-mensaje', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.momentoDocumento, nombre: 'Documento generado', nivel: 'mediano', sistema: 'web',
    donde: 'Hoja impresa', pantallas: ['documentos/generar', 'documentos/plantillas'],
    duracionMs: 800, curva: 'var(--ease-out)', reducido: 'Solo el check', desdeVersion: V,
    previewKey: 'momento-documento', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.baseStagger, nombre: 'Lista escalonada', nivel: 'base', sistema: 'web',
    donde: 'Filas/tarjetas entran 30ms escalonadas (máx. 8, 1.ª carga)', pantallas: ['listas y tablas'],
    duracionMs: 220, curva: 'var(--ease-out)', reducido: 'Aparecen sin desplazamiento', desdeVersion: V,
    previewKey: 'base-stagger', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.baseCountUp, nombre: 'KPI que cuenta', nivel: 'base', sistema: 'web',
    donde: 'Los números suben hasta su valor (600ms)', pantallas: ['dashboards y KPIs'],
    duracionMs: 600, curva: 'var(--ease-out)', reducido: 'Muestra el número final directo', desdeVersion: V,
    previewKey: 'base-count-up', estado: 'en_uso',
  },
  {
    id: MOTION_IDS.baseEstadoPulse, nombre: 'Chip de estado con pulso', nivel: 'base', sistema: 'web',
    donde: 'El chip late corto al cambiar de estado', pantallas: ['tablas, tarjetas, fichas'],
    duracionMs: 320, curva: 'var(--ease-out)', reducido: 'Cambia de color sin latido', desdeVersion: V,
    previewKey: 'base-estado-pulse', estado: 'en_uso',
  },
];
