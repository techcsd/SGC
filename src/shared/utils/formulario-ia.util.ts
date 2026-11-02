/**
 * DF1-B..E — helpers puros del lector IA genérico (`leer-formulario`), para
 * formularios distintos a la bitácora. Reusa los primitivos genéricos que ya
 * dejó DF1-A en `bitacora-ia.util.ts` (normalización, match exacto, umbral de
 * confianza) en vez de duplicarlos.
 */
import {
  normalizarTexto,
  emparejarExacto,
  clasificarConfianza,
  UMBRAL_CONFIANZA_BAJA,
} from './bitacora-ia.util';
import type { ClasificacionConfianza } from './bitacora-ia.util';

export { normalizarTexto, emparejarExacto, clasificarConfianza, UMBRAL_CONFIANZA_BAJA };
export type { ClasificacionConfianza };

export interface CampoSimple {
  valor: string | null;
  confianza: number;
}

export interface ItemPropuesto {
  articulo: string;
  cantidad: number | null;
  unidad: string | null;
  confianza: number;
}

export interface PropuestaConduceIA {
  ok: boolean;
  propuesta_id?: string | null;
  material?: CampoSimple;
  proveedor_sugerido?: CampoSimple;
  items?: ItemPropuesto[];
  confianza_media?: number;
  modelo?: string;
  error?: string;
  error_code?: string;
}

/** F2b — tipo de mantenimiento clasificado por la IA (nunca inventado: solo preventivo/correctivo). */
export interface CampoTipoMantenimiento {
  valor: 'preventivo' | 'correctivo' | null;
  confianza: number;
}

export interface PropuestaMantenimientoIA {
  ok: boolean;
  propuesta_id?: string | null;
  descripcion?: CampoSimple;
  vehiculo_sugerido?: CampoSimple;
  tipo?: CampoTipoMantenimiento;
  confianza_media?: number;
  modelo?: string;
  error?: string;
  error_code?: string;
}

/** F2b — una respuesta propuesta por la IA para un ítem del checklist. */
export interface RespuestaChecklistPropuesta {
  id: string;
  respuesta: 'ok' | 'no';
  comentario: string | null;
  confianza: number;
}

export interface PropuestaChecklistIA {
  ok: boolean;
  propuesta_id?: string | null;
  respuestas?: RespuestaChecklistPropuesta[];
  confianza_media?: number;
  modelo?: string;
  error?: string;
  error_code?: string;
}

/**
 * Defensa en profundidad del lado del cliente: el servidor ya filtra las
 * respuestas a los ids que se mandaron, pero si la pantalla cambió de
 * plantilla entre que se disparó la lectura y llegó la respuesta, esto evita
 * aplicar una respuesta a un ítem que ya no está visible.
 */
export function filtrarRespuestasChecklist(
  respuestas: readonly RespuestaChecklistPropuesta[],
  itemsVisibles: readonly { id: string }[],
): RespuestaChecklistPropuesta[] {
  const idsVisibles = new Set(itemsVisibles.map((it) => it.id));
  return respuestas.filter((r) => idsVisibles.has(r.id));
}

/**
 * Empareja el vehículo sugerido por la IA (placa o alias) contra el catálogo
 * real de vehículos. Match exacto únicamente — sin match devuelve null.
 */
export function emparejarVehiculoSugerido(
  sugerido: string | null | undefined,
  vehiculos: readonly { id: string; placa?: string | null; alias?: string | null }[],
): { id: string } | null {
  if (!sugerido) return null;
  const candidatos = vehiculos.flatMap((v) =>
    [v.placa, v.alias].filter((x): x is string => !!x).map((texto) => ({ id: v.id, texto })),
  );
  const match = emparejarExacto(sugerido, candidatos.map((c) => c.texto));
  if (!match) return null;
  const candidato = candidatos.find((c) => c.texto === match);
  return candidato ? { id: candidato.id } : null;
}

/**
 * Empareja el proveedor sugerido por la IA contra el catálogo de proveedores
 * REALES de transporte. Match exacto únicamente (nunca fuzzy) — sin match
 * devuelve null para que el llamador decida (p. ej. ofrecerlo como texto «Otro»).
 */
export function emparejarProveedorSugerido(
  sugerido: string | null | undefined,
  proveedores: readonly { id: string; nombre: string }[],
): { id: string; nombre: string } | null {
  if (!sugerido) return null;
  const nombre = emparejarExacto(sugerido, proveedores.map((p) => p.nombre));
  if (!nombre) return null;
  return proveedores.find((p) => p.nombre === nombre) ?? null;
}

/**
 * Cruza los renglones de `items` propuestos (ya vienen filtrados contra el
 * catálogo del lado del servidor, pero esto es defensa en profundidad del
 * lado del cliente) contra el catálogo real de artículos por id.
 */
export function emparejarItemsPropuestos(
  items: readonly ItemPropuesto[],
  articulos: readonly { id: string; nombre: string }[],
): { articuloId: string; cantidad: number }[] {
  const out: { articuloId: string; cantidad: number }[] = [];
  for (const it of items) {
    const nombreReal = emparejarExacto(it.articulo, articulos.map((a) => a.nombre));
    if (!nombreReal) continue;
    const art = articulos.find((a) => a.nombre === nombreReal);
    if (!art) continue;
    const cantidad = Number(it.cantidad ?? 0);
    if (!(cantidad > 0)) continue;
    out.push({ articuloId: art.id, cantidad });
  }
  return out;
}
