import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { OdooApiService } from '../../../../shared/services/odoo-api.service';
import { OdooProducto, OdooRespuesta, OdooStockPagina, OdooUbicacion } from '../../../../shared/models/odoo.model';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';
import { Icon } from '../../../../shared/ui/icon/icon';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';

const TAMANO_PAGINA = 25;
const MIN_BUSQUEDA = 2;
const DEBOUNCE_MS = 300;

/**
 * PoC — "Stock en Odoo": lectura directa de existencias (stock.quant agrupado)
 * vía el gateway `odoo-api`. Solo lectura, sin tablas espejo ni fallback local.
 */
@Component({
  selector: 'app-inventario-stock-odoo',
  imports: [ErrorState, Icon, Skeleton, TranslatePipe],
  templateUrl: './stock-odoo.html',
  styleUrl: './stock-odoo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockOdoo implements OnInit, OnDestroy {
  private odoo = inject(OdooApiService);
  private i18n = inject(I18nService);

  /** Texto de la pantalla para el mensaje de error por rol (BS2), traducido. */
  readonly pantallaError = computed(() => this.i18n.t('el stock de Odoo'));

  ubicaciones = signal<OdooUbicacion[]>([]);
  ubicacionesTruncadas = signal(false);
  ubicacionId = signal<number | null>(null);

  termino = signal('');
  sugerencias = signal<OdooProducto[]>([]);
  activo = signal(-1); // índice resaltado del listbox (teclado)
  buscando = signal(false);
  errorBusqueda = signal(false);
  producto = signal<OdooProducto | null>(null);

  pagina = signal(1);
  resultado = signal<OdooRespuesta<OdooStockPagina> | null>(null);
  loading = signal(false);
  error = signal<unknown>(null);

  // Contadores de secuencia: una respuesta vieja nunca pisa a una más reciente.
  private seqStock = 0;
  private seqBusqueda = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  /** Hora local del dato (el real de Odoo, no el de la petición). */
  consultadoEn = computed(() => {
    const iso = this.resultado()?.consultado_en;
    return iso ? new Date(iso).toLocaleTimeString() : '';
  });
  desdeCache = computed(() => this.resultado()?.cache === 'hit');

  async ngOnInit() {
    this.error.set(null);
    try {
      const r = await this.odoo.listarUbicaciones();
      this.ubicaciones.set(r.data.ubicaciones);
      this.ubicacionesTruncadas.set(r.data.truncado);
    } catch (e) {
      this.error.set(e);
      return;
    }
    await this.consultar();
  }

  ngOnDestroy() {
    if (this.temporizador) clearTimeout(this.temporizador);
  }

  // ── Buscador de producto (debounce + descarte de respuestas viejas) ──
  onTexto(valor: string) {
    this.termino.set(valor);
    // Editar el texto invalida el producto elegido: el filtro nunca queda desincronizado.
    if (this.producto() && valor !== this.producto()?.nombre) {
      this.producto.set(null);
      this.pagina.set(1);
      void this.consultar();
    }
    this.activo.set(-1);
    if (this.temporizador) clearTimeout(this.temporizador);
    if (valor.trim().length < MIN_BUSQUEDA || this.producto()) {
      this.seqBusqueda++;
      this.sugerencias.set([]);
      this.buscando.set(false);
      this.errorBusqueda.set(false);
      return;
    }
    this.buscando.set(true);
    this.temporizador = setTimeout(() => void this.buscar(valor.trim()), DEBOUNCE_MS);
  }

  private async buscar(valor: string) {
    const id = ++this.seqBusqueda;
    this.errorBusqueda.set(false);
    try {
      const encontrados = await this.odoo.buscarProductos(valor);
      if (id !== this.seqBusqueda) return;
      this.sugerencias.set(encontrados);
    } catch {
      // Un fallo del autocompletado NO tumba la tabla ya cargada: error propio junto al input.
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
      void this.elegirProducto(this.sugerencias()[this.activo()]);
    }
  }

  async elegirProducto(p: OdooProducto) {
    this.seqBusqueda++; // cancela cualquier búsqueda en vuelo
    if (this.temporizador) clearTimeout(this.temporizador);
    this.producto.set(p);
    this.termino.set(p.nombre);
    this.sugerencias.set([]);
    this.activo.set(-1);
    this.buscando.set(false);
    this.pagina.set(1);
    await this.consultar();
  }

  async limpiarProducto() {
    this.seqBusqueda++;
    this.producto.set(null);
    this.termino.set('');
    this.sugerencias.set([]);
    this.errorBusqueda.set(false);
    this.pagina.set(1);
    await this.consultar();
  }

  async onUbicacion(valor: string) {
    this.ubicacionId.set(valor ? Number(valor) : null);
    this.pagina.set(1);
    await this.consultar();
  }

  async irA(pagina: number) {
    if (pagina < 1) return;
    this.pagina.set(pagina);
    await this.consultar();
  }

  async actualizar() {
    await this.consultar(true);
  }

  async consultar(refrescar = false) {
    const id = ++this.seqStock;
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.odoo.consultarStock({
        producto_id: this.producto()?.id ?? null,
        ubicacion_id: this.ubicacionId(),
        pagina: this.pagina(),
        tamano: TAMANO_PAGINA,
        refrescar,
      });
      if (id !== this.seqStock) return; // llegó otra consulta más reciente
      this.resultado.set(r);
    } catch (e) {
      if (id !== this.seqStock) return;
      this.resultado.set(null);
      this.error.set(e);
    } finally {
      if (id === this.seqStock) this.loading.set(false);
    }
  }
}
