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
  es_default?: boolean; // CF7 — plantilla predeterminada de su categoría
  docx_path?: string | null; // CF7 — .docx original
  version?: number; // CF7
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

// CF7 — catálogo de variables para el asistente de espacios del Word de Sonia.
// `origen`: 'empresa'|'trabajador'|'obra'|'generar' = se resuelve solo al generar;
// 'manual' = se escribe a mano. La clave ES el {{token}} que queda en la plantilla.
export interface VariableContrato {
  key: string;
  label: string;
  origen: 'empresa' | 'trabajador' | 'obra' | 'generar' | 'manual';
}

export const VARIABLES_CONTRATO: VariableContrato[] = [
  { key: 'empresa_razon_social', label: 'Empresa — razón social', origen: 'empresa' },
  { key: 'empresa_rnc', label: 'Empresa — RNC', origen: 'empresa' },
  { key: 'empresa_domicilio', label: 'Empresa — domicilio social', origen: 'empresa' },
  { key: 'empresa_ciudad', label: 'Empresa — ciudad', origen: 'empresa' },
  { key: 'empresa_gerente_general', label: 'Empresa — gerente general', origen: 'empresa' },
  { key: 'empresa_representante', label: 'Empresa — representante', origen: 'empresa' },
  { key: 'trabajador_nombre', label: 'Trabajador — nombre', origen: 'trabajador' },
  { key: 'trabajador_documento', label: 'Trabajador — cédula/documento', origen: 'trabajador' },
  { key: 'trabajador_nacionalidad', label: 'Trabajador — nacionalidad', origen: 'trabajador' },
  { key: 'trabajador_domicilio', label: 'Trabajador — domicilio', origen: 'trabajador' },
  { key: 'trabajador_cargo', label: 'Trabajador — cargo', origen: 'trabajador' },
  { key: 'trabajador_tarifa_hora', label: 'Trabajador — salario por hora (número)', origen: 'trabajador' },
  { key: 'trabajador_tarifa_hora_letras', label: 'Trabajador — salario por hora (en letras)', origen: 'trabajador' },
  { key: 'obra_cliente', label: 'Obra — cliente', origen: 'obra' },
  { key: 'obra_nombre', label: 'Obra — nombre', origen: 'obra' },
  { key: 'fecha_letras', label: 'Fecha de hoy (en letras)', origen: 'generar' },
  { key: 'ciudad', label: 'Ciudad de la firma', origen: 'generar' },
  { key: 'botas_cantidad', label: 'EPP — botas (cantidad)', origen: 'manual' },
  { key: 'chaleco_cantidad', label: 'EPP — chaleco (cantidad)', origen: 'manual' },
  { key: 'casco_cantidad', label: 'EPP — casco (cantidad)', origen: 'manual' },
  { key: 'arnes_cantidad', label: 'EPP — arnés (cantidad)', origen: 'manual' },
  { key: 'testigo_1_nombre', label: 'Testigo 1 — nombre', origen: 'manual' },
  { key: 'testigo_1_cedula', label: 'Testigo 1 — cédula', origen: 'manual' },
  { key: 'testigo_2_nombre', label: 'Testigo 2 — nombre', origen: 'manual' },
  { key: 'testigo_2_cedula', label: 'Testigo 2 — cédula', origen: 'manual' },
];

export const CATEGORIA_LABELS: Record<PlantillaCategoria, string> = {
  contrato: 'Contrato',
  recibo_pago: 'Recibo de Pago',
  orden_pago: 'Orden de Pago',
  carta_entrega: 'Carta de Entrega',
  acta_incidencia: 'Acta de Incidencia',
  otro: 'Otro',
};
