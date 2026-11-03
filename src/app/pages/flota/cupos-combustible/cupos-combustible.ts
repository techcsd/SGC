import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CupoTarjetaService, SolicitudCupoRow, CupoTarjetaRow, EstadoSolicitudCupo, MotivoSolicitudCupo,
} from '../../../../shared/services/cupo-tarjeta.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { Paginador } from '../../../../shared/components/paginador/paginador';
import { FlotaSubnav } from '../flota-subnav/flota-subnav';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { DecimalPipe } from '@angular/common';

const MOTIVO_LABEL: Record<MotivoSolicitudCupo, string> = {
  llego_limite: 'Llegó al límite',
  bomba_rechazo: 'La bomba rechazó la tarjeta',
  pocos_galones: 'Le quedan pocos galones',
  otro: 'Otro motivo',
};

const ESTADO_LABEL: Record<EstadoSolicitudCupo, string> = {
  pendiente: 'Pendiente', ampliada: 'Ampliada', rechazada: 'Rechazada', cancelada: 'Cancelada',
};

/**
 * DI4 (Ronda DI, PROMPT-134 F6) — Flota/Logística atiende las solicitudes de
 * cupo que piden los choferes cuando su tarjeta de combustible llega al
 * límite, y anota (opcional) el cupo por tarjeta para que el sistema avise
 * solo si Raykler decide llevar la cuenta. Sin cupo anotado = sin barra ni
 * alertas (nunca se inventa un límite).
 */
@Component({
  selector: 'app-cupos-combustible',
  templateUrl: './cupos-combustible.html',
  styleUrl: './cupos-combustible.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, FormDrawer, ConfirmDialog, Paginador, FlotaSubnav, TranslatePipe, DecimalPipe],
})
export class CuposCombustible implements OnInit {
  private service = inject(CupoTarjetaService);
  private toast = inject(ToastService);

  motivoLabel = MOTIVO_LABEL;
  estadoLabel = ESTADO_LABEL;

  vista = signal<'solicitudes' | 'tarjetas'>('solicitudes');

  // ── Solicitudes ──────────────────────────────────────────
  solicitudes = signal<SolicitudCupoRow[]>([]);
  loadingSolicitudes = signal(true);
  errorSolicitudes = signal('');
  filtroEstado = signal<EstadoSolicitudCupo | 'todas'>('pendiente');

  solicitudesFiltradas = computed(() => {
    const f = this.filtroEstado();
    const filas = this.solicitudes();
    return f === 'todas' ? filas : filas.filter((s) => s.estado === f);
  });

  pagSolPage = signal(1);
  pagSolSize = signal(10);
  solicitudesPagina = computed(() => {
    const desde = (this.pagSolPage() - 1) * this.pagSolSize();
    return this.solicitudesFiltradas().slice(desde, desde + this.pagSolSize());
  });

  // Drawer de atender
  atendiendo = signal<SolicitudCupoRow | null>(null);
  respuesta = signal('');
  nuevoCupoGal = signal<number | null>(null);
  nuevoCupoMonto = signal<number | null>(null);
  guardandoAtencion = signal(false);
  confirmarRechazo = signal<SolicitudCupoRow | null>(null);

  // ── Tarjetas ─────────────────────────────────────────────
  tarjetas = signal<CupoTarjetaRow[]>([]);
  loadingTarjetas = signal(true);
  errorTarjetas = signal('');

  pagTarPage = signal(1);
  pagTarSize = signal(10);
  tarjetasPagina = computed(() => {
    const desde = (this.pagTarPage() - 1) * this.pagTarSize();
    return this.tarjetas().slice(desde, desde + this.pagTarSize());
  });

  editando = signal<CupoTarjetaRow | null>(null);
  editCupoGal = signal<number | null>(null);
  editCupoMonto = signal<number | null>(null);
  editCupoDiaCorte = signal<number | null>(null);
  guardandoEdicion = signal(false);

  async ngOnInit() {
    await Promise.all([this.cargarSolicitudes(), this.cargarTarjetas()]);
  }

  cambiarVista(v: 'solicitudes' | 'tarjetas') {
    this.vista.set(v);
  }

  async cargarSolicitudes() {
    this.loadingSolicitudes.set(true);
    this.errorSolicitudes.set('');
    try {
      this.solicitudes.set(await this.service.solicitudesListado());
    } catch (e: unknown) {
      this.errorSolicitudes.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las solicitudes.');
    } finally {
      this.loadingSolicitudes.set(false);
    }
  }

  async cargarTarjetas() {
    this.loadingTarjetas.set(true);
    this.errorTarjetas.set('');
    try {
      this.tarjetas.set(await this.service.tarjetasListado());
    } catch (e: unknown) {
      this.errorTarjetas.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las tarjetas.');
    } finally {
      this.loadingTarjetas.set(false);
    }
  }

  setFiltroEstado(f: EstadoSolicitudCupo | 'todas') {
    this.filtroEstado.set(f);
    this.pagSolPage.set(1);
  }

  conteoEstado(e: EstadoSolicitudCupo): number {
    return this.solicitudes().filter((s) => s.estado === e).length;
  }

  // ── Atender solicitud ────────────────────────────────────
  abrirAtender(s: SolicitudCupoRow) {
    this.atendiendo.set(s);
    this.respuesta.set('');
    this.nuevoCupoGal.set(s.galones_pedidos ?? null);
    this.nuevoCupoMonto.set(null);
  }

  cerrarAtender() {
    this.atendiendo.set(null);
  }

  async ampliar() {
    const s = this.atendiendo();
    if (!s || this.guardandoAtencion()) return;
    this.guardandoAtencion.set(true);
    try {
      await this.service.atender(s.id, 'ampliada', this.respuesta() || null, this.nuevoCupoGal(), this.nuevoCupoMonto());
      this.toast.success('Cupo ampliado', `${s.solicitante_nombre ?? 'El chofer'} ya puede seguir cargando.`);
      this.atendiendo.set(null);
      await Promise.all([this.cargarSolicitudes(), this.cargarTarjetas()]);
    } catch (e: unknown) {
      this.toast.error('No se pudo ampliar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.guardandoAtencion.set(false);
    }
  }

  pedirRechazo() {
    const s = this.atendiendo();
    if (!s) return;
    if (!this.respuesta().trim()) {
      this.toast.error('Falta el motivo', 'Escribe por qué se rechaza la solicitud.');
      return;
    }
    this.confirmarRechazo.set(s);
  }

  async confirmarYRechazar() {
    const s = this.confirmarRechazo();
    if (!s || this.guardandoAtencion()) return;
    this.guardandoAtencion.set(true);
    try {
      await this.service.atender(s.id, 'rechazada', this.respuesta(), null, null);
      this.toast.success('Solicitud rechazada', '');
      this.confirmarRechazo.set(null);
      this.atendiendo.set(null);
      await this.cargarSolicitudes();
    } catch (e: unknown) {
      this.toast.error('No se pudo rechazar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.guardandoAtencion.set(false);
    }
  }

  // ── Editar cupo de tarjeta ───────────────────────────────
  abrirEditar(t: CupoTarjetaRow) {
    this.editando.set(t);
    this.editCupoGal.set(t.cupo_gal);
    this.editCupoMonto.set(t.cupo_monto);
    this.editCupoDiaCorte.set(t.cupo_dia_corte);
  }

  cerrarEditar() {
    this.editando.set(null);
  }

  async guardarEdicion() {
    const t = this.editando();
    if (!t || this.guardandoEdicion()) return;
    this.guardandoEdicion.set(true);
    try {
      await this.service.editarCupo(t.codigo_tarjeta, this.editCupoGal(), this.editCupoMonto(), this.editCupoDiaCorte());
      this.toast.success('Cupo actualizado', '');
      this.editando.set(null);
      await this.cargarTarjetas();
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.guardandoEdicion.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  pctTono(pct: number | null): 'ok' | 'alerta' | 'critico' {
    if (pct == null) return 'ok';
    if (pct >= 100) return 'critico';
    if (pct >= 80) return 'alerta';
    return 'ok';
  }

  barraAncho(pct: number | null): number {
    return Math.min(100, Math.max(0, pct ?? 0));
  }

  fecha(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
}
