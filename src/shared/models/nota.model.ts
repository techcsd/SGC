export type NotaPermiso = 'ver' | 'editar';

export interface Nota {
  id: string;
  owner_id: string;
  titulo: string;
  contenido: string;
  color: string | null;
  pinned: boolean;
  archivada: boolean;
  created_at: string;
  updated_at: string;
  /** Enriquecido en el cliente: nombre del dueño (para "Compartidas conmigo"). */
  owner_nombre?: string;
  /** Enriquecido en el cliente: mi permiso sobre una nota compartida conmigo. */
  mi_permiso?: NotaPermiso;
}

export interface NotaCompartido {
  id: string;
  nota_id: string;
  usuario_id: string;
  permiso: NotaPermiso;
  created_at: string;
  usuario?: { nombre: string } | null;
}

/** Paleta pastel para el acento de la nota (estilo Keep). El primer valor es el
 *  color por defecto de una nota nueva. `null` = sin color (superficie normal). */
export const NOTA_COLORES: { value: string; label: string }[] = [
  { value: '#fef3c7', label: 'Amarillo' },
  { value: '#dbeafe', label: 'Azul' },
  { value: '#dcfce7', label: 'Verde' },
  { value: '#fce7f3', label: 'Rosa' },
  { value: '#ede9fe', label: 'Morado' },
  { value: '#fed7aa', label: 'Naranja' },
];
