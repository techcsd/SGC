import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { RrhhEvaluacionesService } from '../../../../shared/services/rrhh-evaluaciones.service';
import { Empleado } from '../../../../shared/models/empleado.model';
import { RrhhEvaluacion } from '../../../../shared/models/rrhh-evaluacion.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** DN-27 P2 — Evaluaciones de desempeño. SENSIBLE: cada lectura queda en
 *  sgc.rrhh_accesos_log (vía la RPC del servicio), gateada por
 *  sgc.puede_rrhh_sensible (sin bypass de admin). */
@Component({
  selector: 'app-rrhh-evaluaciones',
  templateUrl: './evaluaciones.html',
  styleUrl: './evaluaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhEvaluaciones implements OnInit {
  private empleadosSvc = inject(EmpleadosService);
  private svc = inject(RrhhEvaluacionesService);
  private toast = inject(ToastService);

  cargando = signal(true);
  empleados = signal<Empleado[]>([]);
  empleadoSeleccionadoId = signal('');
  evaluaciones = signal<RrhhEvaluacion[]>([]);
  cargandoEvaluaciones = signal(false);

  mostrarForm = signal(false);
  fPeriodo = signal('');
  fPuntaje = signal('');
  fComentarios = signal('');
  guardando = signal(false);

  formatFecha = formatFechaDisplay;

  async ngOnInit() {
    this.cargando.set(true);
    try {
      this.empleados.set(await this.empleadosSvc.getAll());
    } catch (e) {
      this.toast.error('No se pudo cargar Evaluaciones', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  async seleccionarEmpleado(id: string) {
    this.empleadoSeleccionadoId.set(id);
    this.mostrarForm.set(false);
    if (!id) { this.evaluaciones.set([]); return; }
    this.cargandoEvaluaciones.set(true);
    try {
      this.evaluaciones.set(await this.svc.evaluacionesDeEmpleado(id));
    } catch (e) {
      this.toast.error('No se pudieron cargar las evaluaciones', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargandoEvaluaciones.set(false);
    }
  }

  abrirForm() {
    this.fPeriodo.set(''); this.fPuntaje.set(''); this.fComentarios.set('');
    this.mostrarForm.set(true);
  }

  async guardar() {
    const empleadoId = this.empleadoSeleccionadoId();
    const periodo = this.fPeriodo().trim();
    if (!empleadoId || !periodo) { this.toast.warning('Falta el período', 'Escribe a qué período corresponde (ej. 2026-H2).'); return; }
    this.guardando.set(true);
    try {
      await this.svc.crearEvaluacion(
        empleadoId, periodo, this.fPuntaje() ? Number(this.fPuntaje()) : null, this.fComentarios().trim() || null,
      );
      this.toast.success('Evaluación guardada');
      this.mostrarForm.set(false);
      await this.seleccionarEmpleado(empleadoId);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }
}
