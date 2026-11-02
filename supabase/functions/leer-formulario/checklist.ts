// F2b (ronda DF) — validación pura de las respuestas que propone el modelo
// para un checklist de vehículo. Extraída de resolverChecklistVehiculo() para
// poder testearla sin red/DB, mismo patrón que agente-escriba-solicitar/saneo.ts.

// deno-lint-ignore no-explicit-any
type Any = any;

export interface ItemChecklistValido {
  id: string;
  etiqueta: string;
  es_critico: boolean;
}

export interface RespuestaChecklistValida {
  id: string;
  respuesta: 'ok' | 'no';
  comentario: string | null;
  confianza: number;
}

/**
 * Defensa en profundidad: el modelo recibe la lista de ids válidos en el
 * prompt, pero esto NUNCA confía ciegamente en lo que devuelve — filtra a los
 * ids que de verdad mandó el cliente (nunca inventa uno nuevo) y fuerza un
 * comentario cuando un ítem crítico queda en "no" sin explicación.
 */
export function validarRespuestasChecklist(
  respuestasCrudas: Any[],
  itemsValidos: readonly ItemChecklistValido[],
): RespuestaChecklistValida[] {
  const idsValidos = new Set(itemsValidos.map((it) => it.id));
  const critPorId = new Map(itemsValidos.map((it) => [it.id, it.es_critico]));

  return (Array.isArray(respuestasCrudas) ? respuestasCrudas : [])
    .filter((r) => idsValidos.has(String(r?.id ?? '')))
    .filter((r) => r?.respuesta === 'ok' || r?.respuesta === 'no')
    .map((r) => {
      const id = String(r.id);
      const esCritico = critPorId.get(id) ?? false;
      const comentario = typeof r.comentario === 'string' && r.comentario.trim() ? r.comentario.trim() : null;
      return {
        id,
        respuesta: r.respuesta as 'ok' | 'no',
        comentario: esCritico && r.respuesta === 'no' && !comentario
          ? 'Revisar — no se capturó el detalle.'
          : comentario,
        confianza: Number.isFinite(Number(r?.confianza)) ? Number(r.confianza) : 0,
      };
    });
}
