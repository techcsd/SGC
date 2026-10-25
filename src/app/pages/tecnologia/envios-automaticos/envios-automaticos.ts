import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { EnviosAutomaticosService, EnvioAutomatico } from '../../../../shared/services/envios-automaticos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/**
 * CT10 — panel "Envíos automáticos": interruptor por familia de reporte/aviso
 * que mandan los crons (Resumen semanal de operaciones, Incentivo semanal,
 * Avisos de reporte semanal, Cronograma). Antes no existía ninguno — lo único
 * posible era desprogramar el cron a mano en la base.
 */
@Component({
  selector: 'app-tec-envios-automaticos',
  templateUrl: './envios-automaticos.html',
  styleUrl: './envios-automaticos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class TecEnviosAutomaticos implements OnInit {
  private service = inject(EnviosAutomaticosService);
  private toast = inject(ToastService);

  readonly esProd = environment.entorno === 'prod';
  readonly formatTs = formatTimestampDisplay;

  loading = signal(true);
  error = signal('');
  envios = signal<EnvioAutomatico[]>([]);
  busyFamilia = signal<string | null>(null);
  probandoFamilia = signal<string | null>(null);

  /** CU3 — solo las familias que son correo a una lista tienen un "yo" al que
   * mandarles una prueba; las de aviso in-app/webhook no tienen ese análogo. */
  readonly FAMILIAS_CON_PRUEBA = new Set(['resumen_operaciones', 'incentivo_semanal', 'rendimiento_vehiculos']);

  // Modal de motivo (solo cuando hace falta: apagar en prod).
  motivoOpen = signal(false);
  motivoFamilia = signal<EnvioAutomatico | null>(null);
  motivoTexto = signal('');

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.envios.set(await this.service.listar());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar los envíos automáticos.');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(e: EnvioAutomatico) {
    // Apagar en prod exige motivo (el servidor lo valida igual; se pide aquí para no ir y volver).
    if (this.esProd && e.activo) {
      this.motivoFamilia.set(e);
      this.motivoTexto.set('');
      this.motivoOpen.set(true);
      return;
    }
    void this.aplicar(e.familia, !e.activo, null);
  }

  async confirmarMotivo() {
    const e = this.motivoFamilia();
    if (!e) return;
    if (!this.motivoTexto().trim()) {
      this.toast.error('Falta el motivo', 'Apagar un envío automático en producción exige un motivo.');
      return;
    }
    await this.aplicar(e.familia, false, this.motivoTexto().trim());
    this.motivoOpen.set(false);
  }

  private async aplicar(familia: string, activo: boolean, motivo: string | null) {
    this.busyFamilia.set(familia);
    try {
      await this.service.set(familia, activo, motivo);
      this.toast.success(activo ? 'Encendido' : 'Apagado', `«${this.nombreDe(familia)}» queda ${activo ? 'activo' : 'apagado'}.`);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo cambiar', e instanceof Error ? e.message : undefined);
    } finally {
      this.busyFamilia.set(null);
    }
  }

  private nombreDe(familia: string): string {
    return this.envios().find((e) => e.familia === familia)?.nombre ?? familia;
  }

  async probar(e: EnvioAutomatico) {
    this.probandoFamilia.set(e.familia);
    try {
      const correo = await this.service.probar(e.familia);
      this.toast.success('Prueba enviada', `Revisa ${correo} — llegará aunque «${e.nombre}» esté apagado.`);
    } catch (err: unknown) {
      this.toast.error('No se pudo mandar la prueba', err instanceof Error ? err.message : undefined);
    } finally {
      this.probandoFamilia.set(null);
    }
  }
}
