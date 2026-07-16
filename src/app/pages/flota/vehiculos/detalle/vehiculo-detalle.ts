import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { VehiculosService } from '../../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../../shared/services/conductores.service';
import { ChecklistsVehiculoService } from '../../../../../shared/services/checklists-vehiculo.service';
import { MantenimientosService } from '../../../../../shared/services/mantenimientos.service';
import { CombustibleService } from '../../../../../shared/services/combustible.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { NotificacionesService } from '../../../../../shared/services/notificaciones.service';
import {
  Vehiculo,
  VEHICULO_ESTADO_BADGE,
  VEHICULO_ESTADOS,
  VEHICULO_TIPOS,
  VehiculoTipo,
  estadoVencimiento,
  VENCIMIENTO_LABEL,
  VENCIMIENTO_BADGE,
  proximoMantenimientoKm,
  kmFaltanMantenimiento,
} from '../../../../../shared/models/vehiculo.model';
import { VehiculoAsignacion, VehiculoStats } from '../../../../../shared/models/vehiculo-asignacion.model';
import {
  ChecklistVehiculo,
  ChecklistResultado,
  RESULTADO_META,
} from '../../../../../shared/models/flota-checklist.model';
import { Mantenimiento, MANT_TIPOS, MANT_ESTADOS } from '../../../../../shared/models/mantenimiento.model';
import { RegistroCombustible } from '../../../../../shared/models/combustible.model';
import { FormDrawer } from '../../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../../shared/components/skeleton/skeleton';
import { DocumentosFlota } from '../../../../../shared/components/documentos-flota/documentos-flota';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../../shared/utils/fecha.util';

const HISTORIAL_LIMITE = 15;

@Component({
  selector: 'app-vehiculo-detalle',
  imports: [DecimalPipe, RouterLink, ReactiveFormsModule, FormDrawer, Skeleton, DocumentosFlota],
  templateUrl: './vehiculo-detalle.html',
  styleUrl: './vehiculo-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VehiculoDetalle implements OnInit {
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private checklistsService = inject(ChecklistsVehiculoService);
  private mantenimientosService = inject(MantenimientosService);
  private combustibleService = inject(CombustibleService);
  private toast = inject(ToastService);
  private notificaciones = inject(NotificacionesService);

  readonly vehiculoId = this.route.snapshot.paramMap.get('id') ?? '';
  // tipo de documento a auto-abrir cuando se llega desde un aviso (?doc=seguro)
  readonly docAuto = this.route.snapshot.queryParamMap.get('doc');

  // ── Helpers expuestos al template ──
  estadoBadge = VEHICULO_ESTADO_BADGE;
  vencLabel = VENCIMIENTO_LABEL;
  vencBadge = VENCIMIENTO_BADGE;
  estadoVenc = estadoVencimiento;
  kmFaltan = kmFaltanMantenimiento;
  proxKm = proximoMantenimientoKm;

  loading = signal(true);
  error = signal('');

  vehiculo = signal<Vehiculo | null>(null);
  stats = signal<VehiculoStats | null>(null);
  asignaciones = signal<VehiculoAsignacion[]>([]);
  checklists = signal<ChecklistVehiculo[]>([]);
  mantenimientos = signal<Mantenimiento[]>([]);
  combustibles = signal<RegistroCombustible[]>([]);
  fotoUrl = signal<string | null>(null);

  reactivando = signal(false);
  mostrarHistorialAsig = signal(false);

  // ── Drawer "Asignar persona" ──
  drawerOpen = signal(false);
  guardando = signal(false);
  usuarios = signal<{ id: string; nombre: string }[]>([]);
  asignarForm = this.fb.group({
    usuario_id: [null as string | null, Validators.required],
    notas: [''],
  });

  // ── Derivados ──
  asignacionesActivas = computed(() => this.asignaciones().filter((a) => a.activa));
  asignacionesHistoricas = computed(() => this.asignaciones().filter((a) => !a.activa));

  kmFaltanMant = computed(() => {
    const v = this.vehiculo();
    return v ? kmFaltanMantenimiento(v) : null;
  });

  checklistsRecientes = computed(() => this.checklists().slice(0, HISTORIAL_LIMITE));
  mantenimientosRecientes = computed(() => this.mantenimientos().slice(0, HISTORIAL_LIMITE));
  combustiblesRecientes = computed(() => this.combustibles().slice(0, HISTORIAL_LIMITE));

  async ngOnInit() {
    if (!this.vehiculoId) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const [vehiculo, stats, asignaciones, checklists, mantenimientos, combustibles] =
        await Promise.all([
          this.vehiculosService.getById(this.vehiculoId),
          this.vehiculosService.getStats(this.vehiculoId),
          this.vehiculosService.getAsignaciones(this.vehiculoId),
          this.checklistsService.getChecklists(),
          this.mantenimientosService.getAll(),
          this.combustibleService.getAll(),
        ]);

      this.vehiculo.set(vehiculo);
      this.stats.set(stats);
      this.asignaciones.set(asignaciones);
      this.checklists.set(checklists.filter((c) => c.vehiculo_id === this.vehiculoId));
      this.mantenimientos.set(mantenimientos.filter((m) => m.vehiculo_id === this.vehiculoId));
      this.combustibles.set(combustibles.filter((r) => r.vehiculo_id === this.vehiculoId));

      const primeraFoto = vehiculo?.fotos?.[0];
      if (primeraFoto) {
        this.fotoUrl.set(await this.vehiculosService.getFotoUrl(primeraFoto));
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el vehículo.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Labels ──
  tipoLabel(tipo: VehiculoTipo | string | null | undefined): string {
    return VEHICULO_TIPOS.find((t) => t.value === tipo)?.label ?? (tipo ?? '—');
  }
  estadoLabel(estado: string | null | undefined): string {
    return VEHICULO_ESTADOS.find((e) => e.value === estado)?.label ?? (estado ?? '—');
  }
  mantTipoLabel(tipo: string | null | undefined): string {
    return MANT_TIPOS.find((t) => t.value === tipo)?.label ?? (tipo ?? '—');
  }
  mantEstadoLabel(estado: string | null | undefined): string {
    return MANT_ESTADOS.find((e) => e.value === estado)?.label ?? (estado ?? '—');
  }
  mantEstadoBadge(estado: string | null | undefined): string {
    return estado === 'completado' ? 'success' : estado === 'en_proceso' ? 'warning' : 'neutral';
  }

  private resultadoDe(c: ChecklistVehiculo): ChecklistResultado {
    return c.resultado ?? (c.tiene_criticos ? 'bloqueado' : 'aprobado');
  }
  resultadoMeta(c: ChecklistVehiculo) {
    return RESULTADO_META[this.resultadoDe(c)];
  }

  /** Fecha/timestamp seguro para DR (evita el shift de new Date sobre YYYY-MM-DD). */
  fecha(v: string | null | undefined): string {
    if (!v) return '—';
    return v.length <= 10 ? formatFechaDisplay(v) : formatTimestampDisplay(v);
  }

  asigNombre(a: VehiculoAsignacion): string {
    return a.usuario?.nombre ?? a.conductor?.nombre ?? '—';
  }

  // ── Reactivar vehículo ──
  async reactivar() {
    const v = this.vehiculo();
    if (!v || this.reactivando()) return;
    this.reactivando.set(true);
    try {
      await this.vehiculosService.reactivar(v.id);
      this.vehiculo.update((x) => (x ? { ...x, estado: 'activo' } : x));
      this.notificaciones.refresh();
      this.toast.success('Vehículo reactivado', 'El vehículo volvió a estado activo.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo reactivar el vehículo.');
    } finally {
      this.reactivando.set(false);
    }
  }

  // ── Asignar persona (drawer) ──
  async openAsignar() {
    this.asignarForm.reset({ usuario_id: null, notas: '' });
    this.drawerOpen.set(true);
    if (this.usuarios().length === 0) {
      try {
        this.usuarios.set(await this.conductoresService.getUsuariosVinculables());
      } catch {
        /* el picker queda vacío si falla; no bloquea el drawer */
      }
    }
  }
  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async asignar() {
    if (this.guardando()) return;
    if (this.asignarForm.invalid) {
      this.asignarForm.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    const { usuario_id, notas } = this.asignarForm.getRawValue();
    try {
      await this.vehiculosService.crearAsignacion({
        vehiculo_id: this.vehiculoId,
        usuario_id: usuario_id,
        notas: notas?.trim() || null,
      });
      this.asignaciones.set(await this.vehiculosService.getAsignaciones(this.vehiculoId));
      this.drawerOpen.set(false);
      this.toast.success('Persona asignada', 'La asignación se registró correctamente.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo crear la asignación.');
    } finally {
      this.guardando.set(false);
    }
  }

  async retirar(a: VehiculoAsignacion) {
    if (!confirm(`¿Retirar la asignación de ${this.asigNombre(a)}?`)) return;
    try {
      await this.vehiculosService.retirarAsignacion(a.id);
      this.asignaciones.set(await this.vehiculosService.getAsignaciones(this.vehiculoId));
      this.toast.success('Asignación retirada', 'Se marcó como inactiva.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo retirar la asignación.');
    }
  }

  toggleHistorialAsig() {
    this.mostrarHistorialAsig.update((v) => !v);
  }
}
