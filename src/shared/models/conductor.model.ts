// C1 — categorías de licencia en formato dominicano (01, 02, 03…). El catálogo
// vive en BD (`sgc.licencia_categorias`) y se consume vía ConductoresService.
// `licencia_tipo` es el `codigo` de esa tabla (text, p. ej. '02'). Se deja como
// string (no union) para no acoplar el front al catálogo y permitir editarlo en BD.
export type LicenciaTipo = string;
export type TipoVehiculoAutorizado = 'Liviano' | 'Pesado' | 'Ambos';

/** Fila del catálogo de categorías de licencia RD (`sgc.licencia_categorias`). */
export interface LicenciaCategoria {
  codigo: string; // '01'..'06' (+ especiales)
  nombre: string; // 'Vehículos livianos (auto/jeepeta)'
  clase: 'Liviano' | 'Pesado' | null;
  orden: number;
  activo: boolean;
}

export interface Conductor {
  id: string;
  cedula: string;
  nombre: string;
  telefono: string | null;
  licencia_tipo: LicenciaTipo;
  licencia_numero: string | null;
  licencia_vencimiento: string | null;
  tipo_vehiculo_autorizado: TipoVehiculoAutorizado;
  vehiculo_id: string | null;
  vehiculo?: { placa: string; marca: string; modelo: string };
  // Links this driver to their CSD App user, so their conduces/rutas show up
  // in the mobile app (mis_conduces_hoy / mis_rutas_hoy).
  usuario_id: string | null;
  usuario?: { nombre: string };
  // C3 — nota libre + tags descriptivos (Chofer, Encargado de Logística…).
  nota: string | null;
  tags: string[] | null;
  activo: boolean;
  created_at: string;
}

export interface ConductorFormData {
  cedula: string;
  nombre: string;
  telefono: string | null;
  licencia_tipo: LicenciaTipo;
  licencia_numero: string | null;
  licencia_vencimiento: string | null;
  tipo_vehiculo_autorizado: TipoVehiculoAutorizado;
  vehiculo_id: string | null;
  usuario_id: string | null;
  nota: string | null;
  tags: string[] | null;
  activo: boolean;
}

/**
 * C1 — fallback del catálogo RD si la tabla no responde (mismo contenido que el
 * seed de `sql/2026-07-17-licencia-categorias.sql`). Mantener sincronizado.
 */
export const LICENCIA_CATEGORIAS_FALLBACK: LicenciaCategoria[] = [
  { codigo: '01', nombre: 'Motocicletas', clase: 'Liviano', orden: 1, activo: true },
  { codigo: '02', nombre: 'Vehículos livianos (auto/jeepeta)', clase: 'Liviano', orden: 2, activo: true },
  { codigo: '03', nombre: 'Carga liviana / taxi', clase: 'Liviano', orden: 3, activo: true },
  { codigo: '04', nombre: 'Autobuses / pasajeros', clase: 'Pesado', orden: 4, activo: true },
  { codigo: '05', nombre: 'Carga pesada (camiones)', clase: 'Pesado', orden: 5, activo: true },
  { codigo: '06', nombre: 'Vehículos especiales / maquinaria', clase: 'Pesado', orden: 6, activo: true },
];

/** C3 — sugerencias de tags para el autocompletado del form de conductor. */
export const CONDUCTOR_TAGS_SUGERIDOS: string[] = [
  'Chofer',
  'Encargado de Logística',
  'Chofer Telehandler',
  'Operador de Maquinaria',
  'Mensajero',
  'Supervisor',
];

export const TIPO_VEHICULO_AUTORIZADO: TipoVehiculoAutorizado[] = ['Liviano', 'Pesado', 'Ambos'];
