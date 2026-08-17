import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  InventarioAlmacenService,
  InventarioAlmacenItem,
} from '../../../../shared/services/inventario-almacen.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { KardexModal } from '../kardex-modal/kardex-modal';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../../shared/ui/articulo-picker/articulo-picker';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';

/**
 * AP2 — Inventario de un almacén específico: lista de artículos con existencias,
 * buscador y filtro por categoría. Cada artículo tiene botón "Histórico" (kardex,
 * AP3) y, para admin, edición del dato de apertura (AP5) desde aquí (accesible
 * desde el listado de almacenes y desde la vista del proyecto).
 */
@Component({
  selector: 'app-almacen-inventario',
  imports: [DecimalPipe, RouterLink, KardexModal, FormDrawer, ArticuloPicker],
  templateUrl: './almacen-inventario.html',
  styleUrl: './almacen-inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlmacenInventario implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(InventarioAlmacenService);
  private bodegasService = inject(BodegasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private articulosService = inject(ArticulosService);
  private categoriasService = inject(CategoriasService);

  esAdmin = computed(() => this.userService.hasRole('admin'));
  // AS11 — quién edita stock/agrega artículos: admin o módulo inventario.
  puedeEditar = computed(() => this.esAdmin() || this.userService.hasModulo('inventario'));

  bodegaId = signal<string>('');
  bodegaNombre = signal<string>('');
  bodegaProyecto = signal<string | null>(null);
  items = signal<InventarioAlmacenItem[]>([]);
  loading = signal(true);
  error = signal('');

  search = signal('');
  categoria = signal<string>('');
  incluirCero = signal(true);

  // Kardex modal
  kardexArticulo = signal<{ id: string; nombre: string } | null>(null);

  categorias = computed(() => {
    const s = new Set<string>();
    for (const i of this.items()) if (i.categoria) s.add(i.categoria);
    return [...s].sort((a, b) => a.localeCompare(b));
  });

  filtrados = computed(() => {
    const q = this.search().toLowerCase().trim();
    const cat = this.categoria();
    const cero = this.incluirCero();
    return this.items().filter((i) => {
      if (!cero && i.es_cero) return false;
      if (cat && i.categoria !== cat) return false;
      if (q && !(i.nombre.toLowerCase().includes(q) || (i.codigo ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  });

  totalArticulos = computed(() => this.filtrados().length);

  async ngOnInit() {
    // Modo directo (almacen/:id) o por obra (almacen/obra/:proyectoId → su almacén).
    let id = this.route.snapshot.paramMap.get('id') ?? '';
    const proyectoId = this.route.snapshot.paramMap.get('proyectoId');
    if (!id && proyectoId) {
      try {
        const bodegas = await this.bodegasService.getAll();
        const deObra = bodegas.filter(
          (b) => (b as { proyecto_id?: string | null }).proyecto_id === proyectoId,
        );
        const elegida = deObra.find((b) => b.activo !== false) ?? deObra[0];
        if (elegida) id = elegida.id;
        else {
          this.error.set('Esta obra no tiene un almacén asignado.');
          this.loading.set(false);
          return;
        }
      } catch (e: unknown) {
        this.error.set(e instanceof Error ? e.message : 'No se pudo resolver el almacén de la obra.');
        this.loading.set(false);
        return;
      }
    }
    this.bodegaId.set(id);
    await this.load(id);
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [bodega, items] = await Promise.all([
        this.bodegasService.getById(id).catch(() => null),
        this.service.getInventario(id, true),
      ]);
      if (bodega) {
        this.bodegaNombre.set(bodega.nombre);
        this.bodegaProyecto.set((bodega as { proyecto_id?: string | null }).proyecto_id ?? null);
      }
      this.items.set(items);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el inventario.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(v: string) { this.search.set(v); }
  onCategoria(v: string) { this.categoria.set(v); }
  toggleCero() { this.incluirCero.update((v) => !v); }

  abrirKardex(i: InventarioAlmacenItem) {
    this.kardexArticulo.set({ id: i.articulo_id, nombre: i.nombre });
  }
  cerrarKardex() { this.kardexArticulo.set(null); }

  /** AS11 — ajustar stock de un artículo (conteo/ajuste, deja traza). */
  async ajustar(i: InventarioAlmacenItem) {
    if (!this.puedeEditar()) return;
    const actual = i.cantidad ?? 0;
    const entrada = window.prompt(
      `Ajustar existencia de "${i.nombre}" en este almacén.\n` +
        `Se registra como ajuste en "Conteos y ajustes" (con traza), a diferencia de la apertura.`,
      String(actual),
    );
    if (entrada == null) return;
    const nueva = Number(entrada);
    if (Number.isNaN(nueva) || nueva < 0) {
      this.toast.error('Cantidad inválida.');
      return;
    }
    if (nueva === actual) return;
    try {
      await this.service.ajustarStock(i.articulo_id, this.bodegaId(), nueva);
      this.toast.success('Existencia ajustada.', 'Se registró en Conteos y ajustes.');
      await this.load(this.bodegaId());
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo ajustar la existencia.');
    }
  }

  // ── AS11 — agregar un artículo del catálogo a este almacén ──
  addOpen = signal(false);
  catalogo = signal<Articulo[]>([]);
  categoriasCatalogo = signal<Categoria[]>([]);
  addArticuloId = signal<string | null>(null);
  addCantidad = signal<number | null>(null);
  addSaving = signal(false);
  addError = signal('');

  async abrirAgregar() {
    if (!this.puedeEditar()) return;
    this.addArticuloId.set(null);
    this.addCantidad.set(null);
    this.addError.set('');
    this.addOpen.set(true);
    if (this.catalogo().length === 0) {
      try {
        const [arts, cats] = await Promise.all([
          this.articulosService.getAll(),
          this.categoriasService.getAll(),
        ]);
        this.catalogo.set(arts);
        this.categoriasCatalogo.set(cats);
      } catch {
        /* el catálogo se puede reintentar */
      }
    }
  }
  cerrarAgregar() {
    if (!this.addSaving()) this.addOpen.set(false);
  }
  onAddArticulo(sel: ArticuloPickerSelection) {
    this.addArticuloId.set(sel.articuloId);
  }
  async guardarAgregar() {
    if (this.addSaving()) return;
    const artId = this.addArticuloId();
    const cant = Number(this.addCantidad());
    if (!artId) {
      this.addError.set('Selecciona un artículo del catálogo.');
      return;
    }
    if (!Number.isFinite(cant) || cant < 0) {
      this.addError.set('Indica una cantidad válida.');
      return;
    }
    this.addSaving.set(true);
    this.addError.set('');
    try {
      await this.service.ajustarStock(artId, this.bodegaId(), cant, 'Alta de artículo en el almacén');
      this.addOpen.set(false);
      this.toast.success('Artículo agregado al almacén.');
      await this.load(this.bodegaId());
    } catch (e: unknown) {
      this.addError.set(e instanceof Error ? e.message : 'No se pudo agregar el artículo.');
    } finally {
      this.addSaving.set(false);
    }
  }

  /** AP5 — editar apertura (solo admin). */
  async editarApertura(i: InventarioAlmacenItem) {
    if (!this.esAdmin()) return;
    const actual = i.apertura ?? 0;
    const entrada = window.prompt(
      `Dato de apertura de "${i.nombre}" en este almacén.\n` +
        `Al cambiarlo, la existencia se re-basa a (apertura + movimientos) SIN generar movimiento ni afectar el kardex.`,
      String(actual),
    );
    if (entrada == null) return;
    const nueva = Number(entrada);
    if (Number.isNaN(nueva) || nueva < 0) {
      this.toast.error('Cantidad inválida.');
      return;
    }
    if (nueva === actual) return;
    try {
      await this.service.setApertura(i.articulo_id, this.bodegaId(), nueva);
      this.toast.success('Apertura actualizada.');
      await this.load(this.bodegaId());
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar la apertura.');
    }
  }
}
