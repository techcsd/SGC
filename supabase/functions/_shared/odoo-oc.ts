// _shared/odoo-oc.ts — CY24 Fase C: adaptador de "crear la OC en Odoo de
// verdad". HOY es un MOCK (D-08: sin una base de pruebas confirmada, o sin la
// orden escrita de Xaviel para un caso concreto, no se escribe en el Odoo
// real -- ver HANDOFF.md, única excepción hasta ahora fue una escritura
// puntual y ya desmontada). Cuando exista una de las dos cosas, este archivo
// es el ÚNICO lugar que cambia: swap de `publicarOcMock` por una llamada real
// a `purchase.order`/`create` vía `OdooClient.executeKw` (`odoo-client.ts`
// ya es capaz de escribir).

export interface ResultadoPublicacionOc {
  estado: "completado" | "error";
  resultado?: Record<string, unknown>;
  error?: string;
}

/**
 * MOCK -- no toca Odoo. Simula un resultado determinista a partir de
 * `orden_id` para que la acción y sus tests sean verificables sin una base
 * de pruebas real. `paraPublicar._mock_forzar === "error"` permite a un test
 * pedir un fallo simulado.
 */
export async function publicarOcMock(paraPublicar: Record<string, unknown>): Promise<ResultadoPublicacionOc> {
  const lineas = Array.isArray(paraPublicar.lineas) ? paraPublicar.lineas : [];
  if (lineas.length === 0) return { estado: "error", error: "La orden no tiene líneas para publicar." };
  if (paraPublicar._mock_forzar === "error") return { estado: "error", error: "mock: fallo simulado" };

  // "odoo_id" determinista a partir de orden_id -- nunca Math.random en este runtime.
  const semilla = String(paraPublicar.orden_id ?? "");
  let hash = 0;
  for (let i = 0; i < semilla.length; i++) hash = (hash * 31 + semilla.charCodeAt(i)) >>> 0;
  const idSimulado = 900_000 + (hash % 100_000);

  return {
    estado: "completado",
    resultado: {
      modelo: "purchase.order",
      odoo_id_simulado: idSimulado,
      nombre: `P${String(idSimulado).padStart(5, "0")}-MOCK`,
      estado_odoo: "draft",
      nota: "MOCK -- no se llamó a Odoo real (D-08)",
    },
  };
}
