import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  JiraService, JiraIssue, JiraEpica, JiraDetalle, JiraEstado, JiraTipo, JiraPrioridad,
} from '../../../../shared/services/jira.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

const COLUMNAS: { estado: JiraEstado; label: string }[] = [
  { estado: 'backlog', label: 'Backlog' },
  { estado: 'por_hacer', label: 'Por hacer' },
  { estado: 'en_progreso', label: 'En progreso' },
  { estado: 'en_revision', label: 'En revisión' },
  { estado: 'hecho', label: 'Hecho' },
];

/**
 * AY15 — Jira interno v1: board Kanban de issues (solo Tecnología). Drag&drop nativo
 * (sin @angular/cdk). Issues tipados, prioridad, labels, épicas, comentarios, historial,
 * adjuntos y "crear issue desde reporte de error" (AW14).
 */
@Component({
  selector: 'app-admin-jira',
  imports: [ReactiveFormsModule, DatePipe, FormDrawer, Skeleton],
  templateUrl: './jira.html',
  styleUrl: './jira.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminJira implements OnInit {
  private svc = inject(JiraService);
  private toast = inject(ToastService);

  readonly columnas = COLUMNAS;
  issues = signal<JiraIssue[]>([]);
  epicas = signal<JiraEpica[]>([]);
  usuarios = signal<{ id: string; nombre: string }[]>([]);
  loading = signal(true);

  // Filtros
  fTipo = signal('');
  fPrioridad = signal('');
  fEpica = signal('');
  fQ = signal('');

  // Drag&drop
  private dragId: string | null = null;
  dragOverCol = signal<string | null>(null);

  filtradas = computed(() => {
    const t = this.fTipo(), p = this.fPrioridad(), e = this.fEpica(), q = this.fQ().trim().toLowerCase();
    return this.issues().filter((i) =>
      (!t || i.tipo === t) && (!p || i.prioridad === p) && (!e || i.epica_id === e) &&
      (!q || i.titulo.toLowerCase().includes(q) || (i.labels ?? []).some((l) => l.toLowerCase().includes(q))));
  });

  porColumna(estado: JiraEstado): JiraIssue[] {
    return this.filtradas().filter((i) => i.estado === estado);
  }
  conteo(estado: JiraEstado): number { return this.porColumna(estado).length; }

  // Crear/editar
  drawerOpen = signal(false);
  editId = signal<string | null>(null);
  saving = signal(false);
  form = new FormGroup({
    titulo: new FormControl('', [Validators.required]),
    tipo: new FormControl<JiraTipo>('tarea'),
    descripcion: new FormControl<string | null>(null),
    prioridad: new FormControl<JiraPrioridad>('media'),
    labels: new FormControl<string>(''),
    asignado_a: new FormControl<string | null>(null),
    epica_id: new FormControl<string | null>(null),
    estado: new FormControl<JiraEstado>('backlog'),
  });

  // Detalle
  detalleOpen = signal(false);
  detalle = signal<JiraDetalle | null>(null);
  nuevoComentario = signal('');
  detalleBusy = signal(false);

  // Épica
  epicaOpen = signal(false);
  epicaTitulo = new FormControl('', [Validators.required]);

  async ngOnInit() {
    await this.cargar();
    try {
      const [eps, us] = await Promise.all([this.svc.epicasListar(), this.svc.directorio()]);
      this.epicas.set(eps);
      this.usuarios.set(us);
    } catch { /* opcional */ }
  }

  async cargar() {
    this.loading.set(true);
    try {
      this.issues.set(await this.svc.listar());
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los issues.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Drag & drop nativo ────────────────────────────────────
  onDragStart(id: string) { this.dragId = id; }
  onDragOver(ev: DragEvent, estado: string) { ev.preventDefault(); this.dragOverCol.set(estado); }
  onDragLeave(estado: string) { if (this.dragOverCol() === estado) this.dragOverCol.set(null); }

  async onDrop(ev: DragEvent, estado: JiraEstado) {
    ev.preventDefault();
    this.dragOverCol.set(null);
    const id = this.dragId;
    this.dragId = null;
    if (!id) return;
    const issue = this.issues().find((i) => i.id === id);
    if (!issue || issue.estado === estado) return;
    // Optimista: mover en memoria; orden = final de la columna destino.
    const maxOrden = Math.max(0, ...this.porColumna(estado).map((i) => i.orden));
    this.issues.update((list) => list.map((i) => (i.id === id ? { ...i, estado, orden: maxOrden + 10 } : i)));
    try {
      await this.svc.mover(id, estado, maxOrden + 10);
    } catch (e: unknown) {
      this.toast.error('No se pudo mover el issue', e instanceof Error ? e.message : undefined);
      await this.cargar();
    }
  }

  // ── Crear / editar ────────────────────────────────────────
  abrirCrear(estado: JiraEstado = 'backlog') {
    this.editId.set(null);
    this.form.reset({ tipo: 'tarea', prioridad: 'media', estado, labels: '' });
    this.drawerOpen.set(true);
  }

  async abrirEditarDesdeDetalle() {
    const d = this.detalle();
    if (!d) return;
    const i = d.issue;
    this.editId.set(i.id);
    this.form.reset({
      titulo: i.titulo, tipo: i.tipo, descripcion: i.descripcion, prioridad: i.prioridad,
      labels: (i.labels ?? []).join(', '), asignado_a: i.asignado_a, epica_id: i.epica_id, estado: i.estado,
    });
    this.detalleOpen.set(false);
    this.drawerOpen.set(true);
  }

  private labelsArray(): string[] {
    return (this.form.value.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  async guardar() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.form.value;
      const id = this.editId();
      if (id) {
        await this.svc.actualizar(id, {
          titulo: v.titulo!, descripcion: v.descripcion ?? null, tipo: v.tipo as JiraTipo,
          prioridad: v.prioridad as JiraPrioridad, labels: this.labelsArray(), asignado_a: v.asignado_a ?? null, epica_id: v.epica_id ?? null,
        });
        this.toast.success('Issue actualizado');
      } else {
        await this.svc.crear({
          titulo: v.titulo!, tipo: v.tipo as JiraTipo, descripcion: v.descripcion ?? null,
          prioridad: v.prioridad as JiraPrioridad, labels: this.labelsArray(), asignado_a: v.asignado_a ?? null,
          epica_id: v.epica_id ?? null, estado: v.estado as JiraEstado,
        });
        this.toast.success('Issue creado');
      }
      this.drawerOpen.set(false);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Detalle ───────────────────────────────────────────────
  async abrirDetalle(i: JiraIssue) {
    this.detalle.set(null);
    this.nuevoComentario.set('');
    this.detalleOpen.set(true);
    try {
      this.detalle.set(await this.svc.detalle(i.id));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo abrir el issue.');
    }
  }

  async comentar() {
    const d = this.detalle();
    const txt = this.nuevoComentario().trim();
    if (!d || !txt || this.detalleBusy()) return;
    this.detalleBusy.set(true);
    try {
      await this.svc.comentar(d.issue.id, txt);
      this.nuevoComentario.set('');
      this.detalle.set(await this.svc.detalle(d.issue.id));
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo comentar.');
    } finally {
      this.detalleBusy.set(false);
    }
  }

  async adjuntar(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const d = this.detalle();
    if (!file || !d) return;
    this.detalleBusy.set(true);
    try {
      await this.svc.adjuntar(d.issue.id, file);
      this.detalle.set(await this.svc.detalle(d.issue.id));
      this.toast.success('Adjunto subido');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo subir el adjunto.');
    } finally {
      this.detalleBusy.set(false);
      input.value = '';
    }
  }

  async abrirAdjunto(path: string) {
    try {
      window.open(await this.svc.adjuntoUrl(path), '_blank');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo abrir el adjunto.');
    }
  }

  async eliminar() {
    const d = this.detalle();
    if (!d) return;
    if (!confirm(`¿Eliminar el issue "${d.issue.titulo}"? No se puede deshacer.`)) return;
    try {
      await this.svc.eliminar(d.issue.id);
      this.detalleOpen.set(false);
      this.toast.success('Issue eliminado');
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  }

  // ── Épica ─────────────────────────────────────────────────
  async crearEpica() {
    const t = this.epicaTitulo.value?.trim();
    if (!t) return;
    try {
      await this.svc.epicaCrear(t);
      this.epicas.set(await this.svc.epicasListar());
      this.epicaTitulo.reset('');
      this.epicaOpen.set(false);
      this.toast.success('Épica creada');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la épica.');
    }
  }

  // ── UI helpers ────────────────────────────────────────────
  tipoLabel(t: string): string {
    return { tarea: 'Tarea', bug: 'Bug', mejora: 'Mejora', epica: 'Épica' }[t] ?? t;
  }
  prioClase(p: string): string { return `jira-prio jira-prio--${p}`; }
  tipoClase(t: string): string { return `jira-tipo jira-tipo--${t}`; }
  formatSize(b: number | null): string {
    if (!b) return '';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  }
}
