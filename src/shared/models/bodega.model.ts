export interface Bodega {
  id: string;
  nombre: string;
  descripcion: string | null;
  ubicacion: string | null;
  activo: boolean;
  created_at: string;
  proyecto_id?: string | null;
  /** LEGACY (BO1): puente de solo lectura = es_central || es_principal_obra. */
  es_principal?: boolean;
  /** BO1 — central global (proyecto_id null). */
  es_central?: boolean;
  /** BO1 — principal de una obra (único por proyecto). */
  es_principal_obra?: boolean;
  proyecto?: { nombre: string } | null;
  // U22 — coordenadas para usar el almacén como origen/destino de rutas
  latitud?: number | null;
  longitud?: number | null;
  // Z5(d) — dato de prueba (solo admin lo ve/gestiona)
  es_prueba?: boolean;
}

export interface BodegaFormData {
  nombre: string;
  descripcion: string | null;
  ubicacion: string | null;
  activo: boolean;
  proyecto_id: string | null;
  /** BO1 — central global (solo para almacenes sin obra). */
  es_central?: boolean;
  /** BO1 — principal de la obra vinculada (solo para almacenes de obra). */
  es_principal_obra?: boolean;
  latitud: number | null;
  longitud: number | null;
  es_prueba?: boolean;
}
