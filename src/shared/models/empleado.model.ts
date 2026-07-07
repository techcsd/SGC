export type TipoContrato = 'indefinido' | 'temporal' | 'obra';
export type Genero = 'masculino' | 'femenino' | 'otro';
export type EstadoCivil = 'soltero' | 'casado' | 'union_libre' | 'divorciado' | 'viudo';

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
  // ── Datos personales / RRHH ampliados ──
  fecha_nacimiento: string | null;
  genero: Genero | null;
  estado_civil: EstadoCivil | null;
  contacto_emergencia_nombre: string | null;
  contacto_emergencia_telefono: string | null;
  jefe_id: string | null;
  jefe?: { nombre: string; apellido: string } | null;
  fecha_egreso: string | null;
  motivo_egreso: string | null;
  numero_tss: string | null;
  afp: string | null;
  ars: string | null;
  dias_vacaciones_anuales: number;
  banco: string | null;
  cuenta_banco: string | null;
}

export interface EmpleadoDocumento {
  id: string;
  empleado_id: string;
  tipo: string;
  nombre: string;
  archivo_path: string;
  tipo_mime: string | null;
  subido_por: string | null;
  created_at: string;
}

export const TIPOS_CONTRATO = [
  { value: 'indefinido', label: 'Indefinido' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'obra', label: 'Por obra' },
];

export const GENEROS = [
  { value: 'masculino', label: 'Masculino' },
  { value: 'femenino', label: 'Femenino' },
  { value: 'otro', label: 'Otro' },
];

export const ESTADOS_CIVILES = [
  { value: 'soltero', label: 'Soltero/a' },
  { value: 'casado', label: 'Casado/a' },
  { value: 'union_libre', label: 'Unión libre' },
  { value: 'divorciado', label: 'Divorciado/a' },
  { value: 'viudo', label: 'Viudo/a' },
];

export const TIPOS_DOCUMENTO_EMPLEADO = [
  { value: 'contrato', label: 'Contrato' },
  { value: 'cedula', label: 'Cédula' },
  { value: 'titulo', label: 'Título' },
  { value: 'certificacion', label: 'Certificación' },
  { value: 'amonestacion', label: 'Amonestación' },
  { value: 'evaluacion', label: 'Evaluación' },
  { value: 'otro', label: 'Otro' },
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
