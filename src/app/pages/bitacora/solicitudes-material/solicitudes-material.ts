import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SolicitudesMaterialService } from '../../../../shared/services/solicitudes-material.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { UserService } from '../../../core/services/user.service';
import { SolicitudMaterial } from '../../../../shared/models/solicitud.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { HighlightItemDirective } from '../../../../shared/directives/highlight-item.directive';
import { QtyStepper } from '../../../../shared/ui/qty-stepper/qty-stepper';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

/**
 * Renglón de la requisición. Si articulo_id está vacío → es un "Otro" (texto
 * libre) que alimenta la inteligencia de otros_valores (U25).
 */
interface ItemRow {
  articulo_id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  talla: string | null;
}

const ESTADO_BADGE: Record<string, string> = {
  pendiente: 'warning',
  aprobada: 'info',
  entregada: 'success',
  cerrada: 'success',
  rechazada: 'danger',
};

// A2: "aprobada" = despachada en parte y con compra pendiente por el faltante.
const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada (en compra)',
  entregada: 'Entregada',
  cerrada: 'Cerrada',
  rechazada: 'Rechazada',
};

const NUEVO_ITEM: () => ItemRow = () => ({
  articulo_id: '',
  descripcion: '',
  cantidad: 1,
  unidad: '',
  talla: null,
});

@Component({
  selector: 'app-bitacora-solicitudes-material',
  imports: [ReactiveFormsModule, RouterLink, FormDrawer, Skeleton, QtyStepper, HighlightItemDirective],
  templateUrl: './solicitudes-material.html',
  styleUrl: './solicitudes-material.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolicitudesMaterial implements OnInit {
  private solicitudesService = inject(SolicitudesMaterialService);
  private proyectosService = inject(ProyectosService);
  private articulosService = inject(ArticulosService);
  private categoriasService = inject(CategoriasService);
  private userService = inject(UserService);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;
  estadoBadge = (estado: string) => ESTADO_BADGE[estado] ?? 'neutral';
  estadoLabel = (estado: string) => ESTADO_LABEL[estado] ?? estado;

  solicitudes = signal<SolicitudMaterial[]>([]);
  proyectos = signal<Proyecto[]>([]);
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  drawerOpen = signal(false);
  /** Paso del wizard (patrón hojas): 'form' → 'resumen'. */
  step = signal<'form' | 'resumen'>('form');
  formItems = signal<ItemRow[]>([NUEVO_ITEM()]);

  form = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    urgencia: new FormControl<'normal' | 'urgente'>('normal', [Validators.required]),
    notas: new FormControl<string | null>(null),
  });

  activeProyectos = computed(() => this.proyectos().filter((p) => p.activo));

  /** Artículos agrupados por categoría (orden oficial), para el <select> (V13/V14). */
  articulosAgrupados = computed<{ categoria: string; articulos: Articulo[] }[]>(() => {
    const arts = this.articulos();
    const cats = this.categorias();
    const byCat = new Map<number, Articulo[]>();
    for (const a of arts) {
      const list = byCat.get(a.categoria_id);
      if (list) list.push(a);
      else byCat.set(a.categoria_id, [a]);
    }
    const grupos: { categoria: string; articulos: Articulo[] }[] = [];
    const catIds = new Set<number>();
    for (const c of cats) {
      catIds.add(c.id);
      const list = byCat.get(c.id);
      if (list && list.length) grupos.push({ categoria: c.nombre, articulos: list });
    }
    const otros = arts.filter((a) => !catIds.has(a.categoria_id));
    if (otros.length) grupos.push({ categoria: 'Otros', articulos: otros });
    return grupos;
  });

  drawerTitle = computed(() => (this.step() === 'resumen' ? 'Revisar requisición' : 'Nueva requisición'));

  proyectoNombre = computed(() => {
    const id = this.form.controls.proyecto_id.value;
    return this.proyectos().find((p) => p.id === id)?.nombre ?? '—';
  });

  /** Renglones válidos resueltos para la hoja de resumen (conserva el índice). */
  resumenItems = computed(() => {
    const arts = this.articulos();
    const catName = new Map(this.categorias().map((c) => [c.id, c.nombre] as const));
    return this.formItems()
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => (it.articulo_id || it.descripcion.trim()) && it.cantidad > 0)
      .map(({ it, index }) => {
        const a = it.articulo_id ? arts.find((x) => x.id === it.articulo_id) : undefined;
        return {
          index,
          nombre: a?.nombre ?? it.descripcion,
          codigo: a?.codigo ?? '',
          categoria: a ? (catName.get(a.categoria_id) ?? 'Otros') : 'Otro (texto libre)',
          cantidad: it.cantidad,
          unidad: a?.unidad ?? it.unidad,
          talla: it.talla,
          esOtro: !it.articulo_id,
        };
      });
  });

  resumenValido = computed(() => this.resumenItems().length > 0);

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [solicitudes, proyectos, articulos, categorias] = await Promise.all([
        this.solicitudesService.getAll(),
        this.proyectosService.getAll(),
        this.articulosService.getAll(),
        this.categoriasService.getAll(),
      ]);
      this.solicitudes.set(solicitudes);
      this.proyectos.set(proyectos);
      this.articulos.set(articulos.filter((a) => a.activo));
      this.categorias.set(categorias);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las requisiciones.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Artículo helpers ──────────────────────────────────────
  private articuloById(id: string): Articulo | undefined {
    return id ? this.articulos().find((a) => a.id === id) : undefined;
  }
  itemRequiereTalla(articuloId: string): boolean {
    return this.articuloById(articuloId)?.requiere_talla ?? false;
  }
  itemNota(articuloId: string): string | null {
    return this.articuloById(articuloId)?.nota ?? null;
  }

  openCreate() {
    this.saveError.set('');
    this.step.set('form');
    this.form.reset({ urgencia: 'normal' });
    this.formItems.set([NUEVO_ITEM()]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, NUEVO_ITEM()]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  /** Cambia el artículo del renglón; al elegir "Otro" (id vacío) se limpia talla. */
  updateItemArticulo(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => {
        if (i !== index) return item;
        const a = value ? this.articuloById(value) : undefined;
        return {
          ...item,
          articulo_id: value,
          unidad: a?.unidad ?? item.unidad,
          talla: null,
          // Si vuelve a catálogo, la descripción libre deja de aplicar.
          descripcion: value ? '' : item.descripcion,
        };
      }),
    );
  }

  updateItemCantidad(index: number, value: number | string) {
    const cantidad = Number(value);
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad } : item)),
    );
  }

  updateItem(index: number, field: 'descripcion' | 'unidad' | 'talla', value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  /** Submit: 'form' valida y pasa a resumen; 'resumen' confirma y envía. */
  async onSave() {
    if (this.step() === 'resumen') {
      await this.confirmar();
      return;
    }
    this.irAResumen();
  }

  irAResumen() {
    this.form.markAllAsTouched();
    const items = this.validItems();
    if (this.form.invalid) return;
    if (items.length === 0) {
      this.saveError.set('Agrega al menos un artículo (del catálogo o como "Otro").');
      return;
    }
    // Talla obligatoria para EPP que la requiere.
    const sinTalla = items.filter(
      (i) => i.articulo_id && this.itemRequiereTalla(i.articulo_id) && !(i.talla ?? '').trim(),
    );
    if (sinTalla.length > 0) {
      const nombres = sinTalla.map((i) => this.articuloById(i.articulo_id)?.nombre ?? 'artículo').join(', ');
      this.saveError.set(`Indica la talla para: ${nombres}.`);
      return;
    }
    this.saveError.set('');
    this.step.set('resumen');
  }

  volverAForm() {
    this.saveError.set('');
    this.step.set('form');
  }

  private validItems(): ItemRow[] {
    return this.formItems().filter((i) => (i.articulo_id || i.descripcion.trim()) && i.cantidad > 0);
  }

  private async confirmar() {
    const items = this.validItems();
    if (this.form.invalid || this.saving() || items.length === 0) return;

    this.saving.set(true);
    this.saveError.set('');

    try {
      const solicitanteId = this.userService.profile()?.id;
      if (!solicitanteId) throw new Error('Sesión inválida.');

      const v = this.form.value;
      const created = await this.solicitudesService.create({
        proyecto_id: v.proyecto_id!,
        solicitante_id: solicitanteId,
        urgencia: v.urgencia!,
        notas: v.notas ?? null,
        items: items.map((i) => {
          const a = i.articulo_id ? this.articuloById(i.articulo_id) : undefined;
          return {
            articulo_id: i.articulo_id || null,
            descripcion: a?.nombre ?? i.descripcion,
            cantidad: i.cantidad,
            unidad: (a?.unidad ?? i.unidad) || null,
            talla: (i.talla ?? '').trim() || null,
          };
        }),
      });

      // U25 — registrar los "Otros" (texto libre) para la inteligencia de otros_valores.
      for (const i of items) {
        if (!i.articulo_id && i.descripcion.trim()) {
          this.solicitudesService.registrarOtro(i.descripcion, created.id);
        }
      }

      this.solicitudes.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
      this.step.set('form');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
