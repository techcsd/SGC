// DX12.3 — herramientas de SOLO LECTURA sobre Odoo para Compa y el conector MCP. Se implementan UNA vez aquí y
// `herramientas.ts` las añade a TOOLS. Todo pasa por la edge `odoo-api` (guardia de host, módulo inventario/compras
// o admin, límite por usuario, circuito) con el JWT del propio usuario: no hay service role ni escritura, y no se
// exponen datos contables ni de nómina (odoo-api no ofrece esas acciones). Interruptor: `parametros.odoo_herramientas_ia`
// (APAGADO por defecto; se consulta con la RPC `odoo_herramientas_ia_activo()`).

// deno-lint-ignore no-explicit-any
type Any = any;

export const MAX_FILAS_ODOO_IA = 50;
export const TOOLS_ODOO = ["consultar_stock_odoo", "consultar_oc_odoo", "estado_sincronizacion_odoo"] as const;

export const DEFINICIONES_ODOO = [
  {
    name: "consultar_stock_odoo",
    description: "Existencias EN VIVO en Odoo (solo lectura). Pasa 'articulo' (nombre o código, mín. 2 letras); opcional 'almacen' (texto para filtrar por almacén/ubicación). Máx. 50 filas. Requiere inventario o compras.",
    modulos: ["inventario", "compras"], canales: ["compa", "mcp"] as ("compa" | "mcp")[],
    input_schema: { type: "object", properties: { articulo: { type: "string" }, almacen: { type: "string" } }, required: ["articulo"] },
    odoo: true,
  },
  {
    name: "consultar_oc_odoo",
    description: "Estado EN VIVO de una orden de compra en Odoo (solo lectura): estado, total, proveedor, recepciones. Pasa 'orden_id' (ID numérico de Odoo de la OC). Requiere compras o inventario.",
    modulos: ["compras", "inventario"], canales: ["compa", "mcp"] as ("compa" | "mcp")[],
    input_schema: { type: "object", properties: { orden_id: { type: ["integer", "string"] } }, required: ["orden_id"] },
    odoo: true,
  },
  {
    name: "estado_sincronizacion_odoo",
    description: "Salud de la sincronización SGC↔Odoo: último intento correcto, errores en 24 h y conduces en modo degradado. Solo lectura. Requiere tecnología.",
    modulos: ["tecnologia"], canales: ["compa", "mcp"] as ("compa" | "mcp")[],
    input_schema: { type: "object", properties: {} },
    odoo: true,
  },
];

const err = (message: string) => ({ data: null, error: { message } });

async function llamarOdoo(supabase: Any, accion: string, params: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("odoo-api", { body: { accion, params } });
  if (error) {
    let msg = "No se pudo consultar Odoo ahora.";
    try { const b = await error.context?.json?.(); if (b?.error) msg = String(b.error); } catch { /* sin cuerpo */ }
    return { ok: false as const, msg };
  }
  if (data?.error) return { ok: false as const, msg: String(data.error) };
  return { ok: true as const, data: data?.data ?? data };
}

/** Recorta cualquier lista a MAX_FILAS_ODOO_IA y avisa si hubo más. */
export function acotarFilas<T>(filas: T[], max = MAX_FILAS_ODOO_IA): { filas: T[]; truncado: boolean } {
  return { filas: filas.slice(0, max), truncado: filas.length > max };
}

export async function ejecutarHerramientaOdoo(supabase: Any, name: string, input: Any): Promise<{ data: unknown; error: { message: string } | null }> {
  const { data: activo } = await supabase.schema("sgc").rpc("odoo_herramientas_ia_activo");
  if (activo !== true) return err("Las consultas a Odoo desde la IA están desactivadas por ahora. Pídele a Tecnología que las active.");

  if (name === "estado_sincronizacion_odoo") {
    const { data, error } = await supabase.schema("sgc").rpc("odoo_estado_sincronizacion");
    if (error) return err("No tienes acceso al estado de la sincronización.");
    return { error: null, data };
  }

  if (name === "consultar_oc_odoo") {
    const id = Number(input?.orden_id);
    if (!Number.isSafeInteger(id) || id <= 0) return err("orden_id debe ser el ID numérico de Odoo de la orden de compra.");
    const r = await llamarOdoo(supabase, "compras.obtener", { orden_id: id });
    if (!r.ok) return err(r.msg);
    const o = (r.data as Any)?.orden;
    if (!o) return { error: null, data: { encontrada: false } };
    // Solo estado logístico/comercial básico: sin líneas de costo, sin datos contables.
    return { error: null, data: { encontrada: true, id: o.id, nombre: o.nombre, estado: o.estado, total: o.total, moneda: o.moneda, fecha: o.fecha, proveedor: o.proveedor?.nombre ?? null, recepciones_hechas: o.recepciones_hechas, recepciones_total: o.recepciones_total, recibida_en_odoo: o.recibida_en_odoo } };
  }

  if (name === "consultar_stock_odoo") {
    const termino = String(input?.articulo ?? "").trim();
    const p = await llamarOdoo(supabase, "productos.buscar", { termino, limite: 5 });
    if (!p.ok) return err(p.msg);
    const productos = ((p.data as Any)?.productos ?? []) as Any[];
    if (!productos.length) return { error: null, data: { filas: [], nota: "Sin artículos que coincidan en Odoo." } };
    const filtro = String(input?.almacen ?? "").trim().toLowerCase();
    let filas: Any[] = [];
    for (const prod of productos) {
      const s = await llamarOdoo(supabase, "stock.consultar", { producto_id: prod.id, tamano: MAX_FILAS_ODOO_IA });
      if (!s.ok) return err(s.msg);
      filas = filas.concat((((s.data as Any)?.filas ?? []) as Any[]).map((f) => ({
        articulo: prod.nombre, codigo: prod.codigo, unidad: prod.unidad, ubicacion: f.ubicacion?.nombre ?? null,
        fisica: f.cantidad_fisica, reservada: f.cantidad_reservada, disponible: f.cantidad_disponible,
      })));
    }
    if (filtro) filas = filas.filter((f) => String(f.ubicacion ?? "").toLowerCase().includes(filtro));
    const { filas: out, truncado } = acotarFilas(filas);
    return { error: null, data: { filas: out, truncado } };
  }
  return err("Herramienta de Odoo desconocida.");
}
