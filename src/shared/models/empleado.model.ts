export type TipoContrato = 'indefinido' | 'temporal' | 'obra';

export interface Empleado {
  id: string;
  cedula: string;
  nombre: string;
  apellido: string;
  cargo: string;
  departamento: string | null;
  fecha_ingreso: string;
  salario: number;
  tipo_contrato: TipoContrato;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  usuario_id: string | null;
  activo: boolean;
  created_at: string;
}

export interface EmpleadoFormData {
  cedula: string;
  nombre: string;
  apellido: string;
  cargo: string;
  departamento: string | null;
  fecha_ingreso: string;
  salario: number;
  tipo_contrato: TipoContrato;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
}

export const TIPOS_CONTRATO = [
  { value: 'indefinido', label: 'Indefinido' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'obra', label: 'Por obra' },
];

export const DEPARTAMENTOS = [
  'Administración',
  'Construcción',
  'Logística',
  'RRHH',
  'Finanzas',
  'Gerencia',
  'Seguridad',
];
