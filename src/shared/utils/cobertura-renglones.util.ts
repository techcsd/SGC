/** Renglón mínimo para calcular cobertura de stock. */
export interface RenglonCobertura {
  articulo_id?: string | null;
  /** Artículo elegido para despachar («Cambiar artículo»); manda sobre el de origen. */
  articulo_despacho_id?: string | null;
  cantidad?: number | null;
}

/**
 * EB8 (R-01) — renglones de un pedido que un almacén cubre con su stock.
 * El artículo que cuenta es el que se va a DESPACHAR (`articulo_despacho_id`), no el de origen: si la persona
 * cambió «ARNES SEGURIDAD» por «ARNES WADFOW», Bodega Central (26 u del WADFOW) debe salir «cubre 1/1» y no «0/1»,
 * lo que además hacía que la preselección saltara a la bodega de la obra (4 u).
 */
export function renglonesCubiertos(renglones: RenglonCobertura[], stock: Record<string, number>): number {
  return renglones.filter((i) => {
    const articulo = i.articulo_despacho_id || i.articulo_id;
    return !!articulo && (stock[articulo] ?? 0) >= (i.cantidad ?? 0);
  }).length;
}
