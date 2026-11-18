import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AjusteFaltanteFila, CorteBodegaFila, OdooAjustesService, TablaPruebaReal } from '../../../../shared/services/odoo-ajustes.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { FechaPipe } from '../../../../shared/i18n/fecha.pipe';
import { presentarError } from '../../../../shared/utils/friendly-error.util';

const ESTADOS_SYNC: Record<string, string> = { pendiente: 'En cola hacia Odoo', sincronizado: 'Hecho en Odoo', incierto: 'Odoo no confirmó', error: 'Con error' };

/** DS-17/DS-19/DS-28/DS-29 — faltantes en tránsito, corte por bodega y autorización prueba → real (los permisos los decide el servidor). */
@Component({
  selector: 'app-odoo-ajustes',
  imports: [Skeleton, TranslatePipe, FechaPipe, DecimalPipe],
  templateUrl: './odoo-ajustes.html',
  styleUrl: './odoo-ajustes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OdooAjustes implements OnInit {
  private svc = inject(OdooAjustesService);
  private user = inject(UserService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  ajustes = signal<AjusteFaltanteFila[]>([]);
  corte = signal<CorteBodegaFila[]>([]);
  loading = signal(true);
  error = signal('');
  trabajando = signal<string | null>(null);
  rechazando = signal<string | null>(null);
  motivo = signal('');
  esAdmin = computed(() => this.user.roles().includes('admin'));
  // La fecha de corte la puede cambiar un admin o Compras (coord_compras); el resto del corte (apertura, fuente) sigue siendo solo admin.
  puedeFecha = computed(() => this.user.roles().some((r) => r === 'admin' || r === 'coord_compras'));
  pendientes = computed(() => this.ajustes().filter((a) => a.estado === 'pendiente').length);

  // Autorización prueba → real
  tablaPR = signal<TablaPruebaReal>('salidas_inventario');
  idPR = signal('');
  motivoPR = signal('');

  async ngOnInit() {
    await this.cargar();
  }

  estadoSync(e: string | null): string {
    return e ? this.i18n.t(ESTADOS_SYNC[e] ?? e) : '—';
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.ajustes.set(await this.svc.listar());
      this.corte.set(await this.svc.corte().catch(() => []));
    } catch (e) {
      this.error.set(presentarError(e, { pantalla: 'los faltantes en tránsito' }).mensajeUsuario);
    } finally {
      this.loading.set(false);
    }
  }

  async aprobar(a: AjusteFaltanteFila) {
    await this.decidir(a, true, null);
  }

  abrirRechazo(a: AjusteFaltanteFila) {
    this.rechazando.set(a.id);
    this.motivo.set('');
  }

  async rechazar(a: AjusteFaltanteFila) {
    if (this.motivo().trim().length < 10) { this.toast.error(this.i18n.t('Indica el motivo (mínimo 10 caracteres).')); return; }
    await this.decidir(a, false, this.motivo().trim());
  }

  private async decidir(a: AjusteFaltanteFila, aprobar: boolean, nota: string | null) {
    this.trabajando.set(a.id);
    try {
      await this.svc.decidir(a.id, aprobar, nota);
      this.toast.success(this.i18n.t(aprobar ? 'Ajuste aprobado' : 'Material devuelto al origen'));
      this.rechazando.set(null);
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo resolver el faltante'), presentarError(e, { pantalla: 'los faltantes en tránsito', accion: 'resolver' }).mensajeUsuario);
    } finally {
      this.trabajando.set(null);
    }
  }

  async fijarCorte(b: CorteBodegaFila, fecha: string) {
    if (!fecha) return;
    try {
      await this.svc.configurarCorte(b.bodega_id, fecha);
      this.toast.success(this.i18n.t('Fecha de corte guardada'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo guardar'), presentarError(e, { pantalla: 'el corte por almacén', accion: 'guardar' }).mensajeUsuario);
    }
  }

  async contingencia(b: CorteBodegaFila, motivo: string) {
    if (motivo.trim().length < 10) { this.toast.error(this.i18n.t('Indica el motivo (mínimo 10 caracteres).')); return; }
    try {
      await this.svc.aprobarContingencia(b.bodega_id, motivo.trim(), 4);
      this.toast.success(this.i18n.t('Contingencia aprobada por 4 horas'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo aprobar'), presentarError(e, { pantalla: 'el corte por almacén', accion: 'aprobar' }).mensajeUsuario);
    }
  }

  async autorizarPruebaReal() {
    try {
      await this.svc.autorizarPruebaReal(this.tablaPR(), this.idPR().trim(), this.motivoPR().trim());
      this.toast.success(this.i18n.t('Autorizado por 2 horas: ya puedes pasarlo a real'));
      this.idPR.set('');
      this.motivoPR.set('');
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo autorizar'), presentarError(e, { pantalla: 'la autorización de prueba a real', accion: 'autorizar' }).mensajeUsuario);
    }
  }

  valor(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }
}
