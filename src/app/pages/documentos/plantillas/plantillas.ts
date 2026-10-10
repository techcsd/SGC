import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { UserService } from '../../../core/services/user.service';
import { PlantillaDocumento, PlantillaCategoria, CATEGORIA_LABELS, VARIABLES_CONTRATO, PlantillaVersion } from '../../../../shared/models/plantilla-documento.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';

@Component({
  selector: 'app-documentos-plantillas',
  imports: [ReactiveFormsModule, FormDrawer, RouterLink, Skeleton, Icon, DatePipe, StaggerDirective],
  templateUrl: './plantillas.html',
  styleUrl: './plantillas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Plantillas implements OnInit {
  private plantillasService = inject(PlantillasDocumentoService);
  private userService = inject(UserService);

  readonly CATEGORIA_LABELS = CATEGORIA_LABELS;
  readonly CATEGORIAS = Object.keys(CATEGORIA_LABELS) as PlantillaCategoria[];

  plantillas = signal<PlantillaDocumento[]>([]);
  loading = signal(true);
  error = signal('');

  drawerOpen = signal(false);
  saving = signal(false);
  saveError = signal('');
  selectedFile = signal<File | null>(null);

  // CF7 — asistente de espacios (`____` del Word).
  readonly VARIABLES = VARIABLES_CONTRATO;
  analizando = signal(false);
  htmlAnalizado = signal('');
  huecos = signal<{ n: number; contexto: string }[]>([]);
  mapeo = signal<Record<number, string>>({}); // hueco.n → clave de variable ('' = a mano)
  setMapeo(n: number, key: string) { this.mapeo.update((m) => ({ ...m, [n]: key })); }
  labelDeVariable(key: string): string { return this.VARIABLES.find((v) => v.key === key)?.label ?? key; }

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required]),
    categoria: new FormControl<PlantillaCategoria>('otro', [Validators.required]),
  });

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.plantillas.set(await this.plantillasService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las plantillas.');
    } finally {
      this.loading.set(false);
    }
  }

  porCategoria(cat: PlantillaCategoria): PlantillaDocumento[] {
    return this.plantillas().filter((p) => p.categoria === cat);
  }

  openUpload() {
    this.saveError.set('');
    this.form.reset({ categoria: 'otro' });
    this.selectedFile.set(null);
    this.huecos.set([]);
    this.mapeo.set({});
    this.htmlAnalizado.set('');
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
    this.huecos.set([]);
    this.mapeo.set({});
    this.htmlAnalizado.set('');
    this.saveError.set('');
    if (!file) return;
    // CF7 — analiza el Word para detectar los espacios `____`.
    this.analizando.set(true);
    try {
      const { html, huecos } = await this.plantillasService.analizarWord(file);
      this.htmlAnalizado.set(html);
      this.huecos.set(huecos);
      // Sugiere el nombre del archivo como nombre de la plantilla si está vacío.
      if (!this.form.value.nombre) this.form.get('nombre')?.setValue(file.name.replace(/\.docx$/i, ''));
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'No se pudo leer el Word.');
    } finally {
      this.analizando.set(false);
    }
  }

  async onSave() {
    this.form.markAllAsTouched();
    const file = this.selectedFile();
    if (this.form.invalid || !file || this.saving()) {
      if (!file) this.saveError.set('Selecciona un archivo .docx.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    try {
      const creadoPor = this.userService.profile()?.id ?? null;
      const v = this.form.value;
      let created: PlantillaDocumento;
      if (this.huecos().length) {
        // CF7 — Word con espacios `____`: usa el asistente de espacios.
        const mapeo = this.huecos().map((h) => {
          const key = this.mapeo()[h.n] ?? '';
          return { n: h.n, key, label: key ? this.labelDeVariable(key) : `Campo ${h.n + 1}` };
        });
        created = await this.plantillasService.crearPlantillaDesdeWord({
          nombre: v.nombre!, categoria: v.categoria!, html: this.htmlAnalizado(), file, mapeo, creadoPor,
        });
      } else {
        // Word con marcadores {{...}} (flujo clásico).
        created = await this.plantillasService.subirPlantillaPersonalizada(v.nombre!, v.categoria!, file, creadoPor);
      }
      this.plantillas.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al subir la plantilla.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── CF7/CE7 — editor + versiones ───────────────────────────────────────────
  editOpen = signal(false);
  editId = signal<string | null>(null);
  editNombre = signal('');
  editCategoria = signal<PlantillaCategoria>('otro');
  editHtml = signal('');
  editSaving = signal(false);
  editError = signal('');

  versOpen = signal(false);
  versiones = signal<PlantillaVersion[]>([]);
  versPlantilla = signal<PlantillaDocumento | null>(null);
  versBusy = signal(false);

  abrirEditor(p: PlantillaDocumento) {
    this.editId.set(p.id);
    this.editNombre.set(p.nombre);
    this.editCategoria.set(p.categoria);
    this.editHtml.set(p.contenido_html);
    this.editError.set('');
    this.editOpen.set(true);
  }
  cerrarEditor() { this.editOpen.set(false); }

  async guardarEdicion() {
    const id = this.editId();
    if (!id || this.editSaving()) return;
    if (!this.editNombre().trim() || !this.editHtml().trim()) { this.editError.set('El nombre y el contenido son obligatorios.'); return; }
    this.editSaving.set(true);
    this.editError.set('');
    try {
      const campos = this.plantillasService.camposDesdeHtml(this.editHtml());
      const upd = await this.plantillasService.editarPlantilla(id, {
        nombre: this.editNombre().trim(), categoria: this.editCategoria(), contenido_html: this.editHtml(), campos,
      });
      this.plantillas.update((list) => list.map((x) => x.id === id ? { ...x, ...upd } : x));
      this.editOpen.set(false);
    } catch (e: unknown) {
      this.editError.set(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.editSaving.set(false);
    }
  }

  async abrirVersiones(p: PlantillaDocumento) {
    this.versPlantilla.set(p);
    this.versiones.set([]);
    this.versOpen.set(true);
    this.versBusy.set(true);
    try { this.versiones.set(await this.plantillasService.listarVersiones(p.id)); }
    catch (e: unknown) { this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las versiones.'); }
    finally { this.versBusy.set(false); }
  }
  cerrarVersiones() { this.versOpen.set(false); }

  async restaurar(v: PlantillaVersion) {
    const p = this.versPlantilla();
    if (!p || this.versBusy()) return;
    if (!confirm(`¿Restaurar la versión ${v.version} de "${p.nombre}"? La versión actual se guarda antes de restaurar.`)) return;
    this.versBusy.set(true);
    try {
      await this.plantillasService.restaurarVersion(p.id, v.version);
      await this.load();
      this.versOpen.set(false);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo restaurar.');
    } finally { this.versBusy.set(false); }
  }

  // CF7 — marcar como predeterminada de su categoría.
  async marcarDefault(p: PlantillaDocumento) {
    try {
      await this.plantillasService.marcarDefault(p.id);
      this.plantillas.update((list) => list.map((x) =>
        x.categoria === p.categoria ? { ...x, es_default: x.id === p.id } : x));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo marcar como predeterminada.');
    }
  }

  async eliminar(p: PlantillaDocumento) {
    // Las plantillas del sistema no se pueden eliminar (protección adicional al ocultar el botón).
    if (p.origen === 'sistema') return;
    if (!confirm(`¿Eliminar la plantilla "${p.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.plantillasService.eliminarPlantilla(p.id);
      this.plantillas.update((list) => list.filter((x) => x.id !== p.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al eliminar la plantilla.');
    }
  }

  hayPlantillas = computed(() => this.plantillas().length > 0);

  get f() {
    return this.form.controls;
  }
}
