import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LegalService } from '../../../../shared/services/legal.service';
import { UserService } from '../../../core/services/user.service';
import { AprobacionLegal, APROBACION_MODULOS } from '../../../../shared/models/legal.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-aprobaciones',
  imports: [FormDrawer, DatePipe, ReactiveFormsModule, Skeleton],
  templateUrl: './aprobaciones.html',
  styleUrl: './aprobaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Aprobaciones implements OnInit {
  private legalService = inject(LegalService);
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

  pendientes = computed(() => this.aprobaciones().filter((a) => a.estado === 'pendiente'));

  visible = computed(() => (this.tab() === 'pendientes' ? this.pendientes() : this.aprobaciones()));

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
  }

  openResolver(a: AprobacionLegal) {
    this.drawerAprobacion.set(a);
    this.comentario.reset('');
    this.resolveError.set('');
    this.drawerOpen.set(true);
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
