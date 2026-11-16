// odoo-sync/documentos.ts -- dependencias reales (BD de SGC + Odoo) de los publicadores del circuito 2 (DS-16..DS-22).
import type { OdooClient } from "../_shared/odoo-client.ts";
import type { DatosEntrada, DepsEntrada } from "../_shared/odoo-recepciones.ts";
import type { DatosConteo, DepsConteo } from "../_shared/odoo-ajustes.ts";
import type { DatosRetiro, DepsRetiro } from "../_shared/odoo-retiros.ts";
import type { DatosConduceExterno, DepsExterno } from "../_shared/odoo-externos.ts";
import type { Marcar } from "../_shared/odoo-evento.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
// El cliente se crea con db.schema="sgc"; su tipo generico no encaja con SupabaseClient<public>.
type SupabaseClient = Any;
const n = (v: unknown) => (v == null ? null : Number(v));

function marcador(admin: SupabaseClient, tabla: string, instanciaId: string): Marcar {
  return async (id, m) => {
    const { error } = await admin.rpc("odoo_v1_marcar_documento_sync", {
      p_tabla: tabla, p_id: id, p_instancia: instanciaId, p_picking: m.picking ?? null, p_estado: m.estado, p_error: m.error ?? null,
    });
    if (error) console.error(`[odoo-sync] marcar ${tabla}:`, error.message);
  };
}
const encolar = (admin: SupabaseClient) => async (tipo: string, id: string, motivo: string) => {
  const { error } = await admin.rpc("odoo_v1_encolar_documento", { p_tipo: tipo, p_id: id, p_motivo: motivo });
  if (error) console.error(`[odoo-sync] encolar ${tipo}:`, error.message);
};

export function depsEntrada(admin: SupabaseClient, odoo: OdooClient, instanciaId: string): DepsEntrada {
  return {
    c: odoo,
    async cargar(id): Promise<DatosEntrada | null> {
      const { data: e } = await admin.from("entradas_inventario").select("*").eq("id", id).maybeSingle();
      if (!e) return null;
      const { data: det } = await admin.from("detalle_entradas").select("cantidad, articulos(nombre, odoo_product_id)").eq("entrada_id", id);
      const { data: bo } = await admin.from("bodegas").select("odoo_location_id, odoo_warehouse_id").eq("id", e.bodega_id).maybeSingle();
      let ocOdooId: number | null = null;
      if (e.orden_compra_id) {
        const { data: oc } = await admin.from("ordenes_compra").select("odoo_id").eq("id", e.orden_compra_id).maybeSingle();
        ocOdooId = n(oc?.odoo_id);
      }
      return {
        id, folio: e.referencia ?? undefined, esPrueba: !!e.es_prueba, pendienteConfirmacion: !!e.pendiente_confirmacion, rechazada: !!e.rechazada,
        origenTipo: e.origen_tipo ?? null, ordenCompraId: e.orden_compra_id ?? null, ocOdooId, salidaId: e.salida_id ?? null,
        bodegaLocationId: n(bo?.odoo_location_id), bodegaWarehouseId: n(bo?.odoo_warehouse_id),
        lineas: (det ?? []).map((l: Any) => ({ nombre: l.articulos?.nombre ?? "artículo", cantidad: Number(l.cantidad), odooProductId: n(l.articulos?.odoo_product_id) })),
        pickingIdPrevio: n(e.odoo_picking_id), companyId: odoo.companyId,
      };
    },
    marcar: marcador(admin, "entradas_inventario", instanciaId),
    encolarSalida: async (salidaId) => {
      const { error } = await admin.rpc("odoo_v1_encolar_salida", { p_salida: salidaId, p_motivo: "entrada_ligada" });
      if (error) console.error("[odoo-sync] encolar salida:", error.message);
    },
  };
}

export function depsConteo(admin: SupabaseClient, odoo: OdooClient, instanciaId: string): DepsConteo {
  return {
    c: odoo,
    async cargar(id): Promise<DatosConteo | null> {
      const { data: k } = await admin.from("conteos_inventario").select("*").eq("id", id).maybeSingle();
      if (!k) return null;
      const { data: it } = await admin.from("conteo_items").select("cantidad_contada, articulos(nombre, odoo_product_id)").eq("conteo_id", id);
      const { data: bo } = await admin.from("bodegas").select("odoo_location_id").eq("id", k.bodega_id).maybeSingle();
      return {
        id, tipo: k.tipo ?? "ajuste", estado: k.estado, esPrueba: !!k.es_prueba, motivo: k.motivo, bodegaLocationId: n(bo?.odoo_location_id),
        lineas: (it ?? []).map((l: Any) => ({ nombre: l.articulos?.nombre ?? "artículo", odooProductId: n(l.articulos?.odoo_product_id), cantidadContada: l.cantidad_contada == null ? null : Number(l.cantidad_contada) })),
      };
    },
    marcar: marcador(admin, "conteos_inventario", instanciaId),
  };
}

export function depsRetiro(admin: SupabaseClient, odoo: OdooClient, instanciaId: string): DepsRetiro {
  return {
    c: odoo,
    async cargar(id): Promise<DatosRetiro | null> {
      const { data: r } = await admin.from("retiros_material").select("*").eq("id", id).maybeSingle();
      if (!r) return null;
      const { data: it } = await admin.from("retiro_material_items").select("descripcion, cantidad, articulos(nombre, odoo_product_id)").eq("retiro_id", id);
      const { data: dest } = r.almacen_destino_id
        ? await admin.from("bodegas").select("odoo_warehouse_id, odoo_location_id, odoo_cuarentena_location_id").eq("id", r.almacen_destino_id).maybeSingle()
        : { data: null };
      const { data: obras } = await admin.from("bodegas").select("odoo_location_id").eq("proyecto_id", r.proyecto_id).eq("activo", true).order("es_principal", { ascending: false }).limit(1);
      return {
        id, folio: r.folio ?? undefined, estado: r.estado, esPrueba: !!r.es_prueba, disposicion: r.disposicion ?? null,
        items: (it ?? []).map((l: Any) => ({ nombre: l.articulos?.nombre ?? l.descripcion ?? "material", cantidad: Number(l.cantidad), odooProductId: n(l.articulos?.odoo_product_id) })),
        obraLocationId: n(obras?.[0]?.odoo_location_id), destinoWarehouseId: n(dest?.odoo_warehouse_id), destinoStockLocationId: n(dest?.odoo_location_id),
        cuarentenaLocationId: n(dest?.odoo_cuarentena_location_id), companyId: odoo.companyId,
      };
    },
    marcar: marcador(admin, "retiros_material", instanciaId),
  };
}

export function depsExterno(admin: SupabaseClient, instanciaId: string): DepsExterno {
  const enc = encolar(admin);
  return {
    async cargar(id): Promise<DatosConduceExterno | null> {
      const { data: x } = await admin.from("conduces_externos").select("*").eq("id", id).maybeSingle();
      if (!x) return null;
      const { data: ret } = await admin.from("retiros_material").select("id").eq("conduce_externo_id", id).limit(1);
      const { data: s } = x.salida_id ? await admin.from("salidas_inventario").select("odoo_picking_salida_id, odoo_picking_entrada_id").eq("id", x.salida_id).maybeSingle() : { data: null };
      const { data: e } = x.entrada_id ? await admin.from("entradas_inventario").select("odoo_picking_id").eq("id", x.entrada_id).maybeSingle() : { data: null };
      return {
        id, numero: x.numero, estado: x.estado, afectaInventario: !!x.afecta_inventario, esPrueba: !!x.es_prueba,
        salidaId: x.salida_id ?? null, entradaId: x.entrada_id ?? null, retiroId: ret?.[0]?.id ?? null,
        salidaPickingA: n(s?.odoo_picking_salida_id), salidaPickingB: n(s?.odoo_picking_entrada_id), entradaPicking: n(e?.odoo_picking_id),
      };
    },
    marcar: marcador(admin, "conduces_externos", instanciaId),
    encolarSalida: async (sid) => {
      const { error } = await admin.rpc("odoo_v1_encolar_salida", { p_salida: sid, p_motivo: "conduce_externo" });
      if (error) console.error("[odoo-sync] encolar salida:", error.message);
    },
    encolarEntrada: (eid) => enc("entrada_inventario", eid, "conduce_externo"),
  };
}
