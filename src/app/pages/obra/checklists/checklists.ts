import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { HumanizarEnumPipe } from '../../../../shared/pipes/humanizar-enum.pipe';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ObraProduccionService } from '../../../../shared/services/obra-produccion.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import {
  ClPlantilla, ClPlantillaItem, ClRegistro, ChecklistCumple, ChecklistRespuestaInput,
} from '../../../../shared/models/obra-produccion.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

type Tab = 'ejecutar' | 'plantillas';
interface Respuesta { cumple: ChecklistCumple; comentario: string; }
interface Hallazgo { etiqueta: string; comentario: string; ncCreada: boolean; }

@Component({
  selector: 'app-obra-checklists',
  imports: [HumanizarEnumPipe, ReactiveFormsModule, FormDrawer, FileUpload, Skeleton],
  templateUrl: './checklists.html',
  styleUrl: './checklists.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObraChecklists implements OnInit {
  private service = inject(ObraProduccionService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  tab = signal<Tab>('ejecutar');
  loadingInit = signal(true);
  saving = signal(false);

  proyectos = signal<Proyecto[]>([]);
  plantillas = signal<ClPlantilla[]>([]);
  ejecutados = signal<ClRegistro[]>([]);

  puedeOperar = computed(() => this.userService.puedeOperarSubmodulo('obra.checklists'));

  // ── Ejecutar ──
  proyectoId = signal<string>('');
  plantillaId = signal<string>('');
  items = signal<ClPlantillaItem[]>([]);
  respuestas = signal<Record<string, Respuesta>>({});
  observaciones = signal<string>('');
  fotos = signal<File[]>([]);
  hallazgos = signal<Hallazgo[]>([]);
  ultimoProyecto = signal<string>('');

  // ── Plantilla editor ──
  editorPlantilla = signal<ClPlantilla | null>(null);
  editorItems = signal<ClPlantillaItem[]>([]);
  nuevaPlantillaOpen = signal(false);
  nuevoItemOpen = signal(false);

  nuevaPlantillaForm = new FormGroup({
    nombre: new FormControl('', [Validators.required]),
    fase: new FormControl<string | null>(null),
  });
  nuevoItemForm = new FormGroup({
    seccion: new FormControl<string | null>(null),
    etiqueta: new FormControl('', [Validators.required]),
  });

  async ngOnInit() {
    try {
      const [proyectos, plantillas, ejecutados] = await Promise.all([
        this.proyectosService.getAll(),
        this.service.getPlantillasCalidad(),
        this.service.getChecklistsEjecutados(),
      ]);
      this.proyectos.set(proyectos);
      this.plantillas.set(plantillas);
      this.ejecutados.set(ejecutados);
      if (proyectos.length) this.proyectoId.set(proyectos[0].id);
    } catch (e: unknown) {
      this.toast.error('Error al cargar', e instanceof Error ? e.message : undefined);
    } finally {
      this.loadingInit.set(false);
    }
  }

  setTab(t: Tab) { this.tab.set(t); }

  // ── Ejecutar checklist ──
  async onPlantillaChange(id: string) {
    this.plantillaId.set(id);
    this.hallazgos.set([]);
    if (!id) { this.items.set([]); return; }
    try {
      const items = await this.service.getPlantillaItems(id);
      this.items.set(items);
      const r: Record<string, Respuesta> = {};
      for (const it of items) r[it.id] = { cumple: 'ok', comentario: '' };
      this.respuestas.set(r);
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  setCumple(itemId: string, cumple: ChecklistCumple) {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...r[itemId], cumple } }));
  }
  setComentario(itemId: string, comentario: string) {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...r[itemId], comentario } }));
  }
  onFotosAdd(files: File[]) { this.fotos.update((l) => [...l, ...files]); }
  onFotosRemove(i: number) { this.fotos.update((l) => l.filter((_, idx) => idx !== i)); }

  async guardarChecklist() {
    if (!this.proyectoId() || !this.plantillaId() || this.saving()) {
      this.toast.warning('Selecciona obra y checklist');
      return;
    }
    this.saving.set(true);
    try {
      const r = this.respuestas();
      const respuestas: ChecklistRespuestaInput[] = this.items().map((it, idx) => ({
        etiqueta: it.etiqueta,
        seccion: it.seccion,
        cumple: r[it.id].cumple === 'na' ? null : r[it.id].cumple === 'ok',
        comentario: r[it.id].comentario || null,
        orden: it.orden ?? idx,
      }));
      const fotoPaths = this.fotos().length ? await this.service.subirFotos(this.fotos(), 'checklist') : [];
      const fotosJson = fotoPaths.map((p) => ({ storage_path: p, correcto: null, descripcion: null }));
      await this.service.ejecutarChecklistCalidad({
        plantillaId: this.plantillaId(),
        proyectoId: this.proyectoId(),
        respuestas,
        fotos: fotosJson,
        observaciones: this.observaciones() || null,
      });
      // Hallazgos = ítems "no cumple"
      const hall = this.items()
        .filter((it) => r[it.id].cumple === 'no')
        .map((it) => ({ etiqueta: it.etiqueta, comentario: r[it.id].comentario, ncCreada: false }));
      this.hallazgos.set(hall);
      this.ultimoProyecto.set(this.proyectoId());
      this.toast.success('Checklist registrado', hall.length ? `${hall.length} hallazgo(s)` : undefined);
      // Reset ejecución (deja hallazgos visibles)
      this.observaciones.set('');
      this.fotos.set([]);
      this.plantillaId.set('');
      this.items.set([]);
      this.ejecutados.set(await this.service.getChecklistsEjecutados());
    } catch (e: unknown) {
      this.toast.error('No se pudo registrar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async levantarNCDeHallazgo(h: Hallazgo, plantillaNombre: string) {
    try {
      await this.service.levantarNC(
        {
          proyecto_id: this.ultimoProyecto(),
          tipo: 'calidad',
          titulo: h.etiqueta,
          descripcion: `Hallazgo en checklist "${plantillaNombre}": ${h.etiqueta}${h.comentario ? ' — ' + h.comentario : ''}`,
          severidad: 'media',
          ubicacion: null,
          responsable_id: null,
          bloquea_vaciado: false,
        },
        [],
      );
      this.hallazgos.update((list) => list.map((x) => (x === h ? { ...x, ncCreada: true } : x)));
      this.toast.success('No conformidad levantada');
    } catch (e: unknown) {
      this.toast.error('No se pudo levantar la NC', e instanceof Error ? e.message : undefined);
    }
  }

  plantillaNombre(id: string): string { return this.plantillas().find((p) => p.id === id)?.nombre ?? ''; }

  // ── Plantilla editor ──
  async openEditor(p: ClPlantilla) {
    this.editorPlantilla.set(p);
    this.editorItems.set([]);
    try {
      this.editorItems.set(await this.service.getPlantillaItems(p.id));
    } catch { /* ignore */ }
  }
  closeEditor() { this.editorPlantilla.set(null); }

  openNuevaPlantilla() {
    this.nuevaPlantillaForm.reset();
    this.nuevaPlantillaOpen.set(true);
  }
  async saveNuevaPlantilla() {
    this.nuevaPlantillaForm.markAllAsTouched();
    if (this.nuevaPlantillaForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.nuevaPlantillaForm.value;
      const p = await this.service.crearPlantillaCalidad(v.nombre!, v.fase || null);
      this.plantillas.update((l) => [...l, p]);
      this.nuevaPlantillaOpen.set(false);
      this.openEditor(p);
      this.toast.success('Plantilla creada');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  openNuevoItem() {
    this.nuevoItemForm.reset();
    this.nuevoItemOpen.set(true);
  }
  async saveNuevoItem() {
    this.nuevoItemForm.markAllAsTouched();
    const p = this.editorPlantilla();
    if (!p || this.nuevoItemForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.nuevoItemForm.value;
      const orden = this.editorItems().length + 1;
      await this.service.agregarItemPlantilla(p.id, v.seccion || null, v.etiqueta!, orden);
      this.editorItems.set(await this.service.getPlantillaItems(p.id));
      this.nuevoItemOpen.set(false);
      this.toast.success('Ítem agregado');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }
  async eliminarItem(item: ClPlantillaItem) {
    try {
      await this.service.eliminarItemPlantilla(item.id);
      this.editorItems.update((l) => l.filter((x) => x.id !== item.id));
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  get fP() { return this.nuevaPlantillaForm.controls; }
  get fI() { return this.nuevoItemForm.controls; }
}
