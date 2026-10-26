// _shared/odoo-inventario.ts — CY6/CY7. Adaptador de "publicar en Odoo" por
// tipo de agregado. HOY es un MOCK (D-15: nada de Odoo real en CI/tests; D-08:
// sin base de pruebas confirmada no se escribe en el Odoo real) — mapea
// agregado_tipo -> el modelo/acción que correspondería en Odoo, pero la
// función `publicar()` nunca llama a la red. Cuando exista una base de
// pruebas confirmada (o la orden escrita de Xaviel para un caso concreto),
// este archivo es el ÚNICO lugar que cambia para publicar de verdad: swap de
// `publicarMock` por una llamada real al adaptador de CY5 (`odoo-client.ts`)
// con la acción de escritura correspondiente (todavía no existe en
// `acciones.ts` — eso es CY24 Fase A).

export interface EventoOutbox {
  id: string;
  agregado_tipo: string;
  agregado_id: string;
  accion: string;
  revision: number;
  payload: Record<string, unknown>;
}

export interface ResultadoPublicacion {
  estado: "completado" | "reintento" | "error" | "incierto";
  resultado?: Record<string, unknown>;
  error?: string;
  reintentarEnMs?: number;
}

const MODELO_ODOO: Record<string, string> = {
  articulo: "product.template",
  categoria_inventario: "product.category",
  unidad: "uom.uom",
  proveedor: "res.partner",
};

/**
 * MOCK -- no toca Odoo. Simula un resultado determinista a partir del
 * payload para que el procesador y sus tests sean verificables sin una base
 * de pruebas real. `payload._mock_forzar` permite a un test pedir un
 * resultado específico ("error" | "incierto" | "reintento").
 */
export async function publicarMock(evento: EventoOutbox): Promise<ResultadoPublicacion> {
  const modelo = MODELO_ODOO[evento.agregado_tipo];
  if (!modelo) return { estado: "error", error: `agregado_tipo sin modelo Odoo mapeado: ${evento.agregado_tipo}` };

  const forzar = (evento.payload as Record<string, unknown>)?.["_mock_forzar"];
  if (forzar === "error") return { estado: "error", error: "mock: fallo simulado" };
  if (forzar === "incierto") return { estado: "incierto", error: "mock: timeout simulado tras posible confirmación" };
  if (forzar === "reintento") return { estado: "reintento", error: "mock: fallo transitorio simulado", reintentarEnMs: 1000 };

  // Éxito simulado: "odoo_id" determinista (no aleatorio -- nunca Math.random en este runtime).
  const idSimulado = 900_000 + (evento.revision % 1000);
  return { estado: "completado", resultado: { modelo, odoo_id_simulado: idSimulado, nota: "MOCK -- no se llamó a Odoo real" } };
}
