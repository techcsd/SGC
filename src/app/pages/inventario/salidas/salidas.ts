import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { SolicitudesMaterialService } from '../../../../shared/services/solicitudes-material.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { SalidaInventario, SalidaItemFormData, MOTIVOS_SALIDA, SALIDA_ESTADO_LABELS } from '../../../../shared/models/salida.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { SolicitudMaterial } from '../../../../shared/models/solicitud.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-salidas',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, RouterLink],
  templateUrl: './salidas.html',
  styleUrl: './salidas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Salidas implements OnInit {
  private salidasService = inject(SalidasService);
  private articulosService = inject(ArticulosService);
  private bodegasService = inject(BodegasService);
  private proyectosService = inject(ProyectosService);
  private solicitudesMaterialService = inject(SolicitudesMaterialService);
  private toast = inject(ToastService);
  private userService = inject(UserService);

  // ── Data state ──────────────────────────────────────────
  salidas = signal<SalidaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  bodegas = signal<Bodega[]>([]);
  proyectos = signal<Proyecto[]>([]);
  solicitudesPendientes = signal<SolicitudMaterial[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Solicitud being attended (set when "Crear salida" is triggered from a solicitud) ──
  solicitudEnAtencion = signal<SolicitudMaterial | null>(null);

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedBodega = signal<string>('');
  selectedMotivo = signal<string>('');
  dateFrom = signal<string>('');
  dateTo = signal<string>('');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  formItems = signal<SalidaItemFormData[]>([{ articulo_id: '', cantidad: 1 }]);

  // A2 — al aprobar una requisición, el aprobador MAPEA cada renglón (texto libre del
  // ingeniero) a un artículo del catálogo. Mapeado -> puede despacharse de stock; sin
  // mapear -> va 100% a la solicitud de compra automática.
  reqItems = signal<{ descripcion: string; unidad: string | null; articulo_id: string | null; cantidad: number }[]>([]);

  readonly MOTIVOS_SALIDA = MOTIVOS_SALIDA;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;

  formatFecha = formatFechaDisplay;
  readonly today = todayIso();

  form = new FormGroup({
    bodega_id: new FormControl<string | null>(null, [Validators.required]),
    proyecto_id: new FormControl<string | null>(null),
    motivo: new FormControl<string | null>(null, [Validators.required]),
    fecha: new FormControl<string>(this.today, [Validators.required]),
    responsable: new FormControl<string | null>(null),
    observaciones: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  activeProyectos = computed(() => this.proyectos().filter((p) => p.activo));

  /** True cuando el drawer está aprobando una requisición (auto-división), no una salida manual. */
  atendiendoRequisicion = computed(() => !!this.solicitudEnAtencion());
  drawerTitle = computed(() => (this.atendiendoRequisicion() ? 'Aprobar requisición' : 'Registrar salida'));

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const bodega = this.selectedBodega();
    const motivo = this.selectedMotivo();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.salidas().filter((s) => {
      if (
        q &&
        !(s.responsable ?? '').toLowerCase().includes(q) &&
        !(s.proyecto?.nombre ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (bodega && s.bodega_id !== bodega) return false;
      if (motivo && s.motivo !== motivo) return false;
      if (from && s.fecha < from) return false;
      if (to && s.fecha > to) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  // FormControl.value isn't a signal — bridge valueChanges so this actually
  // recomputes when the user picks a motivo (a plain computed() never re-ran).
  private motivoValue = toSignal(this.form.controls.motivo.valueChanges, {
    initialValue: this.form.controls.motivo.value,
  });
  showProyectoField = computed(() => this.motivoValue() === 'uso_proyecto');

  hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedBodega() ||
      !!this.selectedMotivo() ||
      !!this.dateFrom() ||
      !!this.dateTo(),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [salidas, arts, bods, proyectos, solicitudes] = await Promise.all([
        this.salidasService.getAll(),
        this.articulosService.getAll(),
        this.bodegasService.getAll(),
        this.proyectosService.getAll(),
        this.solicitudesMaterialService.getAll(),
      ]);
      this.salidas.set(salidas);
      this.articulos.set(arts);
      this.bodegas.set(bods);
      this.proyectos.set(proyectos);
      this.solicitudesPendientes.set(solicitudes.filter((s) => s.estado === 'pendiente'));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los datos.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  onBodegaChange(value: string) {
    this.selectedBodega.set(value);
    this.currentPage.set(1);
  }

  onMotivoChange(value: string) {
    this.selectedMotivo.set(value);
    this.currentPage.set(1);
  }

  onDateFromChange(value: string) {
    this.dateFrom.set(value);
    this.currentPage.set(1);
  }

  onDateToChange(value: string) {
    this.dateTo.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedBodega.set('');
    this.selectedMotivo.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.currentPage.set(1);
  }

  // ── Pagination ───────────────────────────────────────────
  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  get pages(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
      range.push(i);
    }
    return range;
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.solicitudEnAtencion.set(null);
    this.form.reset({ fecha: this.today });
    this.formItems.set([{ articulo_id: '', cantidad: 1 }]);
    this.drawerOpen.set(true);
  }

  /** Opens the approval drawer for a pending requisición, auto-matching each line to the catalog. */
  atenderSolicitud(s: SolicitudMaterial) {
    this.saveError.set('');
    this.solicitudEnAtencion.set(s);
    const arts = this.articulos();
    const norm = (t: string) => t.toLowerCase().trim();
    this.reqItems.set(
      (s.items ?? []).map((i) => {
        const d = norm(i.descripcion);
        // auto-match por nombre o código exacto; si no, queda sin mapear (irá a compra).
        const match = arts.find((a) => norm(a.nombre) === d || norm(a.codigo) === d);
        return { descripcion: i.descripcion, unidad: i.unidad, articulo_id: match?.id ?? null, cantidad: i.cantidad };
      }),
    );
    this.form.reset({
      fecha: this.today,
      motivo: 'uso_proyecto',
      proyecto_id: s.proyecto_id,
      observaciones: s.notas ?? null,
    });
    this.drawerOpen.set(true);
  }

  updateReqItemArticulo(index: number, value: string) {
    this.reqItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, articulo_id: value || null } : it)),
    );
  }

  updateReqItemCantidad(index: number, value: string) {
    this.reqItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, cantidad: Number(value) } : it)),
    );
  }

  async rechazarSolicitud(s: SolicitudMaterial) {
    try {
      await this.solicitudesMaterialService.rechazar(s.id);
      this.solicitudesPendientes.update((list) => list.filter((x) => x.id !== s.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al rechazar la solicitud.');
    }
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { articulo_id: '', cantidad: 1 }]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateItemArticulo(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, articulo_id: value } : item)),
    );
  }

  updateItemCantidad(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad: Number(value) } : item)),
    );
  }

  async onSave() {
    const solicitud = this.solicitudEnAtencion();
    // A2 — Aprobación de requisición: el sistema divide (despacho + compra automática).
    // Enviamos los renglones ORIGINALES de la requisición (incluye los de texto libre
    // sin artículo, que van 100% a compra) — no los del editor de salida manual.
    if (solicitud) {
      await this.aprobarRequisicion(solicitud);
      return;
    }

    this.form.markAllAsTouched();
    const items = this.formItems().filter((i) => i.articulo_id && i.cantidad > 0);
    if (this.form.invalid || this.saving() || items.length === 0) return;

    const articuloIds = items.map((i) => i.articulo_id);
    if (new Set(articuloIds).size !== articuloIds.length) {
      this.saveError.set('No puedes agregar el mismo artículo más de una vez. Combina las cantidades en una sola línea.');
      return;
    }

    const v = this.form.value;

    if (v.motivo === 'uso_proyecto' && !v.proyecto_id) {
      this.saveError.set('Selecciona el proyecto para una salida por uso en proyecto.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const userId = this.userService.profile()?.id ?? null;
      const created = await this.salidasService.create(
        {
          bodega_id: v.bodega_id!,
          proyecto_id: v.motivo === 'uso_proyecto' ? (v.proyecto_id ?? null) : null,
          motivo: v.motivo!,
          fecha: v.fecha!,
          responsable: v.responsable ?? null,
          observaciones: v.observaciones ?? null,
          conductor_id: null,
          vehiculo_id: null,
          items,
        },
        userId,
      );
      this.salidas.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  /** A2 — Aprueba una requisición con auto-división (despacho en stock + compra del faltante). */
  private async aprobarRequisicion(solicitud: SolicitudMaterial) {
    this.form.markAllAsTouched();
    if (!this.form.controls.bodega_id.value) {
      this.saveError.set('Selecciona el almacén desde el que se despachará.');
      return;
    }
    if (this.saving()) return;

    const reqItems = this.reqItems().filter((i) => i.cantidad > 0);
    if (reqItems.length === 0) {
      this.saveError.set('La requisición no tiene renglones válidos.');
      return;
    }
    // Un mismo artículo mapeado no puede repetirse (el despacho fallaría al sumar stock).
    const mapped = reqItems.map((i) => i.articulo_id).filter((x): x is string => !!x);
    if (new Set(mapped).size !== mapped.length) {
      this.saveError.set('Un mismo artículo está mapeado en más de un renglón. Combínalos en uno solo.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    try {
      const v = this.form.value;
      const res = await this.solicitudesMaterialService.aprobarRequisicion(solicitud.id, {
        bodega_id: v.bodega_id!,
        fecha: v.fecha!,
        responsable: v.responsable ?? null,
        observaciones: v.observaciones ?? null,
        items: reqItems,
      });

      // La RPC es atómica y ya hizo commit: a partir de aquí es ÉXITO. Cerramos
      // y avisamos ANTES de leer nada más, para que un fallo de lectura posterior
      // no se muestre como "error al aprobar" (y no deje reintentar algo ya hecho).
      this.solicitudesPendientes.update((list) => list.filter((x) => x.id !== solicitud.id));
      this.drawerOpen.set(false);

      // Resumen de la división para el aprobador.
      if (res.faltante_total > 0 && res.despachado_total > 0) {
        this.toast.success(
          'Requisición aprobada',
          `Se despachó lo disponible (${res.despachado_total}) y se generó una solicitud de compra por el faltante (${res.faltante_total}) en Compras.`,
        );
      } else if (res.faltante_total > 0) {
        this.toast.warning(
          'Requisición aprobada — sin stock',
          `No había stock disponible. Se generó una solicitud de compra por ${res.faltante_total} en el módulo Compras.`,
        );
      } else {
        this.toast.success('Requisición aprobada', 'Se despachó completa desde el almacén. Genera el conduce para la entrega.');
      }

      // Refrescar la lista de salidas es secundario; si falla, se repone al recargar.
      if (res.salida_id) {
        try {
          const created = await this.salidasService.getById(res.salida_id);
          this.salidas.update((list) => [created, ...list]);
        } catch {
          /* la salida sí se creó; la lista se actualizará en la próxima carga */
        }
      }
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al aprobar la requisición.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getMotivoLabel(motivo: string): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  getMotivoModifier(motivo: string): string {
    const map: Record<string, string> = {
      uso_proyecto: 'info',
      venta: 'success',
      merma: 'danger',
      devolucion: 'warning',
      ajuste: 'neutral',
      otro: 'neutral',
    };
    return map[motivo] ?? 'neutral';
  }

  get f() {
    return this.form.controls;
  }
}
