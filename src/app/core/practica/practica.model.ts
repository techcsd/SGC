/** CM7 — modo práctica (simulador local, datos de mentira, nota tipo examen). */
import { EscenarioPractica } from './practica-cliente.service';
export type { EscenarioPractica };

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

/** CM7 7b — tipos de campo del formulario simulado (render genérico, datos de mentira). */
export type CampoTipo = 'select' | 'materiales' | 'conteo' | 'fecha' | 'texto' | 'numero';

export interface OpcionCampo {
  id: string;
  nombre: string;
  stock?: number;  // materiales: stock disponible · conteo: cantidad esperada (sistema)
  sub?: string;    // línea secundaria (ej. "pide 100 sacos")
}

export interface CampoPractica {
  id: string;            // clave en RespuestaPractica
  tipo: CampoTipo;
  label: string;
  ayuda?: string;        // texto de apoyo bajo el campo
  placeholder?: string;
  opciones?: OpcionCampo[]; // select (lista) · materiales (catálogo) · conteo (renglones fijos)
}

/** Fila de materiales que el usuario arma (tipo 'materiales'). */
export interface FilaMaterial { id: string; nombre: string; stock: number; cantidad: number; }
/** Fila de conteo (tipo 'conteo'): esperado del sistema vs. contado por el usuario. */
export interface FilaConteo { id: string; nombre: string; esperado: number; contado: number | null; }

export interface MisionPractica {
  id: string;
  plataforma: 'web' | 'app';
  roles: string[]; // [] = todos
  titulo: string;
  intro: string;
  version: number;
  /** CM7 7b — campos del simulador. Si falta, la misión no tiene formulario (legacy). */
  campos?: CampoPractica[];
  objetivos: Objetivo[];
  penalizaciones: Penalizacion[];
  /** CM7 7b — pantalla REAL a la que lleva la misión (ruta del router). Si está, la práctica
   *  activa el cliente de práctica con `escenario` y navega aquí en vez de usar el formulario
   *  simplificado. */
  rutaReal?: string;
  /** CM7 7a — datos de mentira que sirve el cliente de práctica para la pantalla real. */
  escenario?: EscenarioPractica;
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
