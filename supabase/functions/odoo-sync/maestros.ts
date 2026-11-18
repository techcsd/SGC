// Dependencias reales de la verificacion de maestros (lee SGC con service role y Odoo solo con search_read).
import { configDesdeEntorno, OdooClient, POLITICA_POR_DEFECTO } from "../_shared/odoo-client.ts";
import type { DatosMaestro, DepsMaestro } from "../_shared/odoo-maestros.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const TABLA: Record<string, { tabla: string; col: string; esPrueba: boolean }> = {
  articulo: { tabla: "articulos", col: "odoo_product_id", esPrueba: true },
  categoria_inventario: { tabla: "categorias_inventario", col: "odoo_id", esPrueba: false },
  unidad: { tabla: "unidades", col: "odoo_id", esPrueba: false },
  proveedor: { tabla: "proveedores", col: "odoo_id", esPrueba: false },
};

export function clienteMaestros(): OdooClient {
  const politica = { ...POLITICA_POR_DEFECTO, lectura: { ...POLITICA_POR_DEFECTO.lectura, "product.category": ["search_read"], "uom.uom": ["search_read"] } };
  return new OdooClient({ ...configDesdeEntorno(), politica });
}

export function depsMaestros(admin: Any, odoo: OdooClient): DepsMaestro {
  return {
    async cargar(tipo: string, id: string): Promise<DatosMaestro | null> {
      const t = TABLA[tipo]; if (!t) return null;
      const { data } = await admin.from(t.tabla).select(`nombre, ${t.col}${t.esPrueba ? ", es_prueba" : ""}`).eq("id", id).maybeSingle();
      if (!data) return null;
      return { odooId: data[t.col] == null ? null : Number(data[t.col]), nombre: data.nombre ?? null, esPrueba: t.esPrueba ? !!data.es_prueba : false };
    },
    async existe(modelo: string, odooId: number): Promise<boolean> {
      const r = await odoo.call(modelo, "search_read", [[["id", "=", odooId]]], { fields: ["id"], context: { active_test: false }, limit: 1 });
      return Array.isArray(r) && r.length > 0;
    },
  };
}
