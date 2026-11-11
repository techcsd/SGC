// DN-27 P2 (ronda DN) — Nómina y pagos. SENSIBLE. Cálculo asistido +
// exportación, NUNCA mueve dinero. Las fórmulas son parámetros editables,
// marcados para validar con el contador antes de usarse en un período real.
export interface RrhhNominaParametro {
  clave: string;
  valor: number;
  descripcion: string | null;
  validado_por_contador: boolean;
  updated_at: string;
}

export type NominaPeriodoEstado = 'borrador' | 'calculado' | 'exportado';

export interface RrhhNominaPeriodo {
  id: string;
  nombre: string;
  fecha_desde: string;
  fecha_hasta: string;
  estado: NominaPeriodoEstado;
  creado_por: string | null;
  created_at: string;
}
