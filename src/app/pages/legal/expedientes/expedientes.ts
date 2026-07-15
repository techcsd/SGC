import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LegalService } from '../../../../shared/services/legal.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import {
  EXPEDIENTE_ESTADOS,
  EXPEDIENTE_PRIORIDADES,
  EXPEDIENTE_TIPOS,
  ExpedienteArchivo,
  ExpedienteEstado,
  ExpedienteLegal,
  ExpedienteNota,
} from '../../../../shared/models/legal.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

const ESTADO_TRANSICIONES: Record<ExpedienteEstado, ExpedienteEstado[]> = {
  abierto: ['en_proceso', 'en_espera', 'cerrado'],
  en_proceso: ['en_espera', 'cerrado'],
  en_espera: ['en_proceso', 'cerrado'],
  cerrado: [],
};

@Component({
  selector: 'app-expedientes',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, Skeleton],
  templateUrl: './expedientes.html',
  styleUrl: './expedientes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Expedientes implements OnInit {
  private legalService = inject(LegalService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);

  readonly TIPOS = EXPEDIENTE_TIPOS;
  readonly ESTADOS = EXPEDIENTE_ESTADOS;
  readonly PRIORIDADES = EXPEDIENTE_PRIORIDADES;

  expedientes = signal<ExpedienteLegal[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  searchQuery = signal('');
  selectedEstado = signal<string>('all');
  selectedTipo = signal<string>('all');

  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  detailOpen = signal(false);
  detailExpediente = signal<ExpedienteLegal | null>(null);
  detailNotas = signal<ExpedienteNota[]>([]);
  detailArchivos = signal<ExpedienteArchivo[]>([]);
  detailLoading = signal(false);
  nuevaNota = new FormControl('');
  savingNota = signal(false);
  uploadingArchivo = signal(false);

  form = new FormGroup({
    titulo: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    tipo: new FormControl<string>('otro', [Validators.required]),
    prioridad: new FormControl<string>('media', [Validators.required]),
    proyecto_id: new FormControl<string | null>(null),
    contraparte: new FormControl<string | null>(null),
    fecha_limite: new FormControl<string | null>(null),
    descripcion: new FormControl<string | null>(null),
  });

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    const tipo = this.selectedTipo();

    return this.expedientes().filter((e) => {
      if (
        q &&
        !e.titulo.toLowerCase().includes(q) &&
        !e.codigo.toLowerCase().includes(q) &&
        !(e.contraparte ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (estado !== 'all' && e.estado !== estado) return false;
      if (tipo !== 'all' && e.tipo !== tipo) return false;
      return true;
    });
  });

  drawerTitle = computed(() => (this.editingId() ? 'Editar expediente' : 'Nuevo expediente'));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [expedientes, proyectos] = await Promise.all([
        this.legalService.getExpedientes(),
        this.proyectosService.getAll(),
      ]);
      this.expedientes.set(expedientes);
      this.proyectos.set(proyectos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los expedientes.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
  }
  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }
  onTipoChange(value: string) {
    this.selectedTipo.set(value);
  }
  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('all');
    this.selectedTipo.set('all');
  }

  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ tipo: 'otro', prioridad: 'media' });
    this.drawerOpen.set(true);
  }

  openEdit(e: ExpedienteLegal) {
    this.editingId.set(e.id);
    this.saveError.set('');
    this.form.reset({
      titulo: e.titulo,
      tipo: e.tipo,
      prioridad: e.prioridad,
      proyecto_id: e.proyecto_id,
      contraparte: e.contraparte,
      fecha_limite: e.fecha_limite,
      descripcion: e.descripcion,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const raw = this.form.value;
    const payload: Partial<ExpedienteLegal> = {
      titulo: raw.titulo!,
      tipo: raw.tipo as ExpedienteLegal['tipo'],
      prioridad: raw.prioridad as ExpedienteLegal['prioridad'],
      proyecto_id: raw.proyecto_id || null,
      contraparte: raw.contraparte || null,
      fecha_limite: raw.fecha_limite || null,
      descripcion: raw.descripcion || null,
    };

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.legalService.updateExpediente(id, payload);
        this.expedientes.update((list) => list.map((e) => (e.id === id ? updated : e)));
      } else {
        payload.creado_por = this.userService.profile()?.id ?? null;
        payload.responsable_id = this.userService.profile()?.id ?? null;
        const created = await this.legalService.createExpediente(payload);
        this.expedientes.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Detail drawer ────────────────────────────────────────
  async openDetail(e: ExpedienteLegal) {
    this.detailExpediente.set(e);
    this.detailOpen.set(true);
    this.detailLoading.set(true);
    this.nuevaNota.reset('');
    try {
      const [notas, archivos] = await Promise.all([
        this.legalService.getNotas(e.id),
        this.legalService.getArchivos(e.id),
      ]);
      this.detailNotas.set(notas);
      this.detailArchivos.set(archivos);
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  async cambiarEstado(estado: ExpedienteEstado) {
    const exp = this.detailExpediente();
    if (!exp) return;
    const prev = exp;
    const updated = await this.legalService.cambiarEstadoExpediente(exp.id, estado);
    this.detailExpediente.set(updated);
    this.expedientes.update((list) => list.map((e) => (e.id === exp.id ? updated : e)));
    void prev;
  }

  nextEstados(current: ExpedienteEstado): ExpedienteEstado[] {
    return ESTADO_TRANSICIONES[current];
  }

  async onAddNota() {
    const exp = this.detailExpediente();
    const texto = this.nuevaNota.value?.trim();
    if (!exp || !texto || this.savingNota()) return;

    this.savingNota.set(true);
    try {
      const nota = await this.legalService.addNota(exp.id, this.userService.profile()?.id ?? null, texto);
      this.detailNotas.update((list) => [nota, ...list]);
      this.nuevaNota.reset('');
    } finally {
      this.savingNota.set(false);
    }
  }

  async onFileSelected(event: Event) {
    const exp = this.detailExpediente();
    const files = (event.target as HTMLInputElement).files;
    if (!exp || !files || files.length === 0) return;

    this.uploadingArchivo.set(true);
    try {
      for (const file of Array.from(files)) {
        const archivo = await this.legalService.subirArchivo(exp.id, file, this.userService.profile()?.id ?? null);
        this.detailArchivos.update((list) => [archivo, ...list]);
      }
    } finally {
      this.uploadingArchivo.set(false);
      (event.target as HTMLInputElement).value = '';
    }
  }

  async descargarArchivo(archivo: ExpedienteArchivo) {
    const url = await this.legalService.getArchivoUrl(archivo.archivo_path);
    window.open(url, '_blank');
  }

  async eliminarArchivo(archivo: ExpedienteArchivo) {
    await this.legalService.eliminarArchivo(archivo.id, archivo.archivo_path);
    this.detailArchivos.update((list) => list.filter((a) => a.id !== archivo.id));
  }

  // ── Helpers ──────────────────────────────────────────────
  estadoBadgeClass(estado: ExpedienteEstado): string {
    switch (estado) {
      case 'abierto': return 'sgc-badge sgc-badge--info';
      case 'en_proceso': return 'sgc-badge sgc-badge--warning';
      case 'en_espera': return 'sgc-badge sgc-badge--neutral';
      case 'cerrado': return 'sgc-badge sgc-badge--success';
    }
  }

  estadoLabel(estado: ExpedienteEstado): string {
    return this.ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }

  tipoLabel(tipo: string): string {
    return this.TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  prioridadBadgeClass(prioridad: string): string {
    switch (prioridad) {
      case 'urgente': return 'sgc-badge sgc-badge--danger';
      case 'alta': return 'sgc-badge sgc-badge--warning';
      case 'baja': return 'sgc-badge sgc-badge--neutral';
      default: return 'sgc-badge sgc-badge--info';
    }
  }

  prioridadLabel(prioridad: string): string {
    return this.PRIORIDADES.find((p) => p.value === prioridad)?.label ?? prioridad;
  }

  isVencido(e: ExpedienteLegal): boolean {
    if (!e.fecha_limite || e.estado === 'cerrado') return false;
    return new Date(e.fecha_limite) < new Date(new Date().toDateString());
  }

  get f() {
    return this.form.controls;
  }
}
