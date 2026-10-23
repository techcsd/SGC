import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { OdooApiService } from '../../../../shared/services/odoo-api.service';
import { OdooProducto, OdooStockPagina, OdooUbicacion } from '../../../../shared/models/odoo.model';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';
import { Icon } from '../../../../shared/ui/icon/icon';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

const TAMANO_PAGINA = 25;
const MIN_BUSQUEDA = 2;

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
export class StockOdoo implements OnInit {
  private odoo = inject(OdooApiService);

  ubicaciones = signal<OdooUbicacion[]>([]);
  ubicacionId = signal<number | null>(null);

  termino = signal('');
  sugerencias = signal<OdooProducto[]>([]);
  buscando = signal(false);
  producto = signal<OdooProducto | null>(null);

  pagina = signal(1);
  resultado = signal<OdooStockPagina | null>(null);
  loading = signal(false);
  error = signal<unknown>(null);

  async ngOnInit() {
    try {
      this.ubicaciones.set(await this.odoo.listarUbicaciones());
    } catch (e) {
      this.error.set(e);
      return;
    }
    await this.consultar();
  }

  async buscarProducto(valor: string) {
    this.termino.set(valor);
    if (valor.trim().length < MIN_BUSQUEDA) {
      this.sugerencias.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      const encontrados = await this.odoo.buscarProductos(valor.trim());
      // Descarta respuestas viejas si el usuario siguió escribiendo.
      if (this.termino() === valor) this.sugerencias.set(encontrados);
    } catch (e) {
      this.error.set(e);
    } finally {
      this.buscando.set(false);
    }
  }

  async elegirProducto(p: OdooProducto) {
    this.producto.set(p);
    this.termino.set(p.nombre);
    this.sugerencias.set([]);
    this.pagina.set(1);
    await this.consultar();
  }

  async limpiarProducto() {
    this.producto.set(null);
    this.termino.set('');
    this.sugerencias.set([]);
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

  async consultar() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.resultado.set(
        await this.odoo.consultarStock({
          producto_id: this.producto()?.id ?? null,
          ubicacion_id: this.ubicacionId(),
          pagina: this.pagina(),
          tamano: TAMANO_PAGINA,
        }),
      );
    } catch (e) {
      this.resultado.set(null);
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }
}
