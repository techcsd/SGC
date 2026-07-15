import { Component, ChangeDetectionStrategy, inject, input, signal, computed, effect } from '@angular/core';
import { ProyectosService } from '../../services/proyectos.service';
import { UserService } from '../../../app/core/services/user.service';
import { ToastService } from '../../services/toast.service';
import { ExpedienteDoc, ExpedienteEstado, EXPEDIENTE_ESTADOS } from '../../models/proyecto.model';
import { formatTimestampDisplay } from '../../utils/fecha.util';

@Component({
  selector: 'app-expediente-obra',
  imports: [],
  templateUrl: './expediente-obra.html',
  styleUrl: './expediente-obra.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpedienteObra {
  proyectoId = input.required<string>();
  usuarios = input<{ id: string; nombre: string }[]>([]);

  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  readonly EXPEDIENTE_ESTADOS = EXPEDIENTE_ESTADOS;
  readonly formatFecha = formatTimestampDisplay;

  docs = signal<ExpedienteDoc[]>([]);
  loading = signal(true);
  error = signal('');
  sembrando = signal(false);
  /** Ids of docs whose file control is currently uploading. */
  subiendo = signal<Set<string>>(new Set());

  completitud = computed(() => {
    const list = this.docs();
    const total = list.length;
    const validados = list.filter((d) => d.estado === 'validado').length;
    const noAplica = list.filter((d) => d.estado === 'no_aplica').length;
    const resueltos = validados + noAplica;
    // "No aplica" cuenta como resuelto para que el expediente pueda llegar a 100%.
    const pct = total > 0 ? Math.round((resueltos / total) * 100) : 0;
    return { total, validados, noAplica, resueltos, pct };
  });

  constructor() {
    effect(() => {
      const id = this.proyectoId();
      if (id) this.load(id);
    });
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.docs.set(await this.proyectosService.getExpediente(id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el expediente.');
    } finally {
      this.loading.set(false);
    }
  }

  private get userId(): string | null {
    return this.userService.profile()?.id ?? null;
  }

  private patchLocal(id: string, patch: Partial<ExpedienteDoc>) {
    this.docs.update((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async inicializar() {
    if (this.sembrando()) return;
    this.sembrando.set(true);
    this.error.set('');
    try {
      await this.proyectosService.sembrarExpediente(this.proyectoId());
      await this.load(this.proyectoId());
      this.toast.success('Expediente inicializado', 'Se cargaron los documentos estándar.');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al inicializar el expediente.');
    } finally {
      this.sembrando.set(false);
    }
  }

  async onEstadoChange(doc: ExpedienteDoc, value: string) {
    const estado = value as ExpedienteEstado;
    const previo = doc.estado;
    this.patchLocal(doc.id, { estado });
    try {
      await this.proyectosService.updateExpedienteDoc(doc.id, { estado }, this.userId);
      if (estado === 'validado') {
        // The service stamps validado_por/en server-side; mirror it locally.
        this.patchLocal(doc.id, { validado_por: this.userId, validado_en: new Date().toISOString() });
      } else {
        this.patchLocal(doc.id, { validado_por: null, validado_en: null });
      }
    } catch (e: unknown) {
      this.patchLocal(doc.id, { estado: previo });
      this.toast.error('No se pudo actualizar el estado', e instanceof Error ? e.message : undefined);
    }
  }

  async onResponsableChange(doc: ExpedienteDoc, value: string) {
    const responsable_id = value || null;
    const previo = doc.responsable_id;
    this.patchLocal(doc.id, { responsable_id });
    try {
      await this.proyectosService.updateExpedienteDoc(doc.id, { responsable_id }, this.userId);
    } catch (e: unknown) {
      this.patchLocal(doc.id, { responsable_id: previo });
      this.toast.error('No se pudo actualizar el responsable', e instanceof Error ? e.message : undefined);
    }
  }

  async onNotasChange(doc: ExpedienteDoc, value: string) {
    const notas = value.trim() || null;
    if (notas === doc.notas) return;
    const previo = doc.notas;
    this.patchLocal(doc.id, { notas });
    try {
      await this.proyectosService.updateExpedienteDoc(doc.id, { notas }, this.userId);
    } catch (e: unknown) {
      this.patchLocal(doc.id, { notas: previo });
      this.toast.error('No se pudo guardar la nota', e instanceof Error ? e.message : undefined);
    }
  }

  async onEnlaceChange(doc: ExpedienteDoc, value: string) {
    const enlace = value.trim() || null;
    if (enlace === doc.enlace) return;
    const previo = doc.enlace;
    this.patchLocal(doc.id, { enlace });
    try {
      await this.proyectosService.updateExpedienteDoc(doc.id, { enlace }, this.userId);
    } catch (e: unknown) {
      this.patchLocal(doc.id, { enlace: previo });
      this.toast.error('No se pudo guardar el enlace', e instanceof Error ? e.message : undefined);
    }
  }

  async onArchivoSelected(doc: ExpedienteDoc, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (this.subiendo().has(doc.id)) return;

    this.subiendo.update((s) => new Set(s).add(doc.id));
    try {
      const path = await this.proyectosService.uploadExpedienteArchivo(this.proyectoId(), doc.codigo, file);
      // Only bump to 'cargado' if it was still 'pendiente'.
      const nuevoEstado: ExpedienteEstado | undefined = doc.estado === 'pendiente' ? 'cargado' : undefined;
      const patch = nuevoEstado ? { archivo_path: path, estado: nuevoEstado } : { archivo_path: path };
      await this.proyectosService.updateExpedienteDoc(doc.id, patch, this.userId);
      this.patchLocal(doc.id, patch);
      this.toast.success('Archivo cargado', doc.nombre);
    } catch (e: unknown) {
      this.toast.error('No se pudo subir el archivo', e instanceof Error ? e.message : undefined);
    } finally {
      this.subiendo.update((s) => {
        const next = new Set(s);
        next.delete(doc.id);
        return next;
      });
    }
  }

  async verArchivo(doc: ExpedienteDoc) {
    if (!doc.archivo_path) return;
    try {
      const url = await this.proyectosService.getExpedienteArchivoUrl(doc.archivo_path);
      if (url) window.open(url, '_blank', 'noopener');
      else this.toast.error('No se pudo abrir el archivo');
    } catch (e: unknown) {
      this.toast.error('No se pudo abrir el archivo', e instanceof Error ? e.message : undefined);
    }
  }

  estaSubiendo(id: string): boolean {
    return this.subiendo().has(id);
  }

  badgeDeEstado(estado: ExpedienteEstado): string {
    return EXPEDIENTE_ESTADOS.find((e) => e.value === estado)?.badge ?? 'neutral';
  }

  labelDeEstado(estado: ExpedienteEstado): string {
    return EXPEDIENTE_ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }
}
