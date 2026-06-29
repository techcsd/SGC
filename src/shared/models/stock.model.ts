export interface StockPorBodega {
  articulo_id: string;
  bodega_id: string;
  cantidad: number;
  updated_at: string;
  bodega?: { nombre: string };
}
