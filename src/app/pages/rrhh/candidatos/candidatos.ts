import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RrhhOnboardingService } from '../../../../shared/services/rrhh-onboarding.service';
import { RrhhCandidatosLectorService } from '../../../../shared/services/rrhh-candidatos-lector.service';
import { CandidatoEtapa, ETAPAS_ORDEN, ETAPA_LABEL, RrhhCandidatoConVacante } from '../../../../shared/models/rrhh-onboarding.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { PdfViewer } from '../../../../shared/ui/pdf-viewer/pdf-viewer';
import { Icon } from '../../../../shared/ui/icon/icon';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

type Tab = 'activos' | 'archivados';

/**
 * DO-05 (ronda DO) — Reclutamiento: índice global de candidatos (todas las
 * vacantes), con buscador y panel de detalle. Mismo patrón de panel/lista que
 * "Cargos y alias" (DN-24): una fila abre `<app-form-drawer>` (foco accesible +
 * Esc ya resueltos ahí, no se reimplementan aquí).
 */
@Component({
  selector: 'app-rrhh-candidatos',
  imports: [FormDrawer, ConfirmDialog, PdfViewer, Icon],
  templateUrl: './candidatos.html',
  styleUrl: './candidatos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhCandidatos implements OnInit {
  private svc = inject(RrhhOnboardingService);
  private lector = inject(RrhhCandidatosLectorService);
  private toast = inject(ToastService);
  private userService = inject(UserService);

  cargando = signal(true);
  candidatos = signal<RrhhCandidatoConVacante[]>([]);
  query = signal('');
  tab = signal<Tab>('activos');

  etapas = ETAPAS_ORDEN;
  etapaLabel = ETAPA_LABEL;
  fFecha = formatFechaDisplay;

  activosCount = computed(() => this.candidatos().filter((c) => !c.archivado).length);
  archivadosCount = computed(() => this.candidatos().filter((c) => c.archivado).length);

  filtrados = computed(() => {
    const archivado = this.tab() === 'archivados';
    const q = this.query().trim().toLowerCase();
    return this.candidatos()
      .filter((c) => c.archivado === archivado)
      .filter((c) => !q
        || c.nombre.toLowerCase().includes(q)
        || (c.email ?? '').toLowerCase().includes(q)
        || (c.telefono ?? '').toLowerCase().includes(q)
        || (c.vacante_titulo ?? '').toLowerCase().includes(q));
  });

  // ── Detalle ──
  seleccionado = signal<RrhhCandidatoConVacante | null>(null);
  guardandoEdicion = signal(false);
  subiendoCv = signal(false);
  candidatoAArchivar = signal<RrhhCandidatoConVacante | null>(null);
  candidatoAEliminarFisico = signal<RrhhCandidatoConVacante | null>(null);

  // Campos editables del panel (DO-05 — más datos de intake).
  eNombre = signal('');
  eTelefono = signal('');
  eTelefonoAlterno = signal('');
  eEmail = signal('');
  eExperiencia = signal('');
  eEducacion = signal('');
  eExpectativa = signal('');
  eFuente = signal('');
  eNotas = signal('');

  // PdfViewer del CV.
  pdfOpen = signal(false);
  pdfSrc = signal<string | null>(null);

  // DO-06 — CV leído por IA.
  leyendoCv = signal(false);

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    try {
      this.candidatos.set(await this.svc.listarCandidatosGlobal());
    } catch (e) {
      this.toast.error('No se pudieron cargar los candidatos', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  abrirDetalle(c: RrhhCandidatoConVacante) {
    this.seleccionado.set(c);
    this.eNombre.set(c.nombre);
    this.eTelefono.set(c.telefono ?? '');
    this.eTelefonoAlterno.set(c.telefono_alterno ?? '');
    this.eEmail.set(c.email ?? '');
    this.eExperiencia.set(c.experiencia_resumen ?? '');
    this.eEducacion.set(c.educacion ?? '');
    this.eExpectativa.set(c.expectativa_salarial != null ? String(c.expectativa_salarial) : '');
    this.eFuente.set(c.fuente ?? '');
    this.eNotas.set(c.notas ?? '');
  }

  cerrarDetalle() {
    this.seleccionado.set(null);
  }

  async guardarEdicion() {
    const c = this.seleccionado();
    const nombre = this.eNombre().trim();
    if (!c || !nombre) { this.toast.warning('Falta el nombre'); return; }
    this.guardandoEdicion.set(true);
    try {
      const expectativa = this.eExpectativa().trim();
      await this.svc.actualizarCandidato(c.id, {
        nombre,
        telefono: this.eTelefono().trim() || null,
        telefono_alterno: this.eTelefonoAlterno().trim() || null,
        email: this.eEmail().trim() || null,
        experiencia_resumen: this.eExperiencia().trim() || null,
        educacion: this.eEducacion().trim() || null,
        expectativa_salarial: expectativa ? Number(expectativa) : null,
        fuente: this.eFuente().trim() || null,
        notas: this.eNotas().trim() || null,
      });
      this.toast.success('Candidato actualizado');
      await this.cargar();
      const actualizado = this.candidatos().find((x) => x.id === c.id);
      if (actualizado) this.seleccionado.set(actualizado);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoEdicion.set(false);
    }
  }

  async avanzarEtapa(etapa: CandidatoEtapa) {
    const c = this.seleccionado();
    if (!c) return;
    try {
      await this.svc.cambiarEtapa(c.id, etapa);
      await this.cargar();
      const actualizado = this.candidatos().find((x) => x.id === c.id);
      if (actualizado) this.seleccionado.set(actualizado);
    } catch (e) {
      this.toast.error('No se pudo actualizar la etapa', e instanceof Error ? e.message : undefined);
    }
  }

  // ── CV ──
  async onCvSeleccionado(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    const c = this.seleccionado();
    if (!file || !c) return;
    this.subiendoCv.set(true);
    try {
      const path = await this.svc.subirCv(c.id, file);
      this.toast.success('CV subido');
      this.seleccionado.update((cur) => (cur ? { ...cur, cv_path: path } : cur));
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo subir el CV', e instanceof Error ? e.message : undefined);
    } finally {
      this.subiendoCv.set(false);
    }
  }

  private esPdf(path: string): boolean {
    return path.toLowerCase().endsWith('.pdf');
  }

  private mimeDesdeExtension(path: string): string {
    const ext = path.toLowerCase().split('.').pop();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    return 'application/octet-stream';
  }

  /** DO-06 — CV leído por IA: sube el archivo ya guardado al lector (edge
   *  server-to-server + polling); el resultado queda en cv_extraido. */
  async leerCvConIa() {
    const c = this.seleccionado();
    if (!c?.cv_path || this.leyendoCv()) return;
    this.leyendoCv.set(true);
    try {
      const url = await this.svc.getCvUrl(c.cv_path);
      const res = await fetch(url);
      const blob = await res.blob();
      const mime = blob.type || this.mimeDesdeExtension(c.cv_path);
      const data = await this.lector.archivoABase64(new File([blob], 'cv', { type: mime }));
      const extraido = await this.lector.leer(c.id, { data, mime });
      this.toast.success('CV leído', 'Revisa los datos antes de confiar en ellos.');
      this.seleccionado.update((cur) => (cur ? { ...cur, cv_extraido: extraido } : cur));
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo leer el CV', e instanceof Error ? e.message : undefined);
    } finally {
      this.leyendoCv.set(false);
    }
  }

  async verCv() {
    const c = this.seleccionado();
    if (!c?.cv_path) return;
    try {
      const url = await this.svc.getCvUrl(c.cv_path);
      if (this.esPdf(c.cv_path)) {
        this.pdfSrc.set(url);
        this.pdfOpen.set(true);
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch (e) {
      this.toast.error('No se pudo abrir el CV', e instanceof Error ? e.message : undefined);
    }
  }

  // ── DO-07 — archivar / restaurar / borrado físico ──
  pedirArchivar(c: RrhhCandidatoConVacante) {
    this.candidatoAArchivar.set(c);
  }

  async confirmarArchivar() {
    const c = this.candidatoAArchivar();
    if (!c) return;
    try {
      await this.svc.archivarCandidato(c.id, this.userService.profile()?.id ?? null);
      this.toast.success('Candidato archivado');
      await this.cargar();
      this.cerrarDetalle();
    } catch (e) {
      this.toast.error('No se pudo archivar', e instanceof Error ? e.message : undefined);
    } finally {
      this.candidatoAArchivar.set(null);
    }
  }

  async restaurar(c: RrhhCandidatoConVacante) {
    try {
      await this.svc.restaurarCandidato(c.id);
      this.toast.success('Candidato restaurado');
      await this.cargar();
      const actualizado = this.candidatos().find((x) => x.id === c.id);
      if (actualizado) this.seleccionado.set(actualizado);
    } catch (e) {
      this.toast.error('No se pudo restaurar', e instanceof Error ? e.message : undefined);
    }
  }

  pedirEliminarFisico(c: RrhhCandidatoConVacante) {
    this.candidatoAEliminarFisico.set(c);
  }

  async confirmarEliminarFisico() {
    const c = this.candidatoAEliminarFisico();
    if (!c) return;
    try {
      await this.svc.eliminarCandidatoFisico(c.id, c.cv_path);
      this.toast.success('Candidato eliminado para siempre');
      await this.cargar();
      this.cerrarDetalle();
    } catch (e) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    } finally {
      this.candidatoAEliminarFisico.set(null);
    }
  }
}
