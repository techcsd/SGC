import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppVersionesService } from '../../../../shared/services/app-versiones.service';
import { AppVersion, semverCode } from '../../../../shared/models/app-version.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-admin-app-versiones',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, DecimalPipe],
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

  /** Guía "¿cómo funciona?" — recuerda si el admin la ocultó. */
  guiaAbierta = signal<boolean>(this.leerPrefGuia());

  private leerPrefGuia(): boolean {
    try {
      return localStorage.getItem('av_guia_oculta') !== '1';
    } catch {
      return true;
    }
  }

  toggleGuia() {
    const abierta = !this.guiaAbierta();
    this.guiaAbierta.set(abierta);
    try {
      localStorage.setItem('av_guia_oculta', abierta ? '0' : '1');
    } catch {
      /* localStorage no disponible: no persistimos, no pasa nada */
    }
  }

  drawerOpen = signal(false);
  editingId = signal<string | null>(null);
  drawerTitle = computed(() => (this.editingId() ? 'Editar versión' : 'Nueva versión'));

  /** Subida de APK (V3). */
  apkFile = signal<File | null>(null);
  uploading = signal(false);
  uploadPct = signal(0);

  /** Mayor versión (SEMVER real, no string) dentro de un filtro. */
  private mayorSemver(pred: (v: AppVersion) => boolean): AppVersion | null {
    const code = (v: AppVersion) => v.version_code ?? semverCode(v.version);
    return (
      this.versiones()
        .filter(pred)
        .sort((a, b) => code(b) - code(a))[0] ?? null
    );
  }

  /** La versión "actual" que ve el usuario de campo: la MAYOR publicada (semver). */
  publicadaActual = computed(() => this.mayorSemver((v) => v.publicada));
  minimaActual = computed(() => this.mayorSemver((v) => v.minima));

  /** Última versión disponible (la de mayor número de versión, semver real). */
  ultima = computed(() => this.mayorSemver(() => true));

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
    this.apkFile.set(null);
    this.uploadPct.set(0);
    this.form.reset({ version: '', notas: null, apk_url: null, publicada: false, minima: false });
    this.drawerOpen.set(true);
  }

  openEdit(v: AppVersion) {
    this.editingId.set(v.id);
    this.apkFile.set(null);
    this.uploadPct.set(0);
    this.form.reset({
      version: v.version,
      notas: v.notas,
      apk_url: v.apk_url,
      publicada: v.publicada,
      minima: v.minima,
    });
    this.drawerOpen.set(true);
  }

  onApkSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.apkFile.set(file);
    this.uploadPct.set(0);
  }

  closeDrawer() {
    if (this.uploading()) return; // no cerrar a mitad de una subida
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
      // 1) Si hay un APK seleccionado, súbelo primero y usa su URL pública.
      const file = this.apkFile();
      if (file) {
        this.uploading.set(true);
        try {
          const apkUrl = await this.service.uploadApk(file, v.version, (pct) =>
            this.uploadPct.set(pct),
          );
          v.apk_url = apkUrl;
          this.form.controls.apk_url.setValue(apkUrl);
        } finally {
          this.uploading.set(false);
        }
      }

      // 2) Guarda la versión y detecta si es una NUEVA publicación.
      const id = this.editingId();
      const yaEstabaPublicada = id
        ? (this.versiones().find((x) => x.id === id)?.publicada ?? false)
        : false;
      if (id) {
        await this.service.update(id, v);
      } else {
        await this.service.create(v);
      }
      const seAcabaDePublicar = v.publicada && !yaEstabaPublicada;

      await this.load();
      this.drawerOpen.set(false);
      this.apkFile.set(null);
      this.toast.success('Guardado', 'La versión se guardó correctamente.');

      // 3) Notifica a todos si esta acción publicó la versión.
      if (seAcabaDePublicar) {
        await this.notificarPublicacion(v.version, v.notas, v.apk_url);
      }
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async togglePublicada(v: AppVersion) {
    const publicando = !v.publicada;
    try {
      await this.service.setPublicada(v.id, publicando);
      await this.load();
      this.toast.success(publicando ? 'Versión publicada' : 'Versión despublicada', `v${v.version}`);
      if (publicando) {
        await this.notificarPublicacion(v.version, v.notas, v.apk_url);
      }
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    }
  }

  /** V4 — Avisa a todos (in-app + correo) y refleja el resultado en un toast. */
  private async notificarPublicacion(version: string, notas: string | null, apkUrl: string | null) {
    try {
      await this.service.notificarPublicacion(version, notas, apkUrl);
      this.toast.info('Usuarios notificados', `Se avisó a todos de la versión ${version}.`);
    } catch (e: unknown) {
      // No revertimos la publicación por un fallo de notificación.
      this.toast.error(
        'Publicado, pero sin avisar',
        e instanceof Error ? e.message : 'No se pudo notificar a los usuarios.',
      );
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
