/** CM7 — modo práctica (simulador local, datos de mentira, nota tipo examen). */

export interface Objetivo {
  id: string;
  texto: string;
  puntos: number;
  /** Evalúa el estado final de la práctica → ¿cumplido? */
  cumple: (r: RespuestaPractica) => boolean;
  consejo?: string;
}

export interface Penalizacion {
  id: string;
  texto: string;
  puntos: number; // se resta
  aplica: (r: RespuestaPractica) => boolean;
}

export interface MisionPractica {
  id: string;
  plataforma: 'web' | 'app';
  roles: string[]; // [] = todos
  titulo: string;
  intro: string;
  version: number;
  objetivos: Objetivo[];
  penalizaciones: Penalizacion[];
}

/** Lo que el usuario fue armando durante la práctica (en memoria, nunca a la red). */
export interface RespuestaPractica {
  [k: string]: unknown;
}

/** CM7 7c — resumen de una persona en el panel de equipo (jefe/RRHH/admin). */
export interface ResultadoEquipoFila {
  usuario_id: string;
  nombre: string;
  intentos: number;
  misiones: number;
  mejor_nota: number;
  ultima_nota: number | null;
  ultima_fecha: string | null;
  aprobadas: number;
  promedio: number | null;
}

/** CM7 7c — detalle por misión de una persona. */
export interface ResultadoPersonaFila {
  mision_id: string;
  titulo: string;
  intentos: number;
  mejor_nota: number;
  ultima_nota: number | null;
  ultima_fecha: string | null;
  aprobada: boolean;
}

export interface ObjetivoResultado { id: string; texto: string; puntos: number; ok: boolean; consejo?: string; }
export interface ResultadoPractica {
  nota: number;            // 0-100
  estrellas: number;       // 0-3
  aprobada: boolean;       // >= 80
  objetivos: ObjetivoResultado[];
  penalizaciones: { texto: string; puntos: number }[];
  duracionS: number;
}
