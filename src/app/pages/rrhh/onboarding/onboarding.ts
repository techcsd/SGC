import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RrhhOnboardingService } from '../../../../shared/services/rrhh-onboarding.service';
import {
  CandidatoEtapa, ETAPAS_ORDEN, ETAPA_LABEL, RrhhCandidato, RrhhVacante, VacanteEstado,
} from '../../../../shared/models/rrhh-onboarding.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';

/** DN-27 P1 — Reclutamiento (onboarding): vacantes + pipeline de candidatos
 *  (aplicado → entrevista → oferta → contratado/rechazado). Permiso estándar
 *  (no está en la lista de sensibles de Xaviel). */
@Component({
  selector: 'app-rrhh-onboarding',
  imports: [ConfirmDialog],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhOnboarding implements OnInit {
  private svc = inject(RrhhOnboardingService);
  private toast = inject(ToastService);

  cargando = signal(true);
  vacantes = signal<RrhhVacante[]>([]);
  mostrarFormVacante = signal(false);
  fTitulo = signal('');
  fDepartamento = signal('');
  fDescripcion = signal('');
  guardandoVacante = signal(false);

  seleccionada = signal<RrhhVacante | null>(null);
  candidatos = signal<RrhhCandidato[]>([]);
  cargandoCandidatos = signal(false);
  mostrarFormCandidato = signal(false);
  fcNombre = signal('');
  fcTelefono = signal('');
  fcEmail = signal('');
  fcNotas = signal('');
  guardandoCandidato = signal(false);
  candidatoAEliminar = signal<RrhhCandidato | null>(null);

  etapas = ETAPAS_ORDEN;
  etapaLabel = ETAPA_LABEL;

  vacantesAbiertas = computed(() => this.vacantes().filter((v) => v.estado === 'abierta'));
  vacantesNoAbiertas = computed(() => this.vacantes().filter((v) => v.estado !== 'abierta'));

  async ngOnInit() {
    await this.cargarVacantes();
  }

  private async cargarVacantes() {
    this.cargando.set(true);
    try {
      this.vacantes.set(await this.svc.listarVacantes());
    } catch (e) {
      this.toast.error('No se pudieron cargar las vacantes', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  abrirFormVacante() {
    this.fTitulo.set(''); this.fDepartamento.set(''); this.fDescripcion.set('');
    this.mostrarFormVacante.set(true);
  }

  async guardarVacante() {
    const titulo = this.fTitulo().trim();
    if (!titulo) { this.toast.warning('Falta el título', 'Escribe el nombre de la vacante.'); return; }
    this.guardandoVacante.set(true);
    try {
      await this.svc.crearVacante({
        titulo, departamento: this.fDepartamento().trim() || null, descripcion: this.fDescripcion().trim() || null,
      });
      this.toast.success('Vacante creada');
      this.mostrarFormVacante.set(false);
      await this.cargarVacantes();
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoVacante.set(false);
    }
  }

  async cambiarEstadoVacante(v: RrhhVacante, estado: VacanteEstado) {
    try {
      await this.svc.actualizarEstadoVacante(v.id, estado);
      await this.cargarVacantes();
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }

  async seleccionarVacante(v: RrhhVacante) {
    this.seleccionada.set(v);
    this.mostrarFormCandidato.set(false);
    this.cargandoCandidatos.set(true);
    try {
      this.candidatos.set(await this.svc.listarCandidatos(v.id));
    } catch (e) {
      this.toast.error('No se pudieron cargar los candidatos', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargandoCandidatos.set(false);
    }
  }

  cerrarSeleccion() {
    this.seleccionada.set(null);
    this.candidatos.set([]);
  }

  abrirFormCandidato() {
    this.fcNombre.set(''); this.fcTelefono.set(''); this.fcEmail.set(''); this.fcNotas.set('');
    this.mostrarFormCandidato.set(true);
  }

  async guardarCandidato() {
    const vacante = this.seleccionada();
    const nombre = this.fcNombre().trim();
    if (!vacante || !nombre) { this.toast.warning('Falta el nombre', 'Escribe el nombre del candidato.'); return; }
    this.guardandoCandidato.set(true);
    try {
      await this.svc.crearCandidato({
        vacante_id: vacante.id, nombre, telefono: this.fcTelefono().trim() || null,
        email: this.fcEmail().trim() || null, notas: this.fcNotas().trim() || null,
      });
      this.toast.success('Candidato agregado');
      this.mostrarFormCandidato.set(false);
      await this.seleccionarVacante(vacante);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoCandidato.set(false);
    }
  }

  async avanzarEtapa(c: RrhhCandidato) {
    const i = this.etapas.indexOf(c.etapa);
    const siguiente = this.etapas[i + 1];
    if (!siguiente || siguiente === 'rechazado') return;
    await this.cambiarEtapa(c, siguiente);
  }

  async rechazar(c: RrhhCandidato) {
    await this.cambiarEtapa(c, 'rechazado');
  }

  private async cambiarEtapa(c: RrhhCandidato, etapa: CandidatoEtapa) {
    try {
      await this.svc.cambiarEtapa(c.id, etapa);
      const vacante = this.seleccionada();
      if (vacante) await this.seleccionarVacante(vacante);
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }

  pedirEliminarCandidato(c: RrhhCandidato) {
    this.candidatoAEliminar.set(c);
  }

  async confirmarEliminarCandidato() {
    const c = this.candidatoAEliminar();
    if (!c) return;
    try {
      await this.svc.eliminarCandidato(c.id);
      this.toast.success('Candidato eliminado');
      const vacante = this.seleccionada();
      if (vacante) await this.seleccionarVacante(vacante);
    } catch (e) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    } finally {
      this.candidatoAEliminar.set(null);
    }
  }
}
