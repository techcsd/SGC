import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { OdooApiService } from '../../services/odoo-api.service';
import { ArticulosService } from '../../services/articulos.service';
import {
  OdooProducto,
  OdooProductoCompra,
  OdooProductoInventario,
  OdooProductoInventarioSeleccionado,
} from '../../models/odoo.model';
import { Icon } from '../icon/icon';
import { TranslatePipe } from '../../i18n/translate.pipe';

const MIN_BUSQUEDA = 2;
const DEBOUNCE_MS = 300;

/**
 * Selector de producto de Odoo.
 * - modo `compra` (CY24): busca con purchase_ok y pide alta si no existe.
 * - modo `inventario` (#catálogo directo): busca product.product (no purchase_ok)
 *   y muestra la existencia viva de la bodega de origen en cada resultado.
 *   Al elegir, hace upsert de la proyección en sgc.articulos. Sin fallback
 *   silencioso al catálogo local si Odoo no responde.
 */
@Component({
  selector: 'app-odoo-producto-picker',
  imports: [Icon, TranslatePipe, DecimalPipe],
  templateUrl: './odoo-producto-picker.html',
  styleUrl: './odoo-producto-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OdooProductoPicker {
  private odoo = inject(OdooApiService);
  private articulos = inject(ArticulosService);

  modo = input<'compra' | 'inventario'>('compra');
  value = input<OdooProductoCompra | OdooProducto | null>(null);
  disabled = input<boolean>(false);
  /** Almacén SGC de origen: obligatorio en modo inventario para leer stock.quant. */
  bodegaId = input<string | null>(null);
  /** Si Odoo está caído (sin contingencia), se bloquea la búsqueda. */
  bloqueado = input<boolean>(false);
  bloqueadoMotivo = input<string | null>(null);

  selectionChange = output<OdooProductoCompra | null>();
  /** Emite el término ya buscado y confirmado "no existe" (criterio 7: anti-duplicado). */
  solicitarAlta = output<string>();
  /** Modo inventario: producto elegido + articulo_id de la proyección. */
  inventarioElegido = output<OdooProductoInventarioSeleccionado>();

  termino = signal('');
  sugerencias = signal<OdooProductoInventario[]>([]);
  buscando = signal(false);
  errorBusqueda = signal(false);
  errorStock = signal(false);
  errorUpsert = signal('');
  consultadoEn = signal<string | null>(null);
  activo = signal(-1);
  confirmoNoExiste = signal(false);

  private seqBusqueda = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  get esInventario(): boolean {
    return this.modo() === 'inventario';
  }

  get sinBodega(): boolean {
    return this.esInventario && !this.bodegaId();
  }

  get inputDisabled(): boolean {
    return this.disabled() || this.bloqueado() || this.sinBodega;
  }

  onTexto(valor: string) {
    this.termino.set(valor);
    this.confirmoNoExiste.set(false);
    this.activo.set(-1);
    this.errorUpsert.set('');
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.inputDisabled || valor.trim().length < MIN_BUSQUEDA) {
      this.seqBusqueda++;
      this.sugerencias.set([]);
      this.buscando.set(false);
      this.errorBusqueda.set(false);
      this.errorStock.set(false);
      return;
    }
    this.buscando.set(true);
    this.temporizador = setTimeout(() => void this.buscar(valor.trim()), DEBOUNCE_MS);
  }

  private async buscar(valor: string) {
    const id = ++this.seqBusqueda;
    this.errorBusqueda.set(false);
    this.errorStock.set(false);
    try {
      const encontrados = this.esInventario
        ? await this.odoo.buscarProductos(valor)
        : await this.odoo.buscarProductosCompra(valor);
      if (id !== this.seqBusqueda) return;
      let filas: OdooProductoInventario[] = encontrados.map((p) => ({ ...p, disponible: null }));
      const bodega = this.bodegaId();
      if (this.esInventario && bodega && filas.length) {
        try {
          const r = await this.odoo.disponibleProductos(bodega, filas.map((p) => p.id), true);
          if (id !== this.seqBusqueda) return;
          const mapa = new Map(r.data.filas.map((f) => [f.producto_id, f.disponible]));
          filas = filas.map((p) => ({ ...p, disponible: mapa.get(p.id) ?? 0 }));
          this.consultadoEn.set(r.data.consultado_en ?? r.consultado_en ?? null);
          this.errorStock.set(r.data.origen !== 'odoo');
        } catch {
          if (id !== this.seqBusqueda) return;
          // No hay fallback al stock local: se muestran los productos pero sin existencia.
          this.errorStock.set(true);
          this.consultadoEn.set(null);
          filas = filas.map((p) => ({ ...p, disponible: null }));
        }
      }
      this.sugerencias.set(filas);
    } catch {
      // Un fallo de Odoo no cae a un fallback de sgc.articulos; se avisa y punto.
      if (id !== this.seqBusqueda) return;
      this.sugerencias.set([]);
      this.errorBusqueda.set(true);
    } finally {
      if (id === this.seqBusqueda) this.buscando.set(false);
    }
  }

  onTeclas(ev: KeyboardEvent) {
    const n = this.sugerencias().length;
    if (ev.key === 'Escape') {
      this.sugerencias.set([]);
      this.activo.set(-1);
    } else if (n > 0 && ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.activo.update((i) => (i + 1) % n);
    } else if (n > 0 && ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.activo.update((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (ev.key === 'Enter' && this.activo() >= 0) {
      ev.preventDefault();
      void this.elegir(this.sugerencias()[this.activo()]);
    }
  }

  async elegir(p: OdooProductoInventario) {
    this.seqBusqueda++;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.errorUpsert.set('');
    if (this.esInventario) {
      try {
        const r = await this.articulos.upsertProyeccionOdoo({
          odoo_product_id: p.id,
          nombre: p.nombre,
          codigo: p.codigo,
          unidad: p.unidad,
          odoo_template_id: p.plantilla_id ?? null,
          odoo_uom_id: p.unidad_id ?? null,
          odoo_categ_id: p.categoria_id ?? null,
          categoria_nombre: p.categoria,
          snapshot: { ...p, consultado_en: this.consultadoEn() },
        });
        this.termino.set('');
        this.sugerencias.set([]);
        this.activo.set(-1);
        this.inventarioElegido.emit({
          articuloId: r.id,
          creado: r.creado,
          producto: p,
        });
        this.selectionChange.emit({ ...p, unidad_compra: null, unidad_compra_id: null });
      } catch (e: unknown) {
        this.errorUpsert.set(e instanceof Error ? e.message : 'No se pudo registrar el producto de Odoo.');
      }
      return;
    }
    this.termino.set('');
    this.sugerencias.set([]);
    this.activo.set(-1);
    this.selectionChange.emit(p as OdooProductoCompra);
  }

  limpiar() {
    this.selectionChange.emit(null);
    this.termino.set('');
    this.sugerencias.set([]);
    this.confirmoNoExiste.set(false);
    this.errorUpsert.set('');
  }

  get sinResultados(): boolean {
    return this.termino().trim().length >= MIN_BUSQUEDA && !this.buscando() && !this.errorBusqueda() && this.sugerencias().length === 0;
  }

  pedirAlta() {
    const termino = this.termino().trim();
    if (!this.confirmoNoExiste() || !termino) return;
    this.solicitarAlta.emit(termino);
    this.termino.set('');
    this.confirmoNoExiste.set(false);
  }
}
