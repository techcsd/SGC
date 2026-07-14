/** Partida planeada de una obra (R24). Avance físico = ejecutada / planeada. */
export interface ProyectoPartida {
  id: string;
  proyecto_id: string;
  nombre: string;
  unidad: string | null;
  cantidad_planeada: number;
  cantidad_ejecutada: number;
  activa: boolean;
  orden: number;
  created_at: string;
}

export interface ProyectoPartidaFormData {
  nombre: string;
  unidad: string | null;
  cantidad_planeada: number;
  cantidad_ejecutada: number;
  orden: number;
}

/** Avance físico vs pagado (vista sgc.v_proyecto_avance, R25). */
export interface ProyectoAvance {
  proyecto_id: string;
  codigo: string;
  nombre: string;
  porcentaje_pagado: number | null;
  avance_trabajado: number;
  n_partidas: number;
  pago_excede: boolean;
}

export type AvisoProyectoTipo = 'pago_mayor_trabajo';

/** Aviso de proyecto (patrón avisos_flota, R25). */
export interface AvisoProyecto {
  id: string;
  tipo: AvisoProyectoTipo;
  proyecto_id: string | null;
  referencia_id: string | null;
  mensaje: string;
  severidad: 'baja' | 'media' | 'alta';
  estado: 'pendiente' | 'atendido';
  dedup_key: string | null;
  atendido_por: string | null;
  atendido_at: string | null;
  nota_atencion: string | null;
  created_at: string;
  proyecto?: { nombre: string; codigo: string } | null;
}
