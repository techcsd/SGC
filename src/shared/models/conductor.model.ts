export type LicenciaTipo = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface Conductor {
  id: string;
  cedula: string;
  nombre: string;
  telefono: string | null;
  licencia_tipo: LicenciaTipo;
  licencia_numero: string | null;
  licencia_vencimiento: string | null;
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
  activo: boolean;
}

export const LICENCIA_TIPOS: LicenciaTipo[] = ['A', 'B', 'C', 'D', 'E', 'F'];
