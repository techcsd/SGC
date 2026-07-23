import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AvisosFlotaService } from '../../../../shared/services/avisos-flota.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { NotificacionesService } from '../../../../shared/services/notificaciones.service';
import { FlotaConfigService } from '../../../../shared/services/flota-config.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  AvisoFlota,
  AVISO_TIPO_LABEL,
  AVISO_SEVERIDAD_BADGE,
  AVISO_TIPOS,
} from '../../../../shared/models/aviso-flota.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { HighlightItemDirective } from '../../../../shared/directives/highlight-item.directive';
import { formatFechaRelativa } from '../../../../shared/utils/fecha.util';
import { Paginator } from '../../../../shared/ui/paginator/paginator';

@Component({
  selector: 'app-flota-avisos',
  imports: [FormDrawer, Skeleton, HighlightItemDirective, Paginator],
  templateUrl: './avisos.html',
  styleUrl: './avisos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Avisos implements OnInit {
  private avisosService = inject(AvisosFlotaService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private notificaciones = inject(NotificacionesService);
  private flotaConfig = inject(FlotaConfigService);
  private user = inject(UserService);
  private toast = inject(ToastService);
  private router = inject(Router);

  reactivando = signal<string | null>(null);

  // X1b — umbral "por vencer" configurable (solo elevados).
  get esElevado() {
    return this.user.esFlotaElevado();
  }
  umbralInput = signal(this.flotaConfig.umbralPorVencerDias());
  guardandoUmbral = signal(false);
  async guardarUmbral() {
    const dias = Number(this.umbralInput());
    if (!Number.isFinite(dias) || dias < 1 || dias > 365) {
      this.toast.error('Umbral inválido', 'Debe estar entre 1 y 365 días.');
      return;
    }
    this.guardandoUmbral.set(true);
    try {
      await this.flotaConfig.setUmbralPorVencer(dias);
      this.toast.success('Umbral actualizado', `Ahora se avisa ${dias} días antes de vencer.`);
      await this.load(false);
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : '');
    } finally {
      this.guardandoUmbral.set(false);
    }
  }

  formatFecha = formatFechaRelativa;
  tipoLabel = AVISO_TIPO_LABEL;
  sevBadge = AVISO_SEVERIDAD_BADGE;
  readonly TIPOS = AVISO_TIPOS;

  avisos = signal<AvisoFlota[]>([]);
  loading = signal(true);
  error = signal('');

  filtroTipo = signal('');
  filtroVehiculo = signal('');
  // X2 — Avisos activos (pendientes) vs Historial (atendidos + resueltos auto).
  vista = signal<'activos' | 'historial'>('activos');
  setVista(v: 'activos' | 'historial') {
    this.vista.set(v);
    this.page.set(1);
  }

  // Atender drawer
  drawerOpen = signal(false);
  selected = signal<AvisoFlota | null>(null);
  nota = signal('');
  atendiendo = signal(false);

  filtered = computed(() => {
    const tipo = this.filtroTipo();
    const veh = this.filtroVehiculo();
    const vista = this.vista();
    return this.avisos().filter((a) => {
      const enVista =
        vista === 'activos'
          ? a.estado === 'pendiente'
          : a.estado === 'atendido' || a.estado === 'resuelto_auto';
      if (!enVista) return false;
      if (tipo && a.tipo !== tipo) return false;
      if (veh && a.vehiculo_id !== veh) return false;
      return true;
    });
  });

  historialCount = computed(
    () => this.avisos().filter((a) => a.estado === 'atendido' || a.estado === 'resuelto_auto').length,
  );

  page = signal(1);
  readonly PAGE_SIZE = 20;
  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  pendientes = computed(() => this.avisos().filter((a) => a.estado === 'pendiente').length);

  vehiculosConAviso = computed(() => {
    const seen = new Map<string, string>();
    for (const a of this.avisos()) {
      if (a.vehiculo_id && a.vehiculo?.placa) seen.set(a.vehiculo_id, a.vehiculo.placa);
    }
    return [...seen.entries()].map(([id, placa]) => ({ id, placa }));
  });

  async ngOnInit() {
    await this.load(true);
  }

  private async load(generar = false) {
    this.loading.set(true);
    this.error.set('');
    try {
      if (generar) {
        // X1/X2 — evalúa vencimientos server-side (genera/transiciona/auto-resuelve).
        try {
          await this.avisosService.evaluarVencimientos();
        } catch {
          /* no bloquea la carga si falla la evaluación */
        }
      }
      this.avisos.set(await this.avisosService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los avisos.');
    } finally {
      this.loading.set(false);
    }
  }

  onTipo(v: string) { this.filtroTipo.set(v); this.page.set(1); }
  onVehiculo(v: string) { this.filtroVehiculo.set(v); this.page.set(1); }

  openAtender(a: AvisoFlota) {
    this.selected.set(a);
    this.nota.set(a.nota_atencion ?? '');
    this.drawerOpen.set(true);
  }
  closeDrawer() { this.drawerOpen.set(false); }
  onNota(v: string) { this.nota.set(v); }

  /** R6: reactiva el vehículo bloqueado (y atiende sus avisos de bloqueo). */
  async reactivarVehiculo(a: AvisoFlota) {
    if (!a.vehiculo_id || this.reactivando()) return;
    this.reactivando.set(a.id);
    try {
      await this.vehiculosService.reactivar(a.vehiculo_id, 'Reactivado desde avisos');
      await this.load(false);
      this.notificaciones.refresh();
      this.toast.success('Vehículo reactivado', 'El vehículo vuelve a estar disponible.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo reactivar el vehículo.');
    } finally {
      this.reactivando.set(null);
    }
  }

  /** ¿El aviso es de vencimiento con documento asociado (X1)? */
  tieneDocumento(a: AvisoFlota): boolean {
    if (a.tipo === 'licencia') return !!a.conductor_id;
    if (a.tipo === 'seguro' || a.tipo === 'matricula') return !!a.vehiculo_id;
    return false;
  }

  /** X1: abre el perfil de la entidad con el documento del vencimiento auto-abierto. */
  verDocumento(a: AvisoFlota) {
    if (a.tipo === 'licencia' && a.conductor_id) {
      this.router.navigate(['/flota/conductores', a.conductor_id], { queryParams: { doc: 'licencia' } });
    } else if ((a.tipo === 'seguro' || a.tipo === 'matricula') && a.vehiculo_id) {
      this.router.navigate(['/flota/vehiculos', a.vehiculo_id], { queryParams: { doc: a.tipo } });
    }
  }

  /** R9: crea una cita de mantenimiento precargando el form del vehículo. */
  crearCita(a: AvisoFlota) {
    if (!a.vehiculo_id) return;
    // X6 — una cita desde un aviso de mantenimiento es siempre preventiva.
    this.router.navigate(['/flota/mantenimientos'], {
      queryParams: { nuevo: 1, vehiculo: a.vehiculo_id, tipo: 'preventivo' },
    });
  }

  async atender() {
    const a = this.selected();
    if (!a || this.atendiendo()) return;
    this.atendiendo.set(true);
    const nota = this.nota().trim() || null;
    try {
      await this.avisosService.atender(a.id, nota);
      const patch: Partial<AvisoFlota> = {
        estado: 'atendido', nota_atencion: nota, atendido_at: new Date().toISOString(),
      };
      this.avisos.update((list) => list.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
      this.drawerOpen.set(false);
      this.notificaciones.refresh();
      this.toast.success('Aviso atendido', 'Se marcó como atendido.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo atender el aviso.');
    } finally {
      this.atendiendo.set(false);
    }
  }
}
