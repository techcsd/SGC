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

// DA7/DA-04 — ya no es un union fijo: situación y condición son catálogos
// administrables (sgc.tec_equipo_estados / sgc.tec_equipo_condiciones),
// validados por trigger en el servidor, no por un CHECK ni un tipo cerrado.
export type TecEquipoEstado = string;

export interface TecEquipo {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo: string; // laptop | desktop | monitor | telefono | tablet | camara | impresora | red | accesorio | otro
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEquipoEstado;
  // DA7/DA-04 — condición física, independiente de la situación (estado).
  condicion: string;
  empleado_id: string | null;
  empleado?: { nombre: string; apellido: string; cargo: string | null };
  asignado_en: string | null;
  ubicacion: string | null;
  notas: string | null;
  foto_path: string | null;
  // AL1 — inventario tecnológico completo
  tipo_id: string | null;
  bodega_id: string | null;
  moneda: 'DOP' | 'USD';
  fotos: string[];
  foto_portada: string | null;
  // QA-071 — datos de compra/garantía
  costo: number | null;
  fecha_compra: string | null;
  garantia_hasta: string | null;
  // QA-070 — trazabilidad compra tecnológica → equipo
  origen_solicitud_compra_id: string | null;
  // DA2/DA-02 — identificación
  service_tag: string | null;
  codigo_servicio: string | null;
  numero_parte: string | null;
  modelo_regulatorio: string | null;
  anio_fabricacion: number | null;
  codigo_anterior: string | null;
  imei: string | null;
  etiqueta_taller: string | null;
  // DA-11 — responsable sin usuario en el SGC
  responsable_externo: string | null;
  // DA-12 — costo/garantía
  costo_origen: 'compra' | 'estimado' | 'donado';
  fecha_compra_desconocida: boolean;
  garantia_desconocida: boolean;
  // DA-14 — fotos "especificaciones" (captura de Windows), separadas de la portada
  fotos_specs: string[];
  // DA-10 — kits: este equipo es componente de kit_padre_id (null si es suelto o es el padre)
  kit_padre_id: string | null;
  presente: boolean;
  // DA-06 — solo existencia (no el valor); el valor sale únicamente de la edge equipos-clave.
  tiene_clave: boolean;
  // DA2 — specs 1:1 (join opcional; null si no se pidió o no existe fila aún)
  specs?: TecEquipoSpecs | null;
  activo: boolean;
  created_at?: string;
}

/** DA2/DA-02 — especificaciones técnicas 1:1 (sgc.tec_equipo_specs). */
export interface TecEquipoSpecs {
  equipo_id: string;
  procesador: string | null;
  ram_gb: number | null;
  ram_velocidad: string | null;
  almacenamiento_tipo: 'SSD' | 'HDD' | 'NVMe' | null;
  almacenamiento_gb: number | null;
  gpu_integrada: string | null;
  gpu_dedicada: string | null;
  gpu_memoria_gb: number | null;
  so: string | null;
  so_version: string | null;
  pantalla_pulgadas: number | null;
  resolucion: string | null;
  tactil: boolean | null;
  nombre_windows: string | null;
  usuario_windows: string | null;
  cargador_voltaje: string | null;
  cargador_amperaje: string | null;
  frecuencia: string | null;
  potencia_w: number | null;
  tipo_radio: 'frecuencia' | 'celular_ptt' | null;
  sello_telserdom_radio: string | null;
  sello_telserdom_bateria: string | null;
  bateria_modelo: string | null;
  bateria_capacidad: number | null;
  bateria_unidad: 'mAh' | 'Wh' | null;
  bateria_voltaje: string | null;
  bateria_sello: string | null;
  accesorios: string[];
  camara_specs: string | null;
}

export type TecEquipoSpecsFormData = Omit<TecEquipoSpecs, 'equipo_id'>;

/** DA-03 — qué bloques de specs aplican según el tipo de equipo. */
export type TecGrupoCampos = 'computadora' | 'radio' | 'bateria' | 'dron';

/** DA7/DA-04 — catálogo administrable de situaciones/condiciones (mismo
 *  patrón que TecEquipoTipo). */
export interface TecEquipoEstadoCat {
  id: string;
  clave: string;
  label: string;
  orden: number;
  activo: boolean;
}

// CZ1/CZ2 — biblioteca de Cotizaciones de Tecnología (independiente de una
// compra puntual; se puede ligar a 0..N compras tecnológicas y 0..N equipos).
export type TecCotizacionEstado = 'vigente' | 'usada' | 'descartada';

export interface TecCotizacion {
  id: string;
  titulo: string;
  proveedor: string | null;
  fecha: string | null;
  moneda: 'DOP' | 'USD';
  subtotal: number | null;
  itbis: number | null;
  total: number | null;
  estado: TecCotizacionEstado;
  archivo_path: string | null;
  archivo_nombre: string | null;
  lectura: Record<string, unknown> | null;
  lectura_costo_usd: number | null;
  adjunto_id: string | null;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
  compras?: { solicitud_compra_id: string }[];
  equipos?: { equipo_id: string; linea_idx: number | null }[];
}

export interface TecCotizacionFormData {
  titulo: string;
  proveedor: string | null;
  fecha: string | null;
  moneda: 'DOP' | 'USD';
  subtotal: number | null;
  itbis: number | null;
  total: number | null;
  notas: string | null;
}

/** AL1 — tipo administrable del inventario tecnológico (catálogo tec_equipo_tipos). */
export interface TecEquipoTipo {
  id: string;
  clave: string;
  label: string;
  orden: number;
  activo: boolean;
  // DA-03 — qué bloques de tec_equipo_specs mostrar para este tipo.
  grupos_campos?: TecGrupoCampos[];
}

export interface TecEquipoFormData {
  nombre: string;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEquipoEstado;
  condicion?: string;
  empleado_id: string | null;
  asignado_en: string | null;
  ubicacion: string | null;
  notas: string | null;
  foto_path?: string | null;
  // AL1
  tipo_id?: string | null;
  bodega_id?: string | null;
  moneda?: 'DOP' | 'USD';
  fotos?: string[];
  foto_portada?: string | null;
  // QA-071
  costo: number | null;
  fecha_compra: string | null;
  garantia_hasta: string | null;
  // QA-070
  origen_solicitud_compra_id: string | null;
  // DA2/DA-02 — identificación
  service_tag?: string | null;
  codigo_servicio?: string | null;
  numero_parte?: string | null;
  modelo_regulatorio?: string | null;
  anio_fabricacion?: number | null;
  codigo_anterior?: string | null;
  imei?: string | null;
  etiqueta_taller?: string | null;
  // DA-11
  responsable_externo?: string | null;
  // DA-12
  costo_origen?: 'compra' | 'estimado' | 'donado';
  fecha_compra_desconocida?: boolean;
  garantia_desconocida?: boolean;
  // DA-14
  fotos_specs?: string[];
  // DA-10
  kit_padre_id?: string | null;
  presente?: boolean;
}

/** DA-06 — resultado de "ver" la clave cifrada del equipo (edge equipos-clave). */
export interface TecEquipoClaveResultado {
  ok: boolean;
  valor?: string;
  tipo_clave?: 'personal' | 'compartida';
  visible_segundos?: number;
  error?: string;
}

/** DA-10 — estado calculado de un kit (vista sgc.tec_kits_estado). */
export interface TecKitEstado {
  kit_id: string;
  kit_codigo: string | null;
  kit_nombre: string;
  total_componentes: number;
  presentes: number;
  faltantes: number;
  completo: boolean;
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

/** DA7/DA-04 — fallback local si `tec_equipo_estados`/`tec_equipo_condiciones`
 *  no responden (mismo criterio que TEC_CATEGORIAS/TEC_EQUIPO_TIPOS); el tono
 *  visual (punto + color) ya NO sale de aquí, sale de `estado-tono.ts`
 *  (fuente única del sistema de diseño para cualquier estado del SGC). */
export const TEC_EQUIPO_ESTADOS: { value: string; label: string }[] = [
  { value: 'activo', label: 'Asignado / en uso' },
  { value: 'en_stock', label: 'En stock' },
  { value: 'en_reparacion', label: 'En reparación' },
  { value: 'en_prestamo', label: 'En préstamo' },
  { value: 'extraviado', label: 'Extraviado' },
  { value: 'dado_de_baja', label: 'Dado de baja' },
];

export const TEC_EQUIPO_CONDICIONES: { value: string; label: string }[] = [
  { value: 'funciona', label: 'Funciona' },
  { value: 'averiado', label: 'Averiado' },
  { value: 'por_diagnosticar', label: 'Por diagnosticar' },
];
