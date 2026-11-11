import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { Empleado } from '../../../../shared/models/empleado.model';
import { RrhhCapacitacion } from '../../../../shared/models/rrhh-capacitacion.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** DN-27 P2 — Capacitación: cursos/certificaciones (ej. seguridad en obra),
 *  con vencimiento. No sensible (permiso estándar, igual que Organigrama). */
@Component({
  selector: 'app-rrhh-capacitacion',
  imports: [ConfirmDialog],
  templateUrl: './capacitacion.html',
  styleUrl: './capacitacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhCapacitacionPage implements OnInit {
  private svc = inject(EmpleadosService);
  private toast = inject(ToastService);

  cargando = signal(true);
  porVencer = signal<RrhhCapacitacion[]>([]);
  empleados = signal<Empleado[]>([]);
  empleadoNombrePorId = signal<Map<string, string>>(new Map());

  empleadoSeleccionadoId = signal('');
  capacitaciones = signal<RrhhCapacitacion[]>([]);
  cargandoCapacitaciones = signal(false);

  mostrarForm = signal(false);
  fCurso = signal('');
  fInstitucion = signal('');
  fFechaObtencion = signal('');
  fFechaVencimiento = signal('');
  guardando = signal(false);
  aEliminar = signal<RrhhCapacitacion | null>(null);

  formatFecha = formatFechaDisplay;

  async ngOnInit() {
    this.cargando.set(true);
    try {
      const [porVencer, empleados] = await Promise.all([this.svc.capacitacionesPorVencer(30), this.svc.getAll()]);
      this.porVencer.set(porVencer);
      this.empleados.set(empleados);
      this.empleadoNombrePorId.set(new Map(empleados.map((e) => [e.id, `${e.nombre} ${e.apellido}`])));
    } catch (e) {
      this.toast.error('No se pudo cargar Capacitación', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  nombreDe(empleadoId: string): string {
    return this.empleadoNombrePorId().get(empleadoId) ?? '—';
  }

  async seleccionarEmpleado(id: string) {
    this.empleadoSeleccionadoId.set(id);
    this.mostrarForm.set(false);
    if (!id) { this.capacitaciones.set([]); return; }
    this.cargandoCapacitaciones.set(true);
    try {
      this.capacitaciones.set(await this.svc.capacitacionesDeEmpleado(id));
    } catch (e) {
      this.toast.error('No se pudieron cargar las capacitaciones', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargandoCapacitaciones.set(false);
    }
  }

  abrirForm() {
    this.fCurso.set(''); this.fInstitucion.set(''); this.fFechaObtencion.set(''); this.fFechaVencimiento.set('');
    this.mostrarForm.set(true);
  }

  async guardar() {
    const empleadoId = this.empleadoSeleccionadoId();
    const curso = this.fCurso().trim();
    if (!empleadoId || !curso) { this.toast.warning('Falta el curso', 'Escribe qué curso o certificación es.'); return; }
    this.guardando.set(true);
    try {
      await this.svc.crearCapacitacion({
        empleado_id: empleadoId, curso, institucion: this.fInstitucion().trim() || null,
        fecha_obtencion: this.fFechaObtencion() || null, fecha_vencimiento: this.fFechaVencimiento() || null,
      });
      this.toast.success('Capacitación guardada');
      this.mostrarForm.set(false);
      await this.seleccionarEmpleado(empleadoId);
      this.porVencer.set(await this.svc.capacitacionesPorVencer(30));
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  pedirEliminar(c: RrhhCapacitacion) {
    this.aEliminar.set(c);
  }

  async confirmarEliminar() {
    const c = this.aEliminar();
    if (!c) return;
    try {
      await this.svc.eliminarCapacitacion(c.id);
      this.toast.success('Capacitación eliminada');
      await this.seleccionarEmpleado(this.empleadoSeleccionadoId());
      this.porVencer.set(await this.svc.capacitacionesPorVencer(30));
    } catch (e) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    } finally {
      this.aEliminar.set(null);
    }
  }
}
