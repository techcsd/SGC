import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FlotaIncidenciasService } from '../../../../shared/services/flota-incidencias.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { VehiculoAccidente, ACCIDENTE_FASES, AccidenteFase } from '../../../../shared/models/flota-incidencias.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { Paginator } from '../../../../shared/ui/paginator/paginator';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';

/**
 * S22 — Submódulo "Accidentes": los formularios de choque completos (no solo el
 * acta AMET) en una lista con detalle. En el perfil del vehículo solo se ven los
 * que tienen acta AMET; aquí se ven todos.
 */
@Component({
  selector: 'app-flota-accidentes',
  imports: [FormDrawer, Skeleton, ReactiveFormsModule, Paginator, Lightbox],
  templateUrl: './accidentes.html',
  styleUrl: './accidentes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Accidentes implements OnInit {
  private incidencias = inject(FlotaIncidenciasService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private datosPrueba = inject(DatosPruebaService);
  formatFecha = formatFechaDisplay;
  readonly FASES = ACCIDENTE_FASES;
  readonly today = todayIso();

  loading = signal(true);
  error = signal('');
  accidentes = signal<VehiculoAccidente[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);

  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  mostrarPrueba = this.datosPruebaViewSvc.ver;
  /** Lista visible: no-admin nunca ve prueba (RLS); admin las oculta salvo toggle. */
  visibles = computed(() => {
    const verPrueba = this.esAdmin() && this.mostrarPrueba();
    return this.accidentes().filter((a) => verPrueba || !a.es_prueba);
  });

  page = signal(1);
  readonly PAGE_SIZE = 20;
  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.visibles().slice(start, start + this.PAGE_SIZE);
  });

  detailOpen = signal(false);
  detail = signal<VehiculoAccidente | null>(null);
  ametUrl = signal<string | null>(null);
  // X3 — fotos del hecho en el detalle (thumbnails) + lightbox in-page.
  fotoThumbs = signal<Record<string, string>>({});
  lightboxUrl = signal<string | null>(null);

  // ── T12: registrar accidente desde la web ──
  createOpen = signal(false);
  saving = signal(false);
  saveError = signal('');
  ametFile = signal<File | null>(null);
  // X3 — fotos del hecho a adjuntar (previews antes de guardar).
  fotoFiles = signal<File[]>([]);
  fotoPreviews = signal<string[]>([]);

  async onFotosSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      const comp = await comprimirImagen(file);
      this.fotoFiles.update((l) => [...l, comp]);
      this.fotoPreviews.update((l) => [...l, URL.createObjectURL(comp)]);
    }
  }
  quitarFoto(i: number) {
    const prev = this.fotoPreviews()[i];
    if (prev) URL.revokeObjectURL(prev);
    this.fotoFiles.update((l) => l.filter((_, idx) => idx !== i));
    this.fotoPreviews.update((l) => l.filter((_, idx) => idx !== i));
  }
  private limpiarFotos() {
    for (const p of this.fotoPreviews()) URL.revokeObjectURL(p);
    this.fotoFiles.set([]);
    this.fotoPreviews.set([]);
  }

  /** X3 — thumbnail (cache W9) de una foto del hecho para el detalle. */
  fotoThumb(path: string): string | null {
    return this.fotoThumbs()[path] ?? null;
  }
  /** X3 — abre una foto/acta en grande dentro de la página (nunca nueva pestaña). */
  async abrirLightbox(path: string) {
    const url = await this.incidencias.signedUrl(path);
    if (url) this.lightboxUrl.set(url);
  }

  form = new FormGroup({
    vehiculo_id: new FormControl<string>('', [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    fecha: new FormControl<string>(this.today, [Validators.required]),
    fase: new FormControl<AccidenteFase>('en_el_momento', [Validators.required]),
    lesionados: new FormControl<number>(0, [Validators.min(0)]),
    tercero_involucrado: new FormControl<string | null>(null),
    descripcion: new FormControl<string | null>(null),
  });

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [accidentes, vehiculos, conductores] = await Promise.all([
        this.incidencias.accidentesTodos(),
        this.vehiculosService.getAll(),
        this.conductoresService.getAll(),
      ]);
      this.accidentes.set(accidentes);
      this.vehiculos.set(vehiculos);
      this.conductores.set(conductores);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los accidentes.');
    } finally {
      this.loading.set(false);
    }
  }

  faseLabel(f: string): string {
    return ACCIDENTE_FASES.find((x) => x.value === f)?.label ?? f;
  }

  openCreate() {
    this.saveError.set('');
    this.ametFile.set(null);
    this.limpiarFotos();
    this.form.reset({ fecha: this.today, fase: 'en_el_momento', lesionados: 0, vehiculo_id: '', conductor_id: null });
    this.createOpen.set(true);
  }
  closeCreate() {
    this.createOpen.set(false);
  }
  onAmetSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.ametFile.set(input.files?.[0] ?? null);
  }

  async guardarAccidente() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.saveError.set('');
    try {
      const v = this.form.getRawValue();
      const userId = this.userService.profile()?.id ?? '';
      const creado = await this.incidencias.crearAccidente(
        {
          vehiculo_id: v.vehiculo_id!,
          conductor_id: v.conductor_id || null,
          fecha: v.fecha!,
          fase: v.fase!,
          descripcion: v.descripcion?.trim() || null,
          lesionados: Number(v.lesionados) || 0,
          tercero_involucrado: v.tercero_involucrado?.trim() || null,
        },
        userId,
        this.ametFile(),
        this.fotoFiles(),
      );
      this.accidentes.update((list) => [creado, ...list]);
      this.createOpen.set(false);
      this.limpiarFotos();
      this.toast.success('Accidente registrado', 'El reporte se guardó correctamente.');
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar el accidente.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }

  /** El acta puede ser PDF; en ese caso no se hace thumbnail ni lightbox de imagen. */
  esPdf(path: string | null | undefined): boolean {
    return !!path && /\.pdf$/i.test(path);
  }

  async openDetail(a: VehiculoAccidente) {
    this.detail.set(a);
    this.ametUrl.set(null);
    this.fotoThumbs.set({});
    this.detailOpen.set(true);
    if (a.reporte_amet_path) {
      // PDF → URL directa (sin transform); imagen → thumbnail cacheado.
      this.ametUrl.set(
        this.esPdf(a.reporte_amet_path)
          ? await this.incidencias.signedUrl(a.reporte_amet_path)
          : await this.incidencias.signedUrl(a.reporte_amet_path, { width: 200, quality: 75 }),
      );
    }
    // X3 — resolver thumbnails de las fotos del hecho (cache W9).
    for (const path of a.fotos ?? []) {
      this.incidencias.signedUrl(path, { width: 200, quality: 75 }).then((url) => {
        if (url) this.fotoThumbs.update((m) => ({ ...m, [path]: url }));
      });
    }
  }

  closeDetail() {
    this.detailOpen.set(false);
    this.detail.set(null);
  }

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca o desmarca el accidente como dato de prueba. */
  async marcarPrueba(a: VehiculoAccidente, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar('vehiculo_accidentes', a.id, valor);
      this.accidentes.update((list) =>
        list.map((x) => (x.id === a.id ? { ...x, es_prueba: valor } : x)),
      );
      if (this.detail()?.id === a.id) this.detail.update((d) => (d ? { ...d, es_prueba: valor } : d));
      this.toast.success(
        valor ? 'Marcado como prueba' : 'Quitado de prueba',
        valor ? 'El accidente se ocultará del listado.' : 'El accidente vuelve al listado.',
      );
    } catch (e: unknown) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }

  /** Elimina definitivamente un accidente marcado como prueba. */
  async eliminarPrueba(a: VehiculoAccidente) {
    if (!this.esAdmin() || !a.es_prueba) return;
    if (!confirm('¿Eliminar este dato de prueba? Esta acción no se puede deshacer.')) return;
    try {
      await this.datosPrueba.eliminar('vehiculo_accidentes', a.id);
      this.accidentes.update((list) => list.filter((x) => x.id !== a.id));
      this.closeDetail();
      this.toast.success('Dato de prueba eliminado', 'El accidente se eliminó definitivamente.');
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }
}
