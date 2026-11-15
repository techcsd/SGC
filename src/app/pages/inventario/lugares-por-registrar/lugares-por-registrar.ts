import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { FechaPipe } from '../../../../shared/i18n/fecha.pipe';
import { TransporteV3Service, LugarPendiente } from '../../../../shared/services/transporte-v3.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';

/**
 * BA / Transporte v3 — bandeja "Lugares por registrar": cada «Otros» textual cae
 * aquí para que Logística (Raykler) lo promueva a lugar registrado (con coords)
 * y el buscador lo devuelva la próxima vez.
 */
@Component({
  selector: 'app-lugares-por-registrar',
  imports: [FechaPipe, Skeleton, StaggerDirective, TranslatePipe],
  templateUrl: './lugares-por-registrar.html',
  styleUrl: './lugares-por-registrar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LugaresPorRegistrar {
  private svc = inject(TransporteV3Service);
  private user = inject(UserService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  esLogistica = computed(() => this.user.hasRole('admin') || this.user.hasRole('logistica'));

  filas = signal<LugarPendiente[]>([]);
  loading = signal(true);

  // Promoción en línea
  promoviendo = signal<string | null>(null);
  nombre = signal('');
  lat = signal('');
  lng = signal('');

  async ngOnInit() {
    await this.recargar();
  }

  async recargar() {
    this.loading.set(true);
    try {
      this.filas.set(await this.svc.lugaresPorRegistrar('pendiente'));
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo cargar la bandeja');
    } finally {
      this.loading.set(false);
    }
  }

  abrirPromover(l: LugarPendiente) {
    this.promoviendo.set(l.id);
    this.nombre.set(l.texto);
    this.lat.set('');
    this.lng.set('');
  }

  async promover(l: LugarPendiente) {
    const nombre = this.nombre().trim() || l.texto;
    const lat = this.lat().trim() ? Number(this.lat()) : null;
    const lng = this.lng().trim() ? Number(this.lng()) : null;
    try {
      await this.svc.promoverLugar(l.id, nombre, lat, lng);
      this.toast.success(this.i18n.t('Lugar registrado'), this.i18n.t('El buscador ya lo va a encontrar.'));
      this.promoviendo.set(null);
      await this.recargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo promover');
    }
  }

  async descartar(l: LugarPendiente) {
    try {
      await this.svc.descartarLugar(l.id);
      await this.recargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo descartar');
    }
  }
}
