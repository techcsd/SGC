// CY24 Fase B — bandeja "Productos por dar de alta en Odoo". El solicitante
// nunca resuelve lo suyo (D-09); `solicitado_por`/`resuelto_por` referencian
// auth.users(id) (no sgc.usuarios), así que el nombre se resuelve aparte con
// resolver_nombres_usuarios (patrón CJ10), no por embed de PostgREST.

export type OdooProductoSolicitudEstado = 'pendiente' | 'aprobado' | 'creado' | 'vinculado_existente' | 'rechazado';

export interface OdooProductoSolicitud {
  id: string;
  orden_id: string | null;
  orden_item_id: string | null;
  descripcion_libre: string;
  busqueda_previa: string | null;
  estado: OdooProductoSolicitudEstado;
  articulo_resultante_id: string | null;
  articulo_resultante?: { nombre: string; codigo: string } | null;
  solicitado_por: string;
  solicitado_por_nombre?: string | null;
  solicitado_en: string;
  resuelto_por: string | null;
  resuelto_por_nombre?: string | null;
  resuelto_en: string | null;
  motivo_resolucion: string | null;
  es_prueba: boolean;
  origen_item_libre_id?: string | null;
  nombre_propuesto?: string | null;
  codigo_propuesto?: string | null;
  odoo_categ_id?: number | null;
  odoo_uom_id?: number | null;
  aprobado_por?: string | null;
  aprobado_en?: string | null;
  orden?: { numero: string } | null;
}

export const ODOO_PRODUCTO_SOLICITUD_ESTADOS: { value: OdooProductoSolicitudEstado; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'aprobado', label: 'Aprobado por Contabilidad' },
  { value: 'creado', label: 'Creado' },
  { value: 'vinculado_existente', label: 'Vinculado a existente' },
  { value: 'rechazado', label: 'Rechazado' },
];
