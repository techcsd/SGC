import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { BodegaOdooFila, CuentaAnaliticaFila, OdooHomologacionService, PropuestaCatalogoFila } from '../../../../shared/services/odoo-homologacion.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { DecimalPipe } from '@angular/common';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { presentarError } from '../../../../shared/utils/friendly-error.util';

/** DS-05/DS-06 — Homologación SGC ↔ Odoo: cuentas analíticas por obra y almacenes. */
@Component({
  selector: 'app-tec-odoo-homologacion',
  imports: [Skeleton, TranslatePipe, DecimalPipe],
  templateUrl: './odoo-homologacion.html',
  styleUrl: './odoo-homologacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecOdooHomologacion implements OnInit {
  private svc = inject(OdooHomologacionService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  cuentas = signal<CuentaAnaliticaFila[]>([]);
  bodegas = signal<BodegaOdooFila[]>([]);
  propuestas = signal<PropuestaCatalogoFila[]>([]);
  loading = signal(true);
  error = signal('');
  trabajando = signal<string | null>(null);

  pendientes = computed(() => this.cuentas().filter((c) => !c.confirmado).length);
  bodegasSinCodigo = computed(() => this.bodegas().filter((b) => b.activo && !b.codigo_odoo).length);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [c, b, p] = await Promise.all([this.svc.cuentasAnaliticas(), this.svc.bodegas(), this.svc.propuestasCatalogo()]);
      this.cuentas.set(c);
      this.propuestas.set(p);
      this.bodegas.set(b);
    } catch (e) {
      this.error.set(presentarError(e, { pantalla: 'la homologación' }).mensajeUsuario);
    } finally {
      this.loading.set(false);
    }
  }

  usoLineas(c: CuentaAnaliticaFila): number | null {
    const n = c.evidencia?.['lineas_compra'];
    return typeof n === 'number' ? n : null;
  }

  async decidirProducto(p: PropuestaCatalogoFila, aprobar: boolean) {
    this.trabajando.set(p.id);
    try {
      await this.svc.decidirPropuesta(p.id, aprobar);
      this.toast.success(this.i18n.t(aprobar ? 'Producto vinculado' : 'Propuesta rechazada'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo guardar'), presentarError(e, { pantalla: 'la propuesta', accion: 'guardar la decisión' }).mensajeUsuario);
    } finally {
      this.trabajando.set(null);
    }
  }

  async decidir(c: CuentaAnaliticaFila, confirmar: boolean) {
    this.trabajando.set(c.id);
    try {
      await this.svc.confirmarCuenta(c.id, confirmar);
      this.toast.success(this.i18n.t(confirmar ? 'Cuenta analítica confirmada' : 'Confirmación retirada'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo guardar'), presentarError(e, { pantalla: 'la cuenta', accion: 'guardar la cuenta analítica' }).mensajeUsuario);
    } finally {
      this.trabajando.set(null);
    }
  }
}
