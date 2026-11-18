import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ProveedorCuracion, ProveedorDuplicado, ProveedoresService } from '../../../../shared/services/proveedores.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { presentarError } from '../../../../shared/utils/friendly-error.util';

/** DS-25 — curación de proveedores: posibles duplicados, «con movimiento real» y ratificación en lote. */
@Component({
  selector: 'app-proveedores-curacion',
  imports: [Skeleton, TranslatePipe, DecimalPipe],
  templateUrl: './proveedores-curacion.html',
  styleUrl: './proveedores-curacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedoresCuracion implements OnInit {
  private svc = inject(ProveedoresService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  filas = signal<ProveedorCuracion[]>([]);
  duplicados = signal<ProveedorDuplicado[]>([]);
  seleccion = signal<Set<string>>(new Set());
  loading = signal(true);
  trabajando = signal(false);
  error = signal('');

  sinRatificar = computed(() => this.filas().filter((f) => !f.ratificado_en));
  conMovimiento = computed(() => this.filas().filter((f) => f.movimientos > 0).length);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [filas, dups] = await Promise.all([this.svc.curacionListar(), this.svc.duplicados()]);
      this.filas.set(filas);
      this.duplicados.set(dups);
      this.seleccion.set(new Set());
    } catch (e) {
      this.error.set(presentarError(e, { pantalla: 'la curación de proveedores' }).mensajeUsuario);
    } finally {
      this.loading.set(false);
    }
  }

  alternar(id: string) {
    this.seleccion.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  /** Marca todos los que ya tienen movimiento real y aún no están ratificados. */
  seleccionarConMovimiento() {
    this.seleccion.set(new Set(this.sinRatificar().filter((f) => f.movimientos > 0).map((f) => f.id)));
  }

  async ratificar() {
    const ids = [...this.seleccion()];
    if (!ids.length || this.trabajando()) return;
    this.trabajando.set(true);
    try {
      const n = await this.svc.ratificarLote(ids);
      this.toast.success(this.i18n.t('{n} proveedor(es) ratificado(s)', { n }));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo ratificar'), presentarError(e, { pantalla: 'la curación de proveedores', accion: 'ratificar' }).mensajeUsuario);
    } finally {
      this.trabajando.set(false);
    }
  }
}
