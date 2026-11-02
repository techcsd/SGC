import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  Agente,
  AgenteAprobacion,
  AgenteClave,
  AgenteEstado,
  AgentesService,
} from '../../../../shared/services/agentes.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { presentarError } from '../../../../shared/utils/friendly-error.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { Icon } from '../../../../shared/ui/icon/icon';
import { IconName } from '../../../../shared/ui/icon/icons';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';
import { EstadoPulseDirective } from '../../../../shared/motion/estado-pulse.directive';

const ESTADO_LABEL: Record<AgenteEstado, string> = {
  observando: 'Observando',
  trabajando: 'Trabajando',
  esperando_ok: 'Espera tu OK',
  error: 'Tiene un error',
  inactivo: 'Sin conexión',
};

/** Un vistazo rápido a qué hace cada agente, sin depender de leer su nombre. */
const ICONO_AGENTE: Record<AgenteClave, IconName> = {
  vigia: 'eye',
  capataz: 'wrench',
  soporte: 'message-circle',
  auditor: 'shield',
  escriba: 'code',
  cronista: 'file-text',
};

/**
 * F5 (ronda DF) — "Tecnología › Agentes": oficina isométrica 2D (SVG propio,
 * sin librería) con los 6 agentes + panel de hallazgos/acciones/aprobaciones +
 * informe diario del Cronista.
 *
 * Honestidad de alcance: no tuvimos acceso visual al mockup aprobado (el board
 * DF2/DF3 vive en un artifact de claude.ai que no renderiza para herramientas
 * automáticas) — esta es una implementación simple fiel a la especificación de
 * texto, no una réplica del diseño. Compararla contra el mockup real y pedir
 * ajustes visuales es trabajo pendiente de Xaviel.
 */
@Component({
  selector: 'app-oficina-agentes',
  imports: [TranslatePipe, Icon, ErrorState, EstadoPulseDirective, DecimalPipe],
  templateUrl: './oficina-agentes.html',
  styleUrl: './oficina-agentes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OficinaAgentes implements OnInit, OnDestroy {
  private service = inject(AgentesService);
  private toast = inject(ToastService);

  readonly estadoLabel = ESTADO_LABEL;
  readonly iconoAgente = (clave: AgenteClave): IconName => ICONO_AGENTE[clave] ?? 'circle';
  readonly formatTs = formatTimestampDisplay;

  loading = signal(true);
  error = signal<unknown>(null);
  decidiendo = signal<string | null>(null);
  notaAjuste = signal<Record<string, string>>({});
  enviandoInforme = signal(false);

  agentes = this.service.agentes;
  eventosPorAgente = this.service.eventosPorAgente;
  hallazgosHoy = this.service.hallazgosHoy;
  accionesHoy = this.service.accionesHoy;
  aprobacionesPendientes = this.service.aprobacionesPendientes;
  informeHoy = this.service.informeHoy;
  costoIaHoy = this.service.costoIaHoy;

  /** F6 — porcentaje del tope diario de IA ya consumido (0-100, tope mínimo 1 para evitar /0). */
  costoIaPct = computed(() => {
    const c = this.costoIaHoy();
    if (!c || c.topeDiario <= 0) return 0;
    return Math.min(100, Math.round((c.costoHoy / c.topeDiario) * 100));
  });

  /** >30 min sin evento = "sin conexión" visual, aunque la tabla diga otra cosa. */
  estadoVisual = (agenteId: string): AgenteEstado => {
    const ev = this.eventosPorAgente()[agenteId];
    if (!ev) return 'inactivo';
    const minutos = (Date.parse(ev.creado_en) - Date.now()) / -60000;
    if (minutos > 30) return 'inactivo';
    return ev.estado;
  };

  resumenAgente = (agenteId: string): string | null => this.eventosPorAgente()[agenteId]?.resumen ?? null;

  esperandoOk = (agente: Agente): AgenteAprobacion | undefined =>
    agente.nivel_max === 3
      ? this.aprobacionesPendientes().find((a) => a.agente_id === agente.id)
      : undefined;

  totalHoy = computed(
    () => this.hallazgosHoy().length + this.accionesHoy().length + this.aprobacionesPendientes().length,
  );

  async ngOnInit(): Promise<void> {
    await this.cargar();
    this.service.escuchar(() => void this.service.cargar());
  }

  ngOnDestroy(): void {
    this.service.detener();
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

  async deshacer(accionId: string): Promise<void> {
    try {
      await this.service.deshacerAccion(accionId);
      this.toast.success('Deshecho', 'La acción quedó marcada como deshecha.');
      await this.service.cargar();
    } catch (e) {
      this.toast.error('No se pudo deshacer', presentarError(e, { pantalla: 'la acción', accion: 'deshacer la acción' }).mensajeUsuario);
    }
  }

  async decidir(aprobacionId: string, decision: 'aprobada' | 'ajuste' | 'descartada'): Promise<void> {
    this.decidiendo.set(aprobacionId);
    try {
      const nota = decision === 'ajuste' ? this.notaAjuste()[aprobacionId] : undefined;
      await this.service.decidirAprobacion(aprobacionId, decision, nota);
      if (decision === 'aprobada') {
        this.toast.success(
          'Aprobada para dev',
          'Esto NO mezcla a dev automáticamente — todavía te falta hacer el merge del PR en GitHub.',
        );
      } else {
        this.toast.info(decision === 'ajuste' ? 'Ajuste pedido' : 'Descartada');
      }
      await this.service.cargar();
    } catch (e) {
      this.toast.error('No se pudo decidir', presentarError(e, { pantalla: 'la aprobación', accion: 'decidir la aprobación' }).mensajeUsuario);
    } finally {
      this.decidiendo.set(null);
    }
  }

  setNota(aprobacionId: string, valor: string): void {
    this.notaAjuste.update((m) => ({ ...m, [aprobacionId]: valor }));
  }

  async enviarInforme(): Promise<void> {
    const informe = this.informeHoy();
    if (!informe) return;
    this.enviandoInforme.set(true);
    try {
      await this.service.enviarInformeDiario(informe.id);
      this.toast.success('Informe enviado', 'Dirección recibió el resumen del día.');
      await this.service.cargar();
    } catch (e) {
      this.toast.error('No se pudo enviar', presentarError(e, { pantalla: 'el informe', accion: 'enviar el informe' }).mensajeUsuario);
    } finally {
      this.enviandoInforme.set(false);
    }
  }
}
