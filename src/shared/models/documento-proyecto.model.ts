export type DocumentoTipo = 'contrato' | 'presupuesto' | 'cronograma' | 'manual_ejecucion' | 'otro';

export interface DocumentoProyecto {
  id: string;
  proyecto_id: string;
  tipo: DocumentoTipo;
  nombre: string;
  archivo_path: string;
  tipo_mime: string | null;
  contenido_html: string | null;
  subido_por: string | null;
  created_at: string;
}

export const DOCUMENTO_TIPOS: { value: DocumentoTipo; label: string }[] = [
  { value: 'contrato', label: 'Contrato' },
  { value: 'presupuesto', label: 'Presupuesto' },
  { value: 'cronograma', label: 'Cronograma' },
  { value: 'manual_ejecucion', label: 'Manual de Ejecución' },
  { value: 'otro', label: 'Otro' },
];
