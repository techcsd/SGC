import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { EntradasConOc, SolicitudVencida, SolicitudesVencidasService } from '../../../../shared/services/solicitudes-vencidas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { FechaPipe } from '../../../../shared/i18n/fecha.pipe';
import { presentarError } from '../../../../shared/utils/friendly-error.util';

/** DS-24 — solicitudes pendientes vencidas: cierre masivo con motivo, y métrica «entradas con OC». */
@Component({
  selector: 'app-solicitudes-vencidas',
  imports: [Skeleton, TranslatePipe, DecimalPipe, FechaPipe],
  templateUrl: './solicitudes-vencidas.html',
  styleUrl: './solicitudes-vencidas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolicitudesVencidas implements OnInit {
  private svc = inject(SolicitudesVencidasService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  filas = signal<SolicitudVencida[]>([]);
  seleccion = signal<Set<string>>(new Set());
  motivo = signal('');
  entradas = signal<EntradasConOc>({ total: 0, con_oc: 0, pct: 0 });
  loading = signal(true);
  cerrando = signal(false);
  error = signal('');

  todasMarcadas = computed(() => this.filas().length > 0 && this.seleccion().size === this.filas().length);
  puedeCerrar = computed(() => this.seleccion().size > 0 && this.motivo().trim().length >= 10 && !this.cerrando());

  async ngOnInit() {
    await this.cargar();
  }

  clave(f: SolicitudVencida): string {
    return `${f.tipo}:${f.id}`;
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [filas, entradas] = await Promise.all([this.svc.listar(), this.svc.entradasConOc().catch(() => this.entradas())]);
      this.filas.set(filas);
      this.entradas.set(entradas);
      this.seleccion.set(new Set());
    } catch (e) {
      this.error.set(presentarError(e, { pantalla: 'las solicitudes vencidas' }).mensajeUsuario);
    } finally {
      this.loading.set(false);
    }
  }

  alternar(f: SolicitudVencida) {
    this.seleccion.update((s) => {
      const n = new Set(s);
      const k = this.clave(f);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  alternarTodas() {
    this.seleccion.set(this.todasMarcadas() ? new Set() : new Set(this.filas().map((f) => this.clave(f))));
  }

  async cerrar() {
    if (!this.puedeCerrar()) return;
    this.cerrando.set(true);
    try {
      const items = this.filas()
        .filter((f) => this.seleccion().has(this.clave(f)))
        .map((f) => ({ tipo: f.tipo, id: f.id }));
      const n = await this.svc.cerrar(items, this.motivo().trim());
      this.toast.success(this.i18n.t('{n} solicitud(es) cerrada(s)', { n }));
      this.motivo.set('');
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo cerrar'), presentarError(e, { pantalla: 'las solicitudes vencidas', accion: 'cerrar las solicitudes' }).mensajeUsuario);
    } finally {
      this.cerrando.set(false);
    }
  }
}
