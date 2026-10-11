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

export interface ObjetivoResultado { id: string; texto: string; puntos: number; ok: boolean; consejo?: string; }
export interface ResultadoPractica {
  nota: number;            // 0-100
  estrellas: number;       // 0-3
  aprobada: boolean;       // >= 80
  objetivos: ObjetivoResultado[];
  penalizaciones: { texto: string; puntos: number }[];
  duracionS: number;
}
