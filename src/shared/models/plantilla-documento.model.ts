export type PlantillaCategoria =
  | 'contrato'
  | 'recibo_pago'
  | 'orden_pago'
  | 'carta_entrega'
  | 'acta_incidencia'
  | 'otro';

export type CampoTipo = 'texto' | 'numero' | 'fecha' | 'textarea';

export interface CampoPlantilla {
  key: string;
  label: string;
  tipo: CampoTipo;
}

export interface PlantillaDocumento {
  id: string;
  nombre: string;
  categoria: PlantillaCategoria;
  contenido_html: string;
  campos: CampoPlantilla[];
  origen: 'sistema' | 'usuario';
  creado_por: string | null;
  activo: boolean;
  created_at: string;
}

export interface DocumentoGenerado {
  id: string;
  plantilla_id: string;
  plantilla?: { nombre: string; categoria: PlantillaCategoria };
  proyecto_id: string | null;
  proyecto?: { nombre: string };
  nombre: string;
  valores: Record<string, string>;
  contenido_html_final: string;
  generado_por: string | null;
  created_at: string;
}

export const CATEGORIA_LABELS: Record<PlantillaCategoria, string> = {
  contrato: 'Contrato',
  recibo_pago: 'Recibo de Pago',
  orden_pago: 'Orden de Pago',
  carta_entrega: 'Carta de Entrega',
  acta_incidencia: 'Acta de Incidencia',
  otro: 'Otro',
};
