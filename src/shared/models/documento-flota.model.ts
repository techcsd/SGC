// Documentos de conductores y vehículos (Actualización 6 · X1).
// Tabla genérica sgc.documentos + bucket privado `flota-documentos`.

export type DocumentoEntidad = 'conductor' | 'vehiculo';

export interface DocumentoFlota {
  id: string;
  entidad: DocumentoEntidad;
  entidad_id: string;
  tipo: string; // conductor: cedula|licencia|otro · vehiculo: seguro|matricula|otro
  nombre: string | null;
  path: string;
  subido_por: string | null;
  created_at: string;
}

export interface DocSlot {
  value: string;
  label: string;
  destacado: boolean; // se "solicita": muestra indicador de falta si no existe
}

// Slots por entidad. Los destacados se solicitan (indicador "falta documento");
// `otro` agrupa cualquier documentación adicional (N documentos).
export const DOC_SLOTS: Record<DocumentoEntidad, DocSlot[]> = {
  conductor: [
    { value: 'cedula', label: 'Cédula', destacado: true },
    { value: 'licencia', label: 'Licencia de conducir', destacado: true },
    { value: 'otro', label: 'Otros documentos', destacado: false },
  ],
  vehiculo: [
    { value: 'seguro', label: 'Seguro', destacado: true },
    { value: 'matricula', label: 'Matrícula', destacado: true },
    { value: 'otro', label: 'Otros documentos', destacado: false },
  ],
};
