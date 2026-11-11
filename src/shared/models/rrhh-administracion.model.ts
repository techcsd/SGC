// DN-29 (ronda DN) — Administración de la empresa (RRHH › Administración).
export type TramiteTipo = 'permiso' | 'licencia' | 'seguro' | 'impuesto' | 'otro';
export type TramiteEstado = 'vigente' | 'vencido' | 'en_tramite';

export interface RrhhTramite {
  id: string;
  nombre: string;
  tipo: TramiteTipo;
  entidad_responsable: string | null;
  numero_referencia: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  archivo_path: string | null;
  estado: TramiteEstado;
  notas: string | null;
  creado_por: string | null;
  es_prueba: boolean;
  created_at: string;
  updated_at: string;
}

export interface RrhhProveedorAdmin {
  id: string;
  nombre: string;
  servicio: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_email: string | null;
  contrato_desde: string | null;
  contrato_hasta: string | null;
  monto_mensual: number | null;
  notas: string | null;
  activo: boolean;
  es_prueba: boolean;
  created_at: string;
}

export type ActivoCategoria = 'mobiliario' | 'suministro' | 'equipo_oficina' | 'otro';
export type ActivoEstado = 'bueno' | 'regular' | 'mantenimiento' | 'baja';

export interface RrhhActivo {
  id: string;
  nombre: string;
  categoria: ActivoCategoria;
  ubicacion: string | null;
  estado: ActivoEstado;
  fecha_adquisicion: string | null;
  valor: number | null;
  proximo_mantenimiento: string | null;
  notas: string | null;
  es_prueba: boolean;
  created_at: string;
}
