import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AgentesService } from '../../../../shared/services/agentes.service';
import { IngAccionAdmin, IngClaveBoolean, IngTarea, IngenieroService } from '../../../../shared/services/ingeniero.service';
import {
  ING_ESTADO_LABEL,
  ING_ORIGEN_LABEL,
  IngTareaEstado,
  badgeEstado,
  listaArchivos,
  porcentajePresupuesto,
  resumirVeredictos,
} from '../../../../shared/utils/ingeniero.util';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { presentarError } from '../../../../shared/utils/friendly-error.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';

const CAMPOS_NUMERICOS: { clave: string; etiqueta: string }[] = [
  { clave: 'max_prod_por_dia', etiqueta: 'Cambios a producción por día' },
  { clave: 'max_archivos', etiqueta: 'Máximo de archivos por cambio' },
  { clave: 'max_lineas', etiqueta: 'Máximo de líneas por cambio' },
  { clave: 'presupuesto_ia_dia_usd', etiqueta: 'Presupuesto de IA por día (USD)' },
  { clave: 'max_intentos', etiqueta: 'Intentos tras rechazo del Guardián' },
  { clave: 'max_pr_barrido', etiqueta: 'Máximo de PR por barrido' },
];

/**
 * EA3 — pestaña «Cambios del Ingeniero» dentro de /tecnologia/agentes (solo administrador: la ruta
 * lleva rolAdminGuard y las tablas/RPC exigen is_admin() en el servidor). Sin CSS propio: solo
 * clases globales sgc-*. Cerrar o responder al usuario lo hace una persona (EA-20): aquí solo se
 * copia el borrador y se marca como respondida.
 */
@Component({
  selector: 'app-ingeniero-cambios',
  imports: [TranslatePipe, ErrorState, DecimalPipe],
  templateUrl: './ingeniero-cambios.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IngenieroCambios implements OnInit {
  private service = inject(IngenieroService);
  private agentes = inject(AgentesService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  readonly estadoLabel = ING_ESTADO_LABEL as Record<string, string>;
  readonly origenLabel = ING_ORIGEN_LABEL;
  readonly badge = badgeEstado;
  readonly veredictos = resumirVeredictos;
  readonly archivos = listaArchivos;
  readonly formatTs = formatTimestampDisplay;
  readonly camposNumericos = CAMPOS_NUMERICOS;

  loading = signal(true);
  error = signal<unknown>(null);
  ocupado = signal<string | null>(null);
  filtro = signal<'todas' | IngTareaEstado>('todas');

  tareas = this.service.tareas;
  config = this.service.config;
  zonaRoja = this.service.zonaRoja;
  costoHoy = this.service.costoHoy;
  prodHoy = this.service.prodHoy;

  tareasFiltradas = computed(() => {
    const f = this.filtro();
    return f === 'todas' ? this.tareas() : this.tareas().filter((t) => t.estado === f);
  });
  costoPct = computed(() => porcentajePresupuesto(this.costoHoy(), this.config().presupuesto_ia_dia_usd));
  estadosFiltro = Object.keys(ING_ESTADO_LABEL) as IngTareaEstado[];

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.service.cargar();
    } catch (e) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  valorCampo(clave: string): number {
    return (this.config() as unknown as Record<string, number>)[clave];
  }

  setFiltro(valor: string): void {
    this.filtro.set(valor as 'todas' | IngTareaEstado);
  }

  async cambiarBooleano(clave: IngClaveBoolean, valor: boolean): Promise<void> {
    this.ocupado.set(clave);
    try {
      await this.service.guardarBooleano(clave, valor);
      this.toast.success(this.i18n.t('Guardado'));
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo guardar'), presentarError(e, { pantalla: 'los agentes', accion: 'guardar el ajuste' }).mensajeUsuario);
      await this.cargar();
    } finally {
      this.ocupado.set(null);
    }
  }

  async cambiarNumero(clave: string, valor: string): Promise<void> {
    this.ocupado.set(clave);
    try {
      await this.service.guardarNumero(clave, valor);
      this.toast.success(this.i18n.t('Guardado'));
    } catch (e) {
      const invalido = e instanceof Error && e.message === 'valor_invalido';
      this.toast.error(
        this.i18n.t('No se pudo guardar'),
        invalido ? this.i18n.t('Ese valor está fuera del rango permitido.') : presentarError(e, { pantalla: 'los agentes', accion: 'guardar el ajuste' }).mensajeUsuario,
      );
      await this.cargar();
    } finally {
      this.ocupado.set(null);
    }
  }

  async copiarBorrador(t: IngTarea): Promise<void> {
    if (!t.borrador_respuesta) return;
    try {
      await navigator.clipboard.writeText(t.borrador_respuesta);
      this.toast.success(this.i18n.t('Borrador copiado'));
    } catch {
      this.toast.error(this.i18n.t('El navegador bloqueó el portapapeles.'));
    }
  }

  async accion(t: IngTarea, accion: IngAccionAdmin): Promise<void> {
    this.ocupado.set(t.id);
    try {
      await this.service.accion(t.id, accion);
      await this.service.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo completar'), presentarError(e, { pantalla: 'la tarea', accion: 'actualizar la tarea' }).mensajeUsuario);
    } finally {
      this.ocupado.set(null);
    }
  }

  async decidirZonaRoja(aprobacionId: string, tarea: IngTarea | null, decision: 'aprobada' | 'descartada'): Promise<void> {
    this.ocupado.set(aprobacionId);
    try {
      await this.agentes.decidirAprobacion(aprobacionId, decision);
      if (decision === 'descartada' && tarea) await this.service.accion(tarea.id, 'rechazar');
      this.toast.success(decision === 'aprobada' ? this.i18n.t('Aprobada') : this.i18n.t('Rechazada'));
      await this.service.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo decidir'), presentarError(e, { pantalla: 'la zona roja', accion: 'decidir la aprobación' }).mensajeUsuario);
    } finally {
      this.ocupado.set(null);
    }
  }
}
