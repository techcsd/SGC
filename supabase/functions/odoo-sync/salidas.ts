// odoo-sync/salidas.ts -- dependencias reales (BD de SGC + Odoo) para publicar salidas como traslados A/B (DS-10/DS-11).
import type { OdooClient } from "../_shared/odoo-client.ts";
import { cancelarTraslado, crearTraslado, devolverTraslado, validarTraslado, buscarPickingPorOrigin, type LlamadorOdoo } from "../_shared/odoo-traslados.ts";
import type { Biblioteca, DatosSalida, DepsSalida } from "../_shared/odoo-salidas.ts";
import { adjuntarPdfAPicking, nombreAdjuntoConduce } from "../_shared/odoo-adjuntos.ts";

function aBase64(b: Uint8Array): string {
  let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// deno-lint-ignore no-explicit-any
type Any = any;
// El cliente se crea con db.schema="sgc"; su tipo generico no encaja con SupabaseClient<public>.
type SupabaseClient = Any;

export function bibliotecaReal(c: LlamadorOdoo): Biblioteca {
  let transito: number | null = null;
  const tipos = new Map<number, number>();
  return {
    buscar: (o) => buscarPickingPorOrigin(c, o).then((p) => (p ? { id: p.id, state: p.state } : null)),
    crear: (e) => crearTraslado(c, e),
    validar: (id) => validarTraslado(c, id),
    cancelar: (id) => cancelarTraslado(c, id),
    devolver: (id, paso, salidaId, companyId, secuencia, items) => devolverTraslado(c, id, { salidaId, paso, companyId, secuencia, items }),
    complementos: async (prefijo) => (await c.call("stock.picking", "search_read", [[["origin", "=like", `${prefijo}%`]]], { fields: ["state"], limit: 20, order: "id asc" }) ?? []).map((x: Any) => ({ id: x.id, state: x.state })),
    // DS-20: cantidades ya publicadas (pickings con ese prefijo de origin; sin cancelados ni devoluciones -D<n>)
    async publicado(prefijo) {
      const pk = await c.call("stock.picking", "search_read", [[["origin", "=like", `${prefijo}%`], ["state", "!=", "cancel"]]], { fields: ["origin", "move_ids"], limit: 50 });
      const m = new Map<number, number>();
      for (const p of (pk ?? []).filter((x: Any) => !/-D\d+$/.test(x.origin ?? ""))) {
        const mv = await c.call("stock.move", "read", [p.move_ids], { fields: ["product_id", "product_uom_qty", "state"] });
        for (const x of mv ?? []) if (x.state !== "cancel") m.set(x.product_id[0], (m.get(x.product_id[0]) ?? 0) + Number(x.product_uom_qty));
      }
      return m;
    },
    async transitoLocationId() {
      if (transito != null) return transito;
      const r = await c.call("stock.location", "search_read", [[["usage", "=", "transit"], ["active", "=", true]]], { fields: ["id"], limit: 2 });
      if (!Array.isArray(r) || r.length !== 1) throw new Error("No hay una única ubicación de tránsito en Odoo.");
      return (transito = r[0].id);
    },
    async tipoInterno(warehouseId) {
      const hit = tipos.get(warehouseId); if (hit != null) return hit;
      const r = await c.call("stock.warehouse", "search_read", [[["id", "=", warehouseId]]], { fields: ["int_type_id"], limit: 1 });
      const id = r?.[0]?.int_type_id?.[0]; if (!id) throw new Error("El almacén no tiene tipo de operación interna.");
      tipos.set(warehouseId, id); return id;
    },
  };
}

export function depsReales(admin: SupabaseClient, odoo: OdooClient, instanciaId: string): DepsSalida {
  return {
    lib: bibliotecaReal(odoo),
    async cargar(id): Promise<DatosSalida | null> {
      const { data: s } = await admin.from("salidas_inventario").select("*").eq("id", id).maybeSingle();
      if (!s) return null;
      const { data: det } = await admin.from("detalle_salidas").select("cantidad, cantidad_recibida, articulos(nombre, odoo_product_id)").eq("salida_id", id);
      const { data: bo } = await admin.from("bodegas").select("odoo_location_id, odoo_warehouse_id").eq("id", s.bodega_id).maybeSingle();
      let destinoId: number | null = null;
      if (s.destino_almacen_id) {
        const { data } = await admin.from("bodegas").select("odoo_location_id").eq("id", s.destino_almacen_id).maybeSingle();
        destinoId = data?.odoo_location_id ?? null;
      } else if (s.proyecto_id) {
        // EB-12: si la obra tiene su propia ubicacion vinculada en Odoo (obra_ubicaciones), ESA es el destino; si no, la bodega de la obra (como siempre).
        const { data: ou } = await admin.from("obra_ubicaciones").select("odoo_location_id").eq("proyecto_id", s.proyecto_id).eq("activa", true).maybeSingle();
        if (ou?.odoo_location_id) destinoId = Number(ou.odoo_location_id);
        else {
          const { data } = await admin.from("bodegas").select("odoo_location_id").eq("proyecto_id", s.proyecto_id).eq("activo", true).limit(1);
          destinoId = data?.[0]?.odoo_location_id ?? null;
        }
      }
      let paradaEntregada = false;
      if (s.ruta_parada_id) {
        const { data } = await admin.from("ruta_paradas").select("estado").eq("id", s.ruta_parada_id).maybeSingle();
        paradaEntregada = data?.estado === "entregada";
      }
      // DS-17/DS-19: una ENTRADA confirmada ligada a la salida (recepcion en obra / devolucion de obra con descuento) completa el paso B.
      const { data: ent } = await admin.from("entradas_inventario").select("bodega_id, pendiente_confirmacion, rechazada").eq("salida_id", id).limit(5);
      const entradaOk = (ent ?? []).find((e: Any) => !e.pendiente_confirmacion && !e.rechazada);
      if (entradaOk && destinoId == null) {
        const { data } = await admin.from("bodegas").select("odoo_location_id").eq("id", entradaOk.bodega_id).maybeSingle();
        destinoId = data?.odoo_location_id ?? null;
      }
      // W3: faltantes ya resueltos EN ODOO (aprobado/rechazado y sincronizado): al compensar el paso A no se devuelven de nuevo.
      const { data: sol } = await admin.from("odoo_solicitudes_ajuste").select("faltante, articulos(odoo_product_id)").eq("salida_id", id).in("estado", ["aprobada", "rechazada"]).eq("odoo_sync_estado", "sincronizado");
      const faltanteResuelto = (sol ?? []).filter((x: Any) => x.articulos?.odoo_product_id).map((x: Any) => ({ productId: Number(x.articulos.odoo_product_id), cantidad: Number(x.faltante) }));
      return {
        faltanteResuelto,
        entradaConfirmada: !!entradaOk,
        id, folio: s.folio ?? s.codigo ?? undefined, estado: s.estado, esPrueba: !!s.es_prueba, paradaEntregada,
        lineas: (det ?? []).map((d: Any) => ({ nombre: d.articulos?.nombre ?? "artículo", cantidad: Number(d.cantidad), cantidadRecibida: d.cantidad_recibida == null ? null : Number(d.cantidad_recibida), odooProductId: d.articulos?.odoo_product_id ?? null })),
        origenLocationId: bo?.odoo_location_id ?? null, origenWarehouseId: bo?.odoo_warehouse_id ?? null, destinoLocationId: destinoId,
        companyId: odoo.companyId,
      };
    },
    // DS-28 (ADR 19): PDF firmado como adjunto del picking. Solo con la fase `expansion` encendida y si el conduce ya tiene su PDF guardado.
    async adjuntarPdf(pickingId, paso, s) {
      const { data: fase } = await admin.from("odoo_fases").select("habilitada").eq("clave", "expansion").maybeSingle();
      if (!fase?.habilitada) return null;
      const { data: fila } = await admin.from("salidas_inventario").select("pdf_firmado_path").eq("id", s.id).maybeSingle();
      if (!fila?.pdf_firmado_path) return null;
      const { data: blob, error } = await admin.storage.from("conduces").download(fila.pdf_firmado_path);
      if (error || !blob) throw new Error("No se pudo leer el PDF firmado.");
      const folio = `CND-${s.id.slice(0, 8).toUpperCase()}`;
      return await adjuntarPdfAPicking(odoo, pickingId, { nombre: nombreAdjuntoConduce(folio, paso), base64: aBase64(new Uint8Array(await blob.arrayBuffer())) });
    },
    async marcar(id, m) {
      const { error } = await admin.rpc("odoo_v1_marcar_salida_sync", {
        p_salida: id, p_instancia: instanciaId, p_picking_a: m.a ?? null, p_picking_b: m.b ?? null, p_estado: m.estado, p_error: m.error ?? null,
      });
      if (error) console.error("[odoo-sync] marcar_salida_sync:", error.message);
    },
  };
}
