// EA1 — modelos del módulo Proveedores de tecnología (sgc.tec_proveedores y relacionadas).

export type TecProveedorEstado = 'activo' | 'inactivo';
export type TecMoneda = 'DOP' | 'USD';
export type TecTrabajoEstado = 'cotizado' | 'en_curso' | 'completado' | 'cancelado';
export type TecFacturaEstado = 'pendiente' | 'pagada' | 'anulada';

export interface TecProveedorCategoria {
  id: string;
  nombre: string;
  orden: number;
  activa: boolean;
}

export interface TecProveedor {
  id: string;
  nombre: string;
  nombre_comercial: string | null;
  nombre_normalizado: string;
  rnc: string | null;
  categoria_id: string | null;
  servicio: string | null;
  etiquetas: string[];
  direccion: string | null;
  ciudad: string | null;
  web: string | null;
  notas: string | null;
  estado: TecProveedorEstado;
  valoracion: number | null;
  origen: 'manual' | 'backfill';
  creado_por: string | null;
  created_at: string;
  updated_at: string;
  categoria?: { nombre: string } | null;
}

export interface TecProveedorFormData {
  nombre: string;
  nombre_comercial: string | null;
  rnc: string | null;
  categoria_id: string | null;
  servicio: string | null;
  etiquetas: string[];
  direccion: string | null;
  ciudad: string | null;
  web: string | null;
  notas: string | null;
  estado: TecProveedorEstado;
  valoracion: number | null;
}

export interface TecProveedorContacto {
  id: string;
  proveedor_id: string;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  whatsapp: string | null;
  correo: string | null;
  principal: boolean;
  notas: string | null;
}

export type TecProveedorContactoFormData = Omit<TecProveedorContacto, 'id' | 'proveedor_id'>;

export interface TecProveedorTrabajo {
  id: string;
  proveedor_id: string;
  fecha: string | null;
  titulo: string;
  descripcion: string | null;
  costo: number | null;
  moneda: TecMoneda;
  estado: TecTrabajoEstado;
  cotizacion_id: string | null;
  solicitud_compra_id: string | null;
  equipo_id: string | null;
}

export type TecProveedorTrabajoFormData = Omit<TecProveedorTrabajo, 'id' | 'proveedor_id'>;

export interface TecProveedorFactura {
  id: string;
  proveedor_id: string;
  numero: string;
  fecha: string | null;
  monto: number | null;
  itbis: number | null;
  moneda: TecMoneda;
  estado: TecFacturaEstado;
  fecha_pago: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  trabajo_id: string | null;
  cotizacion_id: string | null;
  solicitud_compra_id: string | null;
  notas: string | null;
}

export type TecProveedorFacturaFormData = Omit<TecProveedorFactura, 'id' | 'proveedor_id' | 'archivo_path' | 'archivo_nombre'>;

/** Fila de `buscar_tec_proveedores(q)`. */
export interface TecProveedorBusqueda {
  id: string;
  nombre: string;
  nombre_comercial: string | null;
  categoria: string | null;
  servicio: string | null;
  estado: TecProveedorEstado;
  valoracion: number | null;
  etiquetas: string[];
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_whatsapp: string | null;
  contacto_correo: string | null;
  coincidencia: 'nombre' | 'servicio' | 'contacto' | 'trabajo' | 'cotizacion' | 'varios' | null;
  puntaje: number;
}

/** Fila de `tec_proveedores_por_revisar()`. */
export interface TecProveedorPorRevisar {
  texto: string;
  fuente: string;
  usos: number;
  motivo: 'vacio' | 'muy_corto' | 'solo_numeros' | 'varios_proveedores' | 'sin_vincular' | 'similar_a_otro' | 'sin_coincidencia';
  sugerencia_id: string | null;
  sugerencia_nombre: string | null;
}

/** Cotización/compra vinculadas, para la pestaña correspondiente de la ficha. */
export interface TecProveedorCotizacionRef {
  id: string;
  titulo: string;
  fecha: string | null;
  moneda: TecMoneda;
  total: number | null;
  estado: string;
}
export interface TecProveedorCompraRef {
  id: string;
  created_at: string;
  estado: string;
  notas: string | null;
}
