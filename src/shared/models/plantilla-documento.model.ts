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
  /** CO12 — dato de ejemplo para "Ver"/"Probar con datos" (un solo lugar, no se repite por plantilla). */
  ejemplo?: string;
}

export const VARIABLES_CONTRATO: VariableContrato[] = [
  { key: 'empresa_razon_social', label: 'Empresa — razón social', origen: 'empresa', ejemplo: 'Scheker & Domínguez Constructora, SRL' },
  { key: 'empresa_rnc', label: 'Empresa — RNC', origen: 'empresa', ejemplo: '1-30-12345-6' },
  { key: 'empresa_domicilio', label: 'Empresa — domicilio social', origen: 'empresa', ejemplo: 'Av. Winston Churchill #123, Santo Domingo' },
  { key: 'empresa_ciudad', label: 'Empresa — ciudad', origen: 'empresa', ejemplo: 'Santo Domingo' },
  { key: 'empresa_gerente_general', label: 'Empresa — gerente general', origen: 'empresa', ejemplo: 'Xaviel Terrero' },
  { key: 'empresa_representante', label: 'Empresa — representante', origen: 'empresa', ejemplo: 'Xaviel Terrero' },
  { key: 'trabajador_nombre', label: 'Trabajador — nombre', origen: 'trabajador', ejemplo: 'Juan Pérez' },
  { key: 'trabajador_documento', label: 'Trabajador — cédula/documento', origen: 'trabajador', ejemplo: '001-1234567-8' },
  { key: 'trabajador_nacionalidad', label: 'Trabajador — nacionalidad', origen: 'trabajador', ejemplo: 'dominicano' },
  { key: 'trabajador_domicilio', label: 'Trabajador — domicilio', origen: 'trabajador', ejemplo: 'Calle Segunda #45, Los Mina' },
  { key: 'trabajador_cargo', label: 'Trabajador — cargo', origen: 'trabajador', ejemplo: 'Ingeniero de Campo' },
  { key: 'trabajador_tarifa_hora', label: 'Trabajador — salario por hora (número)', origen: 'trabajador', ejemplo: '250' },
  { key: 'trabajador_tarifa_hora_letras', label: 'Trabajador — salario por hora (en letras)', origen: 'trabajador', ejemplo: 'Doscientos cincuenta pesos' },
  { key: 'obra_cliente', label: 'Obra — cliente', origen: 'obra', ejemplo: 'Grupo Rosch' },
  { key: 'obra_nombre', label: 'Obra — nombre', origen: 'obra', ejemplo: 'Torre Alpha' },
  { key: 'fecha_letras', label: 'Fecha de hoy (en letras)', origen: 'generar', ejemplo: '14 de octubre de 2026' },
  { key: 'ciudad', label: 'Ciudad de la firma', origen: 'generar', ejemplo: 'Santo Domingo' },
  { key: 'botas_cantidad', label: 'EPP — botas (cantidad)', origen: 'manual', ejemplo: '2' },
  { key: 'chaleco_cantidad', label: 'EPP — chaleco (cantidad)', origen: 'manual', ejemplo: '1' },
  { key: 'casco_cantidad', label: 'EPP — casco (cantidad)', origen: 'manual', ejemplo: '1' },
  { key: 'arnes_cantidad', label: 'EPP — arnés (cantidad)', origen: 'manual', ejemplo: '1' },
  { key: 'testigo_1_nombre', label: 'Testigo 1 — nombre', origen: 'manual', ejemplo: 'María Santos' },
  { key: 'testigo_1_cedula', label: 'Testigo 1 — cédula', origen: 'manual', ejemplo: '001-9876543-2' },
  { key: 'testigo_2_nombre', label: 'Testigo 2 — nombre', origen: 'manual', ejemplo: 'Pedro Ramírez' },
  { key: 'testigo_2_cedula', label: 'Testigo 2 — cédula', origen: 'manual', ejemplo: '001-5554443-1' },
];

/** CO12 — dato de ejemplo para un campo cualquiera: usa el catálogo de arriba si
 *  la clave coincide; si no, un placeholder genérico por tipo (un solo lugar). */
export function ejemploParaCampo(campo: CampoPlantilla): string {
  const conocido = VARIABLES_CONTRATO.find((v) => v.key === campo.key)?.ejemplo;
  if (conocido) return conocido;
  switch (campo.tipo) {
    case 'numero': return '1,234';
    case 'fecha': return '14 de octubre de 2026';
    case 'textarea': return 'Texto de ejemplo para este campo…';
    default: return `(${campo.label})`;
  }
}

// CF7/CE7 — versión guardada de una plantilla.
export interface PlantillaVersion {
  id: string;
  plantilla_id: string;
  version: number;
  nombre: string;
  contenido_html: string;
  campos: CampoPlantilla[];
  motivo: string | null;
  creado_por_nombre?: string | null;
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
