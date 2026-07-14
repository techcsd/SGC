import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppVersionesService } from '../../../../shared/services/app-versiones.service';
import { AppVersion } from '../../../../shared/models/app-version.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-admin-app-versiones',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './app-versiones.html',
  styleUrl: './app-versiones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAppVersiones implements OnInit {
  private service = inject(AppVersionesService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  versiones = signal<AppVersion[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');

  drawerOpen = signal(false);
  editingId = signal<string | null>(null);
  drawerTitle = computed(() => (this.editingId() ? 'Editar versión' : 'Nueva versión'));

  /** La versión "actual" que ve el usuario de campo (publicada más reciente). */
  publicadaActual = computed(() => this.versiones().find((v) => v.publicada) ?? null);
  minimaActual = computed(() => this.versiones().find((v) => v.minima) ?? null);

  form = new FormGroup({
    version: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    notas: new FormControl<string | null>(null),
    apk_url: new FormControl<string | null>(null),
    publicada: new FormControl(false, { nonNullable: true }),
    minima: new FormControl(false, { nonNullable: true }),
  });

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.versiones.set(await this.service.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las versiones.');
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    this.editingId.set(null);
    this.form.reset({ version: '', notas: null, apk_url: null, publicada: false, minima: false });
    this.drawerOpen.set(true);
  }

  openEdit(v: AppVersion) {
    this.editingId.set(v.id);
    this.form.reset({
      version: v.version,
      notas: v.notas,
      apk_url: v.apk_url,
      publicada: v.publicada,
      minima: v.minima,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    try {
      const id = this.editingId();
      if (id) {
        await this.service.update(id, v);
      } else {
        await this.service.create(v);
      }
      await this.load();
      this.drawerOpen.set(false);
      this.toast.success('Guardado', 'La versión se guardó correctamente.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async togglePublicada(v: AppVersion) {
    try {
      await this.service.setPublicada(v.id, !v.publicada);
      await this.load();
      this.toast.success(
        !v.publicada ? 'Versión publicada' : 'Versión despublicada',
        `v${v.version}`,
      );
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    }
  }

  async toggleMinima(v: AppVersion) {
    try {
      await this.service.setMinima(v.id, !v.minima);
      await this.load();
      this.toast.success('Versión mínima actualizada', `v${v.version}`);
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo cambiar la mínima.');
    }
  }

  async eliminar(v: AppVersion) {
    if (!confirm(`¿Eliminar la versión ${v.version}?`)) return;
    try {
      await this.service.remove(v.id);
      await this.load();
      this.toast.success('Versión eliminada', `v${v.version}`);
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  }
}
