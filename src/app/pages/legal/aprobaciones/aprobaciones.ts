import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LegalService } from '../../../../shared/services/legal.service';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { DocumentoGenerado } from '../../../../shared/models/plantilla-documento.model';
import { UserService } from '../../../core/services/user.service';
import { AprobacionLegal, APROBACION_MODULOS } from '../../../../shared/models/legal.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { HighlightItemDirective } from '../../../../shared/directives/highlight-item.directive';
import { Paginator } from '../../../../shared/ui/paginator/paginator';

@Component({
  selector: 'app-aprobaciones',
  imports: [FormDrawer, DatePipe, ReactiveFormsModule, Skeleton, HighlightItemDirective, Paginator],
  templateUrl: './aprobaciones.html',
  styleUrl: './aprobaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Aprobaciones implements OnInit {
  private legalService = inject(LegalService);
  private plantillasSvc = inject(PlantillasDocumentoService);
  private userService = inject(UserService);

  readonly MODULOS = APROBACION_MODULOS;

  aprobaciones = signal<AprobacionLegal[]>([]);
  loading = signal(true);
  error = signal('');
  tab = signal<'pendientes' | 'todas'>('pendientes');

  drawerOpen = signal(false);
  drawerAprobacion = signal<AprobacionLegal | null>(null);
  comentario = new FormControl('');
  resolving = signal(false);
  resolveError = signal('');

  // AZ4 — vista previa del documento a aprobar (no se aprueba lo que no se ve).
  docPreview = signal<DocumentoGenerado | null>(null);
  docLoading = signal(false);
  docError = signal('');

  pendientes = computed(() => this.aprobaciones().filter((a) => a.estado === 'pendiente'));

  visible = computed(() => (this.tab() === 'pendientes' ? this.pendientes() : this.aprobaciones()));

  page = signal(1);
  readonly PAGE_SIZE = 20;
  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.visible().slice(start, start + this.PAGE_SIZE);
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.legalService.getAprobaciones();
      this.aprobaciones.set(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las solicitudes.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: 'pendientes' | 'todas') {
    this.tab.set(tab);
    this.page.set(1);
  }

  openResolver(a: AprobacionLegal) {
    this.drawerAprobacion.set(a);
    this.comentario.reset('');
    this.resolveError.set('');
    this.drawerOpen.set(true);
    void this.cargarDocumento(a);
  }

  /** AZ4 — carga la vista previa del documento referenciado, si lo hay. */
  private async cargarDocumento(a: AprobacionLegal) {
    this.docPreview.set(null);
    this.docError.set('');
    if (a.referencia_tipo !== 'documento_generado' || !a.referencia_id) return;
    this.docLoading.set(true);
    try {
      const doc = await this.plantillasSvc.getGeneradoById(a.referencia_id);
      this.docPreview.set(doc);
    } catch (e: unknown) {
      this.docError.set(e instanceof Error ? e.message : 'No se pudo cargar el documento.');
    } finally {
      this.docLoading.set(false);
    }
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async resolver(estado: 'aprobado' | 'rechazado') {
    const a = this.drawerAprobacion();
    const userId = this.userService.profile()?.id;
    if (!a || !userId || this.resolving()) return;

    this.resolving.set(true);
    this.resolveError.set('');
    try {
      const updated = await this.legalService.resolverAprobacion(a.id, estado, userId, this.comentario.value || null);
      this.aprobaciones.update((list) => list.map((item) => (item.id === a.id ? updated : item)));
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.resolveError.set(e instanceof Error ? e.message : 'Error al resolver la solicitud.');
    } finally {
      this.resolving.set(false);
    }
  }

  moduloLabel(modulo: string): string {
    return this.MODULOS.find((m) => m.value === modulo)?.label ?? modulo;
  }

  estadoBadgeClass(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'sgc-badge sgc-badge--warning';
      case 'aprobado': return 'sgc-badge sgc-badge--success';
      case 'rechazado': return 'sgc-badge sgc-badge--danger';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  estadoLabel(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'Pendiente';
      case 'aprobado': return 'Aprobado';
      case 'rechazado': return 'Rechazado';
      default: return estado;
    }
  }
}
