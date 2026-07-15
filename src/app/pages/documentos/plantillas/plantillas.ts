import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { UserService } from '../../../core/services/user.service';
import { PlantillaDocumento, PlantillaCategoria, CATEGORIA_LABELS } from '../../../../shared/models/plantilla-documento.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-documentos-plantillas',
  imports: [ReactiveFormsModule, FormDrawer, RouterLink, Skeleton],
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
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
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
      const created = await this.plantillasService.subirPlantillaPersonalizada(v.nombre!, v.categoria!, file, creadoPor);
      this.plantillas.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al subir la plantilla.');
    } finally {
      this.saving.set(false);
    }
  }

  async eliminar(p: PlantillaDocumento) {
    try {
      await this.plantillasService.eliminarPlantilla(p.id);
      this.plantillas.update((list) => list.filter((x) => x.id !== p.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al eliminar la plantilla.');
    }
  }

  get f() {
    return this.form.controls;
  }
}
