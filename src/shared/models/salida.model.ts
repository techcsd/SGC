export type SalidaEstado = 'despachado' | 'entregado' | 'entregado_incompleto' | 'anulado';

export const SALIDA_ESTADO_LABELS: Record<SalidaEstado, string> = {
  despachado: 'Despachado',
  entregado: 'Entregado',
  entregado_incompleto: 'Entregado (incompleto)',
  anulado: 'Eliminado',
};

export interface DetalleSalida {
  id: string;
  salida_id: string;
  articulo_id: string;
  articulo?: { nombre: string; codigo: string; unidad: string };
  cantidad: number;
  cantidad_recibida: number | null;
  /** Talla indicada para artículos EPP con requiere_talla (se muestra en el conduce). */
  talla?: string | null;
}

export interface SalidaInventario {
  id: string;
  fecha: string;
  bodega_id: string;
  bodega?: { nombre: string };
  // AN5 — almacén destino (AL10, Bodega Central). Embed desambiguado por FK.
  destino_almacen?: { nombre: string } | null;
  proyecto_id: string | null;
  proyecto?: { nombre: string };
  motivo: string;
  responsable: string | null;
  observaciones: string | null;
  creado_por: string | null;
  // AG4 — nombre de quien registró la salida (join a usuarios).
  creado?: { nombre: string } | null;
  created_at: string;
  estado: SalidaEstado;
  conductor_id: string | null;
  conductor?: { nombre: string } | null;
  vehiculo_id: string | null;
  vehiculo?: { placa: string | null; marca?: string | null; modelo?: string | null; color?: string | null } | null;
  /** AY12 — ruta vinculada al conduce (para gating de "Iniciar ruta"). */
  ruta_id?: string | null;
  recibido_por: string | null;
  recibido?: { nombre: string } | null;
  recibido_en: string | null;
  notas_recepcion: string | null;
  // AI2/AS3 — despachante (quien entrega el material al chofer). Se refleja como
  // "Entregado por" en el conduce/PDF. despachante_usuario_id ⇒ firma remota (AS2).
  despachante_nombre?: string | null;
  despachante_usuario_id?: string | null;
  despachante_empleado_id?: string | null;
  carga_foto_path?: string | null;
  // Evidence photo captured by the mobile CSD app when the salida was created.
  foto_path: string | null;
  // AF10 — firma de quien entrega (capturada en la app de campo).
  firma_path: string | null;
  // Delivery evidence captured by the mobile CSD app (driver closes the conduce).
  entregado_por: string | null;
  entregado?: { nombre: string } | null;
  entregado_en: string | null;
  entrega_receptor: string | null;
  entrega_firma_path: string | null;
  entrega_foto_path: string | null;
  // AY1 — foto que capturó el RECEPTOR al confirmar la recepción (bucket inventario).
  recepcion_foto_path?: string | null;
  // AE — firma de RECEPTOR pendiente enrutada (móvil): a quién le toca firmar si no
  // estuvo presente. Se limpia cuando esa persona firma (firmar_conduce).
  firma_pendiente_usuario_id: string | null;
  firma_pendiente_nombre: string | null;
  // T2 — dato de prueba (oculto a no-admin por RLS; admin lo marca/elimina).
  es_prueba?: boolean;
  detalle_salidas?: DetalleSalida[];
}

/** AC7 — firma capturada de un conduce (emisor entrega / receptor recibe). Vive en
 *  `sgc.salida_firmas`; es la fuente canónica de las firmas del conduce. */
export interface SalidaFirma {
  id?: string;
  salida_id?: string;
  rol: 'emisor' | 'receptor';
  nombre: string;
  cedula?: string | null;
  rol_desc?: string | null;
  usuario_id?: string | null;
  firma_path: string;
  metodo?: 'pad' | 'foto';
  firmado_en?: string;
}

export interface SalidaItemFormData {
  articulo_id: string;
  cantidad: number;
  /** Talla indicada (obligatoria para artículos EPP con requiere_talla). */
  talla?: string | null;
}

export interface SalidaFormData {
  fecha: string;
  bodega_id: string;
  proyecto_id: string | null;
  /** AL10 — destino = almacén central (Bodega Central), excluyente con proyecto_id. */
  destino_almacen_id?: string | null;
  motivo: string;
  responsable: string | null;
  observaciones: string | null;
  conductor_id: string | null;
  vehiculo_id: string | null;
  items: SalidaItemFormData[];
}

/** Human-facing conduce number derived from the salida id — single source of
 *  truth so the list, the printable view, and any export all agree. */
export function conduceNumero(salidaId: string): string {
  return 'CND-' + salidaId.slice(0, 8).toUpperCase();
}

/** AO5 — Bucket de pestaña calculado server-side (RPC conduces_web_listado). */
export type ConduceBucket = 'pendientes_entrega' | 'por_confirmar' | 'historico';

/** AO5 — Fila del listado web de conduces (RPC conduces_web_listado). */
export interface ConduceListadoRow {
  id: string;
  fecha: string;
  estado: SalidaEstado;
  fase: string;
  bucket: ConduceBucket;
  proyecto_id: string | null;
  proyecto: string | null;
  /** AP4 — obra del almacén de salida (obra origen). */
  origen_proyecto_id?: string | null;
  origen_proyecto?: string | null;
  bodega: string | null;
  destino_almacen?: string | null;
  conductor_id?: string | null;
  conductor: string | null;
  /** AP4 — ids para el filtro por "responsable" (emisor/chofer/receptor). */
  emisor_id?: string | null;
  chofer_usuario_id?: string | null;
  receptor_id?: string | null;
  responsable: string | null;
  responsable_match?: string[] | null;
  items: number;
  es_prueba: boolean;
  created_at: string;
}

export const MOTIVOS_SALIDA: { value: string; label: string }[] = [
  { value: 'uso_proyecto', label: 'Uso en proyecto' },
  { value: 'traslado_almacen', label: 'Traslado a almacén (Bodega Central)' },
  { value: 'venta', label: 'Venta' },
  { value: 'merma', label: 'Merma / Pérdida' },
  { value: 'devolucion', label: 'Devolución a proveedor' },
  { value: 'ajuste', label: 'Ajuste de inventario' },
  { value: 'otro', label: 'Otro' },
];
