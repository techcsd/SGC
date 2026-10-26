import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { edgeErrorDetail } from '../utils/edge.util';
import {
  OdooAccion,
  OdooProducto,
  OdooProductoCompra,
  OdooRespuesta,
  OdooStockFiltro,
  OdooStockPagina,
  OdooUbicaciones,
} from '../models/odoo.model';

/**
 * PoC Odoo — transporte tipado al gateway `odoo-api` (solo lectura). El navegador
 * solo manda `accion` + parámetros; modelo/método/dominio los fija el servidor.
 * Sin fallback a tablas locales: si Odoo falla, el error sube tal cual para que
 * `app-error-state` lo presente por rol (BS2). El gateway cachea con TTL corto por
 * tipo de dato; cada respuesta declara cuándo se leyó de Odoo (`consultado_en`).
 */
@Injectable({ providedIn: 'root' })
export class OdooApiService {
  private supabase = inject(SupabaseService);

  async buscarProductos(termino: string, limite = 20): Promise<OdooProducto[]> {
    const r = await this.invocar<{ productos: OdooProducto[] }>('productos.buscar', { termino, limite });
    return r.data.productos;
  }

  /** CY24 (#24, D1) — selector de producto Odoo en "crear OC": filtra por
   *  purchase_ok, no por type='product' (E2/E8 — un servicio también se compra). */
  async buscarProductosCompra(termino: string, limite = 20): Promise<OdooProductoCompra[]> {
    const r = await this.invocar<{ productos: OdooProductoCompra[] }>('productos.buscar_compra', { termino, limite });
    return r.data.productos;
  }

  listarUbicaciones(refrescar = false): Promise<OdooRespuesta<OdooUbicaciones>> {
    return this.invocar<OdooUbicaciones>('ubicaciones.listar', { refrescar });
  }

  consultarStock(filtro: OdooStockFiltro): Promise<OdooRespuesta<OdooStockPagina>> {
    return this.invocar<OdooStockPagina>('stock.consultar', { ...filtro });
  }

  private async invocar<T>(accion: OdooAccion, params: Record<string, unknown>): Promise<OdooRespuesta<T>> {
    const { data, error } = await this.supabase.client.functions.invoke('odoo-api', {
      body: { accion, params },
    });
    if (error) {
      const d = await edgeErrorDetail(error);
      const status = (error as { context?: { status?: number } }).context?.status;
      // 403 → el util de BS2 lo reconoce como acceso denegado (mensaje por rol).
      // El código técnico va entre corchetes: lo muestra solo `app-error-state` a desarrolladores.
      const detalle = d.code ? `${d.message} [${d.code}]` : d.message;
      throw new Error(status === 403 ? `forbidden: ${d.message}` : detalle);
    }
    if (!data || typeof data !== 'object' || !('data' in data)) {
      throw new Error('Respuesta inesperada del gateway de Odoo.');
    }
    return data as OdooRespuesta<T>;
  }
}
