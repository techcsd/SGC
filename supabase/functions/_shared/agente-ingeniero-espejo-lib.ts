// Espejo prod -> dev de las tareas del Ingeniero (26-nov-2026).
// El runner (GitHub) usa SOLO la base de dev (nunca la llave de prod). Los reportes reales caen en prod, asi que la edge
// agente-ingeniero-espejo (en prod) copia a dev las tareas 'nueva' CON EL MISMO id y trae de vuelta estado/PR para que
// Tecnologia > Agentes de prod muestre el avance. Funciones puras: sin red ni base.

export interface TareaFila {
  id: string;
  origen: string;
  origen_ref: string | null;
  clasificacion: string;
  titulo: string;
  texto_origen: string | null;
  severidad: string;
  estado: string;
  repo: string;
  modulo: string | null;
  [k: string]: unknown;
}

/** Estados de una tarea que todavia puede cambiar en dev (los terminales no se vuelven a sincronizar). */
export const ESTADOS_ABIERTOS = ["nueva", "analizando", "plan_listo", "en_codigo", "en_revision", "en_dev", "propuesta"] as const;

/** Campos que dev (donde trabaja el agente) manda de vuelta a prod. Nunca ids de otras tablas (aprobacion_id, reporte_id). */
export const CAMPOS_SYNC = [
  "estado", "plan", "archivos", "intentos", "pr_url", "pr_numero", "veredictos", "zona_roja",
  "costo_ia", "borrador_respuesta", "motivo", "prod_en", "despachada_en", "despachos", "respondida_en",
] as const;

/** Fila que se inserta en dev: mismo id, estado 'nueva', sin referencias a tablas de prod. */
export function filaParaDev(t: TareaFila): Record<string, unknown> {
  return {
    id: t.id,
    origen: t.origen,
    origen_ref: t.origen_ref,
    clasificacion: t.clasificacion,
    titulo: t.titulo,
    texto_origen: t.texto_origen,
    severidad: t.severidad,
    estado: "nueva",
    repo: t.repo,
    modulo: t.modulo,
    reporte_id: null,
  };
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Diferencias dev -> prod (solo CAMPOS_SYNC que cambiaron). {} = nada que hacer. */
export function parcheParaProd(dev: Record<string, unknown>, prod: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const c of CAMPOS_SYNC) if (c in dev && !igual(dev[c], prod[c])) p[c] = dev[c] ?? null;
  return p;
}

/** Ids de prod que faltan en dev. */
export function faltantesEnDev(idsProd: string[], idsDev: Set<string>): string[] {
  return idsProd.filter((i) => !idsDev.has(i));
}

/** Nunca espejar una base contra si misma. */
export function mismaBase(urlA: string, urlB: string): boolean {
  const n = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return n(urlA) === n(urlB);
}
