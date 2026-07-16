import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AusenciasService, contarDiasLaborables } from '../../../../shared/services/ausencias.service';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { UserService } from '../../../core/services/user.service';
import { NotificacionesService } from '../../../../shared/services/notificaciones.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SolicitudAusencia, AUSENCIA_TIPOS, AUSENCIA_ESTADOS } from '../../../../shared/models/ausencia.model';
import { Empleado } from '../../../../shared/models/empleado.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

@Component({
  selector: 'app-ausencias',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, Skeleton],
  templateUrl: './ausencias.html',
  styleUrl: './ausencias.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ausencias implements OnInit {
  private ausenciasService = inject(AusenciasService);
  private empleadosService = inject(EmpleadosService);
  private userService = inject(UserService);
  private notificaciones = inject(NotificacionesService);
  private toast = inject(ToastService);

  readonly TIPOS = AUSENCIA_TIPOS;
  readonly ESTADOS = AUSENCIA_ESTADOS;
  readonly anioActual = new Date().getFullYear();

  solicitudes = signal<SolicitudAusencia[]>([]);
  empleados = signal<Empleado[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  tab = signal<'pendientes' | 'todas'>('pendientes');
  selectedTipo = signal<string>('all');

  drawerOpen = signal(false);

  resolveOpen = signal(false);
  resolveSolicitud = signal<SolicitudAusencia | null>(null);
  comentario = new FormControl('');
  resolving = signal(false);

  // Vacation balance hint for the selected employee (current year).
  balanceEmpleado = signal<{ anuales: number; tomadas: number } | null>(null);

  form = new FormGroup({
    empleado_id: new FormControl<string | null>(null, [Validators.required]),
    tipo: new FormControl<string>('vacaciones', [Validators.required]),
    fecha_inicio: new FormControl('', [Validators.required]),
    fecha_fin: new FormControl('', [Validators.required]),
    motivo: new FormControl<string | null>(null),
  });

  pendientes = computed(() => this.solicitudes().filter((s) => s.estado === 'pendiente'));

  visible = computed(() => {
    const base = this.tab() === 'pendientes' ? this.pendientes() : this.solicitudes();
    const tipo = this.selectedTipo();
    return tipo === 'all' ? base : base.filter((s) => s.tipo === tipo);
  });

  diasCalculados = computed(() => {
    const inicio = this.form.controls.fecha_inicio.value;
    const fin = this.form.controls.fecha_fin.value;
    if (!inicio || !fin) return 0;
    return contarDiasLaborables(inicio, fin);
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [solicitudes, empleados] = await Promise.all([
        this.ausenciasService.getAll(),
        this.empleadosService.getAll(),
      ]);
      this.solicitudes.set(solicitudes);
      this.empleados.set(empleados.filter((e) => e.activo));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las solicitudes.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: 'pendientes' | 'todas') {
    this.tab.set(tab);
  }
  onTipoChange(value: string) {
    this.selectedTipo.set(value);
  }

  openCreate() {
    this.saveError.set('');
    this.balanceEmpleado.set(null);
    this.form.reset({ tipo: 'vacaciones' });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onEmpleadoChange(empleadoId: string) {
    if (!empleadoId) {
      this.balanceEmpleado.set(null);
      return;
    }
    const emp = this.empleados().find((e) => e.id === empleadoId);
    if (!emp) return;
    const anio = new Date().getFullYear();
    const tomadas = await this.ausenciasService.vacacionesTomadas(empleadoId, anio);
    this.balanceEmpleado.set({ anuales: emp.dias_vacaciones_anuales, tomadas });
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const userId = this.userService.profile()?.id;
    if (!userId) {
      this.saveError.set('No se pudo identificar el usuario.');
      return;
    }

    const raw = this.form.value;
    if (raw.fecha_fin! < raw.fecha_inicio!) {
      this.saveError.set('La fecha de fin no puede ser anterior a la de inicio.');
      return;
    }
    const dias = this.diasCalculados();
    if (dias <= 0) {
      this.saveError.set('El rango de fechas no contiene días laborables.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    try {
      const created = await this.ausenciasService.create({
        empleadoId: raw.empleado_id!,
        tipo: raw.tipo!,
        fechaInicio: raw.fecha_inicio!,
        fechaFin: raw.fecha_fin!,
        dias,
        motivo: raw.motivo || null,
        solicitadoPor: userId,
      });
      this.solicitudes.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
      this.notificaciones.refresh();
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al crear la solicitud.');
    } finally {
      this.saving.set(false);
    }
  }

  openResolve(s: SolicitudAusencia) {
    this.resolveSolicitud.set(s);
    this.comentario.reset('');
    this.resolveOpen.set(true);
  }

  closeResolve() {
    this.resolveOpen.set(false);
  }

  async resolver(estado: 'aprobada' | 'rechazada') {
    const s = this.resolveSolicitud();
    const userId = this.userService.profile()?.id;
    if (!s || !userId || this.resolving()) return;

    this.resolving.set(true);
    try {
      const updated = await this.ausenciasService.resolver(s.id, estado, userId, this.comentario.value || null);
      this.solicitudes.update((list) => list.map((item) => (item.id === s.id ? updated : item)));
      this.resolveOpen.set(false);
      this.notificaciones.refresh();

      // QA-032 — al aprobar, genera la asistencia por cada día de la ausencia (fire-and-forget).
      if (estado === 'aprobada') {
        this.ausenciasService
          .aplicarAsistencia(s.id)
          .then(() => this.toast.success('Asistencia actualizada'))
          .catch((err: unknown) =>
            this.toast.error('No se pudo actualizar la asistencia', err instanceof Error ? err.message : undefined),
          );
      }
    } catch (e: unknown) {
      this.toast.error('No se pudo resolver la solicitud', e instanceof Error ? e.message : undefined);
    } finally {
      this.resolving.set(false);
    }
  }

  /** Exporta las solicitudes visibles (según pestaña/filtro) a Excel. */
  async exportar() {
    const rows = this.visible().map((s) => ({
      Empleado: `${s.empleado?.nombre ?? ''} ${s.empleado?.apellido ?? ''}`.trim(),
      Tipo: this.tipoLabel(s.tipo),
      Desde: s.fecha_inicio,
      Hasta: s.fecha_fin,
      Días: s.dias,
      Estado: this.estadoLabel(s.estado),
      Motivo: s.motivo ?? '',
      'Solicitado por': s.solicitante?.nombre ?? '',
      Aprobador: s.aprobador?.nombre ?? '',
      Comentario: s.comentario_aprobador ?? '',
      'Fecha solicitud': s.fecha_solicitud,
      'Fecha resolución': s.fecha_resolucion ?? '',
    }));
    await exportarExcel('ausencias', rows);
  }

  tipoLabel(tipo: string): string {
    return this.TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  estadoBadgeClass(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'sgc-badge sgc-badge--warning';
      case 'aprobada': return 'sgc-badge sgc-badge--success';
      case 'rechazada': return 'sgc-badge sgc-badge--danger';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  estadoLabel(estado: string): string {
    return this.ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }

  get f() {
    return this.form.controls;
  }
}
