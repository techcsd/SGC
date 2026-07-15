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

export type TecEquipoEstado = 'activo' | 'en_reparacion' | 'en_stock' | 'dado_de_baja';

export interface TecEquipo {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo: string; // laptop | desktop | monitor | telefono | tablet | camara | impresora | red | accesorio | otro
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEquipoEstado;
  empleado_id: string | null;
  empleado?: { nombre: string; apellido: string; cargo: string | null };
  asignado_en: string | null;
  ubicacion: string | null;
  notas: string | null;
  foto_path: string | null;
  activo: boolean;
  created_at?: string;
}

export interface TecEquipoFormData {
  nombre: string;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEquipoEstado;
  empleado_id: string | null;
  asignado_en: string | null;
  ubicacion: string | null;
  notas: string | null;
  foto_path?: string | null;
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

export const TEC_CATEGORIAS: { value: string; label: string }[] = [
  { value: 'nube', label: 'Nube' },
  { value: 'ia', label: 'Inteligencia Artificial' },
  { value: 'notas', label: 'Notas de reuniones' },
  { value: 'reuniones', label: 'Reuniones' },
  { value: 'comunicacion', label: 'Comunicación' },
  { value: 'diseno', label: 'Diseño' },
  { value: 'gestion', label: 'Gestión / Productividad' },
  { value: 'desarrollo', label: 'Desarrollo' },
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

export const TEC_EQUIPO_ESTADOS: { value: TecEquipoEstado; label: string; badge: string }[] = [
  { value: 'activo', label: 'Asignado / en uso', badge: 'success' },
  { value: 'en_stock', label: 'En stock', badge: 'info' },
  { value: 'en_reparacion', label: 'En reparación', badge: 'warning' },
  { value: 'dado_de_baja', label: 'Dado de baja', badge: 'danger' },
];
