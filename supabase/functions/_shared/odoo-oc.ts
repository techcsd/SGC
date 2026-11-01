// _shared/odoo-oc.ts — CY24 Fase C: adaptadores de "crear / confirmar / cancelar
// la OC en Odoo". Hay dos juegos con la misma firma (`AdaptadorOc`):
//  - MOCK (`publicarOcMock`, ...): no toca Odoo; es el valor por defecto y lo
//    que usan los tests (D-08: sin base de pruebas confirmada o sin orden
//    escrita de Xaviel no se escribe en el Odoo real).
//  - REAL (`crearAdaptadoresOcReales`): purchase.order vía `OdooClient.call`
//    (create/button_confirm/button_cancel; nunca reintenta, ver odoo-client.ts).
// El total y los impuestos los arma Odoo; para SGC son solo informativos (lectura).
// `seleccionarAdaptadoresOc` elige uno: REAL solo si ODOO_ESCRITURA_HABILITADA=true
// en los secrets del edge (junto con ODOO_URL/DB/USER/API_KEY). Apuntar primero
// a la instancia de PRUEBAS (D-08); el flag es el interruptor de escritura.
import { type OdooClient, OdooError } from "./odoo-client.ts";

export interface ResultadoPublicacionOc {
  estado: "completado" | "error";
  resultado?: Record<string, unknown>;
  error?: string;
  /** Código estable del error de negocio (p. ej. "oc_ya_recibida"); el texto de `error` es el que ve el usuario. */
  codigo?: string;
}

/** Adaptador hacia Odoo por acción: recibe lo que devuelven oc_para_publicar / oc_para_comando. */
export type AdaptadorOc = (paraComando: Record<string, unknown>) => Promise<ResultadoPublicacionOc>;
export interface AdaptadoresOc { crear: AdaptadorOc; confirmar: AdaptadorOc; cancelar: AdaptadorOc; refrescar: AdaptadorOc }

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

  const idSimulado = idDeterminista(String(paraPublicar.orden_id ?? ""));
  return {
    estado: "completado",
    resultado: {
      modelo: "purchase.order",
      odoo_id: idSimulado,
      nombre: `P${String(idSimulado).padStart(5, "0")}-MOCK`,
      estado_odoo: "draft",
      nota: "MOCK -- no se llamó a Odoo real (D-08)",
    },
  };
}

/** CY24 Fase C -- confirmar/cancelar una OC ya publicada (mismo MOCK, mismo swap pendiente que arriba). */
export async function confirmarOcMock(paraComando: Record<string, unknown>): Promise<ResultadoPublicacionOc> {
  if (paraComando._mock_forzar === "error") return { estado: "error", error: "mock: fallo simulado" };
  return {
    estado: "completado",
    resultado: { modelo: "purchase.order", odoo_id: paraComando.odoo_id, estado_odoo: "purchase", nota: "MOCK -- no se llamó a Odoo real (D-08)" },
  };
}

export async function cancelarOcMock(paraComando: Record<string, unknown>): Promise<ResultadoPublicacionOc> {
  if (paraComando._mock_forzar === "error") return { estado: "error", error: "mock: fallo simulado" };
  return {
    estado: "completado",
    resultado: { modelo: "purchase.order", odoo_id: paraComando.odoo_id, estado_odoo: "cancel", nota: "MOCK -- no se llamó a Odoo real (D-08)" },
  };
}

/** Refresco MOCK: devuelve el estado de Odoo equivalente al que SGC ya tiene (no inventa cambios). */
export async function refrescarOcMock(paraComando: Record<string, unknown>): Promise<ResultadoPublicacionOc> {
  const porSync: Record<string, string> = { por_aprobar: "to approve", confirmada: "purchase", cancelada: "cancel" };
  const estado = porSync[String(paraComando.odoo_sync_estado_actual ?? "")] ?? "draft";
  return {
    estado: "completado",
    resultado: { modelo: "purchase.order", odoo_id: paraComando.odoo_id, estado_odoo: estado, recibida_en_odoo: false, nota: "MOCK -- no se llamó a Odoo real (D-08)" },
  };
}

// ── Adaptadores REALES ─────────────────────────────────────────────────────
export const CODIGO_YA_RECIBIDA = "oc_ya_recibida";
export const CODIGO_ESTADO_INVALIDO = "oc_estado_invalido";
export const CODIGO_RECHAZO_ODOO = "odoo_rechazo";

// 'to approve' NO es confirmable: ya se confirmó y espera a que un usuario autorizado la apruebe en Odoo (SGC no aprueba).
const ESTADOS_CONFIRMABLES = new Set(["draft", "sent"]);
const ESTADOS_CONFIRMADOS = new Set(["purchase", "done"]);
const ESTADO_POR_APROBAR = "to approve";
const CAMPOS_OC = ["name", "state", "amount_total", "currency_id", "picking_ids"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const esId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fechaIso = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const error = (mensaje: string, codigo?: string): ResultadoPublicacionOc => ({ estado: "error", error: mensaje, codigo });

/** Mensaje de un fault de Odoo apto para el usuario: sin trazas ni rutas; solo el texto de UserError/ValidationError. */
export function sanearFault(msg: string): string {
  // deno-lint-ignore no-control-regex
  const limpio = msg.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  const m = /^(?:odoo\.exceptions\.)?(UserError|ValidationError|AccessError|MissingError)\b:?\s*(.*)$/s.exec(limpio);
  if (!m) return "Odoo rechazó la operación.";
  if (m[1] === "AccessError") return "La cuenta técnica de Odoo no tiene permiso para esta operación.";
  if (m[1] === "MissingError") return "El registro ya no existe en Odoo.";
  return m[2] ? `Odoo rechazó la operación: ${m[2].slice(0, 200)}` : "Odoo rechazó la operación.";
}

/**
 * Los rechazos de negocio de Odoo (fault XML-RPC: la transacción se revirtió, el
 * resultado es CIERTO) se vuelven estado error con mensaje saneado. Timeouts,
 * caídas y auth se relanzan: el gateway los trata como error con reintento / de infra.
 */
async function conRechazoComoError(fn: () => Promise<ResultadoPublicacionOc>): Promise<ResultadoPublicacionOc> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OdooError && e.codigo === "odoo_error" && e.fault) {
      console.error(`[odoo-oc] rechazo de Odoo: ${e.message}`); // el texto crudo solo queda en el log del servidor
      return error(sanearFault(e.message), CODIGO_RECHAZO_ODOO);
    }
    throw e;
  }
}

interface OcOdoo { id: number; nombre: string; estado: string; total: number; moneda: string | null; recepciones: { nombre: string; estado: string }[] }

/** Lee la OC de Odoo (cabecera + estado de sus recepciones). null si no existe en esta compañía. */
async function leerOc(odoo: OdooClient, domino: unknown[]): Promise<OcOdoo | null> {
  const [f] = await odoo.searchRead("purchase.order", [...domino, ["company_id", "=", odoo.companyId]], CAMPOS_OC, { limit: 1 });
  if (!f) return null;
  const idsPick = Array.isArray(f.picking_ids) ? f.picking_ids.filter(esId) : [];
  const picks = idsPick.length
    ? await odoo.searchRead("stock.picking", [["id", "in", idsPick]], ["name", "state"])
    : [];
  return {
    id: f.id as number, nombre: String(f.name ?? ""), estado: String(f.state ?? ""), total: Number(f.amount_total ?? 0),
    moneda: Array.isArray(f.currency_id) && typeof f.currency_id[1] === "string" ? f.currency_id[1] : null,
    recepciones: picks.map((k) => ({ nombre: String(k.name ?? ""), estado: String(k.state ?? "") })),
  };
}

const resultadoOc = (oc: OcOdoo, extra: Record<string, unknown> = {}): ResultadoPublicacionOc => ({
  estado: "completado",
  // total y moneda: datos de SOLO LECTURA para mostrar; los arma Odoo.
  resultado: { modelo: "purchase.order", odoo_id: oc.id, nombre: oc.nombre, estado_odoo: oc.estado, total: r2(oc.total), moneda: oc.moneda, ...extra },
});

/** Crea la OC (borrador + líneas en UNA transacción de Odoo). Idempotente por `origin`. */
export function crearOcReal(odoo: () => OdooClient): AdaptadorOc {
  return (p) => conRechazoComoError(async () => {
    const lineas = Array.isArray(p.lineas) ? p.lineas as Record<string, unknown>[] : [];
    if (lineas.length === 0) return error("La orden no tiene líneas para publicar.");
    if (!esId(p.odoo_proveedor_id)) return error("El proveedor de la orden no está vinculado a Odoo.");
    if (typeof p.orden_id !== "string" || p.numero === undefined || p.numero === null) return error("Faltan datos de la orden para publicarla.");
    for (const l of lineas) {
      if (!esId(l.odoo_product_id)) return error("Hay líneas sin producto de Odoo vinculado.");
      if (!esNum(l.cantidad) || l.cantidad <= 0) return error("Hay líneas con cantidad no válida.");
      if (!esNum(l.precio_unitario) || l.precio_unitario < 0) return error("Hay líneas con precio no válido.");
      if (l.odoo_uom_id !== undefined && l.odoo_uom_id !== null && !esId(l.odoo_uom_id)) return error("Hay líneas con unidad no válida.");
    }
    const c = odoo();
    const origin = `SGC:${p.numero}:${p.orden_id}`;

    // Idempotencia ante el reintento del usuario (timeout/caída previos): si la OC ya está en Odoo, se devuelve esa.
    const existente = await leerOc(c, [["origin", "=", origin]]);
    if (existente) {
      if (existente.estado === "cancel") {
        return error("Ya existe en Odoo una orden con este origen pero está cancelada. Requiere revisión de Tecnología.", CODIGO_ESTADO_INVALIDO);
      }
      return resultadoOc(existente, { ya_existia: true });
    }

    const entrega = fechaIso(p.fecha_entrega_esperada);
    const fecha = fechaIso(p.fecha);
    const vals: Record<string, unknown> = {
      partner_id: p.odoo_proveedor_id,
      origin,
      company_id: c.companyId,
      // Mediodía: evita que el desfase UTC (RD = UTC-4) mueva la fecha de día.
      ...(fecha ? { date_order: `${fecha} 12:00:00` } : {}),
      // Moneda y total: los pone Odoo (moneda de la compañía). Lo fiscal (impuestos, `aplica_impuesto`
      // del payload de SQL) vive en Odoo: SGC no manda totales ni impuestos y lo ignora.
      // Almacén/tipo de operación: si SGC lo manda (destino → picking type) se usa; si no, el default de Odoo.
      ...(esId(p.odoo_picking_type_id) ? { picking_type_id: p.odoo_picking_type_id } : {}),
      ...(typeof p.notas === "string" && p.notas.trim() ? { notes: `<p>${escHtml(p.notas.trim())}</p>` } : {}),
      order_line: lineas.map((l) => [0, 0, {
        product_id: l.odoo_product_id,
        name: typeof l.descripcion === "string" && l.descripcion.trim() ? l.descripcion.trim() : `Producto ${l.odoo_product_id}`,
        product_qty: l.cantidad,
        price_unit: l.precio_unitario,
        ...(esId(l.odoo_uom_id) ? { product_uom: l.odoo_uom_id } : {}),
        ...(entrega ? { date_planned: `${entrega} 12:00:00` } : {}),
      }]),
    };
    const id = await c.call("purchase.order", "create", [vals]);
    if (!esId(id)) throw new OdooError("odoo_no_disponible", "Odoo no devolvió el id del registro creado: no se sabe si se aplicó.");
    const creada = await leerOc(c, [["id", "=", id]]);
    // La relectura falla = sabemos el id pero no el total: se devuelve lo mínimo sin inventar.
    return creada ? resultadoOc(creada, { ya_existia: false }) : {
      estado: "completado",
      resultado: { modelo: "purchase.order", odoo_id: id, nombre: null, estado_odoo: "draft", total: null, moneda: null, ya_existia: false },
    };
  });
}

type AccionBoton = "confirmar" | "cancelar";

/** Confirmar/cancelar con PRE-VALIDACIÓN en Odoo antes de escribir (ver reglas en cada rama). */
function cambiarEstadoReal(odoo: () => OdooClient, accion: AccionBoton): AdaptadorOc {
  return (p) => conRechazoComoError(async () => {
    if (!esId(p.odoo_id)) return error("La orden todavía no tiene id de Odoo.");
    const c = odoo();
    const oc = await leerOc(c, [["id", "=", p.odoo_id]]);
    if (!oc) return error("La orden no existe en Odoo.", CODIGO_ESTADO_INVALIDO);

    // Ya en el estado destino: éxito idempotente, sin volver a llamar al botón.
    // 'to approve' ya está confirmada: éxito parcial, la aprobación la hace un usuario autorizado en Odoo.
    if (accion === "confirmar" && (ESTADOS_CONFIRMADOS.has(oc.estado) || oc.estado === ESTADO_POR_APROBAR)) return resultadoOc(oc, { idempotente: true });
    if (accion === "cancelar" && oc.estado === "cancel") return resultadoOc(oc, { idempotente: true });

    if (accion === "confirmar" && !ESTADOS_CONFIRMABLES.has(oc.estado)) {
      return error(`La orden está en estado "${oc.estado}" en Odoo y no se puede confirmar.`, CODIGO_ESTADO_INVALIDO);
    }
    if (accion === "cancelar" && oc.estado === "done") {
      return error("La orden está bloqueada (hecha) en Odoo y no se puede cancelar desde SGC.", CODIGO_ESTADO_INVALIDO);
    }
    // Mercadería ya recibida: cancelar dejaría stock sin respaldo; confirmar duplicaría el flujo.
    if (oc.recepciones.some((r) => r.estado === "done")) {
      return error("Esta orden ya fue recibida en Odoo (tiene recepciones realizadas); no se puede " +
        (accion === "confirmar" ? "confirmar" : "cancelar") + " desde SGC.", CODIGO_YA_RECIBIDA);
    }

    await c.call("purchase.order", accion === "confirmar" ? "button_confirm" : "button_cancel", [[oc.id]]);

    const despues = await leerOc(c, [["id", "=", oc.id]]);
    if (!despues) return error("Odoo no devolvió la orden tras la operación; requiere conciliación.", CODIGO_ESTADO_INVALIDO);
    // Confirmar: purchase|done = confirmada; 'to approve' = éxito parcial (doble validación de Odoo).
    const esperado = accion === "confirmar"
      ? ESTADOS_CONFIRMADOS.has(despues.estado) || despues.estado === ESTADO_POR_APROBAR
      : despues.estado === "cancel";
    if (!esperado) {
      return error(`Odoo dejó la orden en estado "${despues.estado}" (requiere revisión en Odoo).`, CODIGO_ESTADO_INVALIDO);
    }
    return resultadoOc(despues, { idempotente: false });
  });
}

/** Refresco (solo lectura): estado actual de la OC en Odoo y si ya tiene una recepción realizada. */
export function refrescarOcReal(odoo: () => OdooClient): AdaptadorOc {
  return (p) => conRechazoComoError(async () => {
    if (!esId(p.odoo_id)) return error("La orden todavía no tiene id de Odoo.");
    const oc = await leerOc(odoo(), [["id", "=", p.odoo_id]]);
    if (!oc) return error("La orden no existe en Odoo.", CODIGO_ESTADO_INVALIDO);
    return resultadoOc(oc, { recibida_en_odoo: oc.recepciones.some((r) => r.estado === "done") });
  });
}

export function crearAdaptadoresOcReales(odoo: () => OdooClient): AdaptadoresOc {
  return {
    crear: crearOcReal(odoo), confirmar: cambiarEstadoReal(odoo, "confirmar"), cancelar: cambiarEstadoReal(odoo, "cancelar"),
    refrescar: refrescarOcReal(odoo),
  };
}

/** Flag de entorno que habilita la escritura real. Cualquier otro valor (o ausente) = mock. */
export const escrituraOdooHabilitada = (get: (k: string) => string | undefined = (k) => Deno.env.get(k)): boolean =>
  get("ODOO_ESCRITURA_HABILITADA") === "true";

export function seleccionarAdaptadoresOc(habilitada: boolean, odoo: () => OdooClient): AdaptadoresOc {
  return habilitada
    ? crearAdaptadoresOcReales(odoo)
    : { crear: publicarOcMock, confirmar: confirmarOcMock, cancelar: cancelarOcMock, refrescar: refrescarOcMock };
}

/** Determinista a partir de una semilla de texto -- nunca Math.random en este runtime. */
function idDeterminista(semilla: string): number {
  let hash = 0;
  for (let i = 0; i < semilla.length; i++) hash = (hash * 31 + semilla.charCodeAt(i)) >>> 0;
  return 900_000 + (hash % 100_000);
}
