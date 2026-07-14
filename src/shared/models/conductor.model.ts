export type LicenciaTipo = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type TipoVehiculoAutorizado = 'Liviano' | 'Pesado' | 'Ambos';

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
  activo: boolean;
}

export const LICENCIA_TIPOS: LicenciaTipo[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export const TIPO_VEHICULO_AUTORIZADO: TipoVehiculoAutorizado[] = ['Liviano', 'Pesado', 'Ambos'];
