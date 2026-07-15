export interface Articulo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: number;
  unidad: string;
  stock_minimo: number;
  stock_maximo: number | null;
  precio_estimado: number | null;
  imagen_url: string | null;
  activo: boolean;
  /** EPP: exige indicar talla al pedir (salida/requisición). */
  requiere_talla: boolean;
  /** Ayuda visible: atado/paquete/referencia (ej. "ATADO 120 PZA", "REF. TOTAL"). */
  nota: string | null;
  /** Subgrupo dentro de la categoría (ej. Madera/Plywood, CSD/Externo). */
  subgrupo: string | null;
  /** Orden oficial dentro de la categoría (según el Excel). */
  orden: number | null;
  created_at: string;
  updated_at: string;
  categoria?: { nombre: string };
}

export interface ArticuloFormData {
  codigo?: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: number | null;
  unidad: string;
  stock_minimo: number;
  stock_maximo: number | null;
  precio_estimado: number | null;
  activo: boolean;
  requiere_talla?: boolean;
  nota?: string | null;
}

export const UNIDADES = [
  { value: 'unidad', label: 'Unidad' },
  { value: 'par', label: 'Par' },
  { value: 'docena', label: 'Docena' },
  { value: 'kg', label: 'Kilogramo (kg)' },
  { value: 'lb', label: 'Libra (lb)' },
  { value: 'tonelada', label: 'Tonelada (t)' },
  { value: 'm', label: 'Metro (m)' },
  { value: 'm2', label: 'Metro cuadrado (m²)' },
  { value: 'm3', label: 'Metro cúbico (m³)' },
  { value: 'litro', label: 'Litro (L)' },
  { value: 'galon', label: 'Galón' },
  { value: 'saco', label: 'Saco' },
  { value: 'bolsa', label: 'Bolsa' },
  { value: 'rollo', label: 'Rollo' },
  { value: 'tubo', label: 'Tubo' },
  { value: 'barra', label: 'Barra' },
  { value: 'varilla', label: 'Varilla' },
  { value: 'plancha', label: 'Plancha' },
  { value: 'lamina', label: 'Lámina' },
  { value: 'bloque', label: 'Bloque' },
];
