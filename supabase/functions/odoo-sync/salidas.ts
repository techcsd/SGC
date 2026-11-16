// odoo-sync/salidas.ts -- dependencias reales (BD de SGC + Odoo) para publicar salidas como traslados A/B (DS-10/DS-11).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { OdooClient } from "../_shared/odoo-client.ts";
import { cancelarTraslado, crearTraslado, devolverTraslado, validarTraslado, buscarPickingPorOrigin, type LlamadorOdoo } from "../_shared/odoo-traslados.ts";
import type { Biblioteca, DatosSalida, DepsSalida } from "../_shared/odoo-salidas.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export function bibliotecaReal(c: LlamadorOdoo): Biblioteca {
  let transito: number | null = null;
  const tipos = new Map<number, number>();
  return {
    buscar: (o) => buscarPickingPorOrigin(c, o).then((p) => (p ? { id: p.id, state: p.state } : null)),
    crear: (e) => crearTraslado(c, e),
    validar: (id) => validarTraslado(c, id),
    cancelar: (id) => cancelarTraslado(c, id),
    devolver: (id, paso, salidaId, companyId) => devolverTraslado(c, id, { salidaId, paso, companyId }),
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
        const { data } = await admin.from("bodegas").select("odoo_location_id").eq("proyecto_id", s.proyecto_id).eq("activo", true).limit(1);
        destinoId = data?.[0]?.odoo_location_id ?? null;
      }
      let paradaEntregada = false;
      if (s.ruta_parada_id) {
        const { data } = await admin.from("ruta_paradas").select("estado").eq("id", s.ruta_parada_id).maybeSingle();
        paradaEntregada = data?.estado === "entregada";
      }
      return {
        id, folio: s.folio ?? s.codigo ?? undefined, estado: s.estado, esPrueba: !!s.es_prueba, paradaEntregada,
        lineas: (det ?? []).map((d: Any) => ({ nombre: d.articulos?.nombre ?? "artículo", cantidad: Number(d.cantidad), cantidadRecibida: d.cantidad_recibida == null ? null : Number(d.cantidad_recibida), odooProductId: d.articulos?.odoo_product_id ?? null })),
        origenLocationId: bo?.odoo_location_id ?? null, origenWarehouseId: bo?.odoo_warehouse_id ?? null, destinoLocationId: destinoId,
        companyId: odoo.companyId,
      };
    },
    async marcar(id, m) {
      const { error } = await admin.rpc("odoo_v1_marcar_salida_sync", {
        p_salida: id, p_instancia: instanciaId, p_picking_a: m.a ?? null, p_picking_b: m.b ?? null, p_estado: m.estado, p_error: m.error ?? null,
      });
      if (error) console.error("[odoo-sync] marcar_salida_sync:", error.message);
    },
  };
}
