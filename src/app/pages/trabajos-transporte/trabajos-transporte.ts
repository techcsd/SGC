import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { TrabajosTransporteService, TrabajoRow, TrabajoOrigen } from '../../../shared/services/trabajos-transporte.service';
import { ProyectosService, ObraRef } from '../../../shared/services/proyectos.service';
import { ToastService } from '../../../shared/services/toast.service';
import { FormDrawer } from '../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, todayIso } from '../../../shared/utils/fecha.util';
import { esUuid } from '../../../shared/utils/uuid.util';

interface Columna { key: string; label: string; estados: string[]; }

const COLUMNAS: Columna[] = [
  { key: 'sin', label: 'Sin asignar', estados: ['pendiente'] },
  { key: 'asig', label: 'Asignados', estados: ['asignada'] },
  { key: 'proc', label: 'En proceso', estados: ['en_proceso'] },
  { key: 'conf', label: 'Por confirmar', estados: ['por_confirmar'] },
  { key: 'done', label: 'Completados hoy', estados: ['completada'] },
];

@Component({
  selector: 'app-trabajos-transporte',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton],
  templateUrl: './trabajos-transporte.html',
  styleUrl: './trabajos-transporte.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrabajosTransporte implements OnInit {
  private svc = inject(TrabajosTransporteService);
  private proyectosSvc = inject(ProyectosService);
  private toast = inject(ToastService);

  readonly COLUMNAS = COLUMNAS;
  readonly fFecha = formatFechaDisplay;

  loading = signal(true);
  rows = signal<TrabajoRow[]>([]);
  choferes = signal<{ id: string; nombre: string }[]>([]);
  obras = signal<ObraRef[]>([]);

  filtroDia = signal<string>('');
  filtroObra = signal<string>('');

  filtrados = computed(() => {
    const d = this.filtroDia(), o = this.filtroObra();
    return this.rows().filter((r) =>
      (!d || r.dia === d) && (!o || r.proyecto_id === o));
  });

  porColumna = computed(() => {
    const out: Record<string, TrabajoRow[]> = {};
    const hoy = todayIso();
    for (const c of COLUMNAS) {
      out[c.key] = this.filtrados().filter((r) =>
        c.estados.includes(r.estado) && (c.key !== 'done' || r.dia === hoy));
    }
    return out;
  });

  sinAsignar = computed(() => this.porColumna()['sin']?.length ?? 0);

  // Asignar
  asignarOpen = signal(false);
  asignarRow = signal<TrabajoRow | null>(null);
  asignarBusy = signal(false);
  selChofer = signal<string | null>(null);

  // Nueva actividad
  actividadOpen = signal(false);
  actividadBusy = signal(false);
  actForm = new FormGroup({
    descripcion: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    proyecto_id: new FormControl<string | null>(null),
    dia: new FormControl(todayIso(), { nonNullable: true }),
    conductor_id: new FormControl<string | null>(null),
  });

  async ngOnInit() {
    try {
      const [chof, obras] = await Promise.all([this.svc.choferesActivos(), this.proyectosSvc.getDirectorio('conduce')]);
      this.choferes.set(chof);
      this.obras.set(obras);
      await this.recargar();
    } finally {
      this.loading.set(false);
    }
  }

  async recargar() { this.rows.set(await this.svc.listar()); }

  // ── Asignar ──
  abrirAsignar(row: TrabajoRow) {
    this.asignarRow.set(row);
    this.selChofer.set(row.conductor_id ?? null);
    this.asignarOpen.set(true);
  }
  async confirmarAsignar() {
    const row = this.asignarRow();
    const chofer = this.selChofer();
    if (!row || this.asignarBusy()) return;
    if (!esUuid(chofer)) { this.toast.error('Elige un chofer de la lista'); return; }
    this.asignarBusy.set(true);
    try {
      await this.svc.asignar(row.origen as TrabajoOrigen, row.origen_id, chofer!, null, row.dia);
      this.toast.success('Asignado', 'Se avisó al chofer.');
      this.asignarOpen.set(false);
      await this.recargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo asignar', e instanceof Error ? e.message : undefined);
    } finally {
      this.asignarBusy.set(false);
    }
  }

  // ── Nueva actividad ──
  abrirActividad() {
    this.actForm.reset({ descripcion: '', proyecto_id: null, dia: todayIso(), conductor_id: null });
    this.actividadOpen.set(true);
  }
  async guardarActividad() {
    if (this.actividadBusy()) return;
    if (this.actForm.invalid) { this.actForm.markAllAsTouched(); return; }
    this.actividadBusy.set(true);
    try {
      const v = this.actForm.getRawValue();
      await this.svc.crearActividad(v.descripcion.trim(), v.proyecto_id, v.dia, v.conductor_id);
      this.toast.success('Actividad creada');
      this.actividadOpen.set(false);
      await this.recargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo crear', e instanceof Error ? e.message : undefined);
    } finally {
      this.actividadBusy.set(false);
    }
  }

  tipoLabel(r: TrabajoRow): string {
    if (r.origen === 'apoyo') {
      return { movimiento_interno: 'Movimiento', retiro_material: 'Retiro', bote: 'Bote' }[r.tipo] ?? 'Apoyo';
    }
    if (r.origen === 'requisicion') return 'Conduce';
    return 'Actividad';
  }
}
