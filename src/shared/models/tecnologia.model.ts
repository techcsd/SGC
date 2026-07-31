// A7 — Módulo Tecnología

export interface TecHerramienta {
  id: string;
  nombre: string;
  categoria: string; // nube | ia | notas | reuniones | comunicacion | diseno | gestion | desarrollo | otro
  para_que: string | null;
  quien_usa: string | null;
  url: string | null;
  activo: boolean;
  orden: number;
  created_at?: string;
}

export interface TecHerramientaFormData {
  nombre: string;
  categoria: string;
  para_que: string | null;
  quien_usa: string | null;
  url: string | null;
  activo: boolean;
}

export interface TecMatrizEntry {
  id: string;
  puesto: string;
  herramienta_id: string;
  herramienta?: { nombre: string; categoria: string };
  obligatorio: boolean;
  notas: string | null;
  created_at?: string;
}

export type TecEquipoEstado = 'activo' | 'en_reparacion' | 'en_stock' | 'dado_de_baja';

export interface TecEquipo {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo: string; // laptop | desktop | monitor | telefono | tablet | camara | impresora | red | accesorio | otro
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEquipoEstado;
  empleado_id: string | null;
  empleado?: { nombre: string; apellido: string; cargo: string | null };
  asignado_en: string | null;
  ubicacion: string | null;
  notas: string | null;
  foto_path: string | null;
  // QA-071 — datos de compra/garantía
  costo: number | null;
  fecha_compra: string | null;
  garantia_hasta: string | null;
  // QA-070 — trazabilidad compra tecnológica → equipo
  origen_solicitud_compra_id: string | null;
  activo: boolean;
  created_at?: string;
}

export interface TecEquipoFormData {
  nombre: string;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEquipoEstado;
  empleado_id: string | null;
  asignado_en: string | null;
  ubicacion: string | null;
  notas: string | null;
  foto_path?: string | null;
  // QA-071
  costo: number | null;
  fecha_compra: string | null;
  garantia_hasta: string | null;
  // QA-070
  origen_solicitud_compra_id: string | null;
}

/** QA-070 — opción ligera para el selector "Origen: compra tecnológica". */
export interface TecCompraOpcion {
  id: string;
  label: string;
}

export interface TecEquipoHistorial {
  id: string;
  equipo_id: string;
  tipo_cambio: string;
  descripcion: string | null;
  empleado_id: string | null;
  usuario_id: string | null;
  created_at: string;
}

/** AD5 — categoría de herramienta (catálogo administrable `sgc.tec_categorias`). */
export interface TecCategoria {
  id: string;
  clave: string;
  label: string;
  orden: number;
  activo: boolean;
}

/**
 * AD5 — Fallback local por si la tabla `tec_categorias` no responde. El catálogo
 * real vive en BD (administrable); esto solo evita dejar el select vacío.
 */
export const TEC_CATEGORIAS: { value: string; label: string }[] = [
  { value: 'cad_dwg', label: 'CAD / DWG' },
  { value: 'takeoff', label: 'Mapeos / Take-off' },
  { value: 'presupuestos', label: 'Presupuestos' },
  { value: 'ofimatica', label: 'Ofimática' },
  { value: 'email', label: 'Email' },
  { value: 'calendarios', label: 'Calendarios' },
  { value: 'videollamadas', label: 'Videollamadas' },
  { value: 'mensajeria', label: 'Mensajería' },
  { value: 'nube', label: 'Almacenamiento en la nube' },
  { value: 'contabilidad_erp', label: 'Contabilidad / ERP' },
  { value: 'diseno', label: 'Diseño' },
  { value: 'seguridad', label: 'Seguridad' },
  { value: 'ia', label: 'IA / Asistentes' },
  { value: 'otro', label: 'Otro' },
];

export const TEC_EQUIPO_TIPOS: { value: string; label: string }[] = [
  { value: 'laptop', label: 'Laptop' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'telefono', label: 'Teléfono' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'camara', label: 'Cámara' },
  { value: 'impresora', label: 'Impresora' },
  { value: 'red', label: 'Equipo de red' },
  { value: 'accesorio', label: 'Accesorio' },
  { value: 'otro', label: 'Otro' },
];

export const TEC_EQUIPO_ESTADOS: { value: TecEquipoEstado; label: string; badge: string }[] = [
  { value: 'activo', label: 'Asignado / en uso', badge: 'success' },
  { value: 'en_stock', label: 'En stock', badge: 'info' },
  { value: 'en_reparacion', label: 'En reparación', badge: 'warning' },
  { value: 'dado_de_baja', label: 'Dado de baja', badge: 'danger' },
];
