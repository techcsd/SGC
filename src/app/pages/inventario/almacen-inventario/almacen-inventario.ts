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

/** AU1 · P1 — los tres mecanismos que fijan/mueven stock, unificados en un solo modal. */
type AjusteMecanismo = 'conteo' | 'apertura' | 'ajuste_real';

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

  // ── AU1 · P1 — "Ajustar existencia": UN solo punto de entrada con selector de
  //    mecanismo (conteo/ajuste · apertura · ajuste real) + motivo auditado, en vez
  //    de tres prompts sueltos que exponían tres semánticas sobre el mismo stock.
  ajusteItem = signal<InventarioAlmacenItem | null>(null);
  ajusteMecanismo = signal<AjusteMecanismo>('conteo');
  ajusteValor = signal<number | null>(null);
  ajusteMotivo = signal('');
  ajusteSaving = signal(false);
  ajusteError = signal('');

  /** Mecanismos disponibles según el rol (apertura/ajuste real son solo-admin). */
  mecanismosDisponibles = computed<AjusteMecanismo[]>(() =>
    this.esAdmin() ? ['conteo', 'apertura', 'ajuste_real'] : ['conteo'],
  );

  abrirAjusteExistencia(i: InventarioAlmacenItem) {
    if (!this.puedeEditar()) return;
    this.ajusteItem.set(i);
    this.ajusteMecanismo.set('conteo');
    this.ajusteValor.set(i.cantidad ?? 0);
    this.ajusteMotivo.set('');
    this.ajusteError.set('');
  }

  cerrarAjusteExistencia() {
    if (!this.ajusteSaving()) this.ajusteItem.set(null);
  }

  /** Al cambiar de mecanismo, precargar el valor de referencia (apertura vs existencia). */
  onMecanismoChange(m: AjusteMecanismo) {
    const i = this.ajusteItem();
    if (!i) return;
    this.ajusteMecanismo.set(m);
    this.ajusteValor.set(m === 'apertura' ? (i.apertura ?? 0) : (i.cantidad ?? 0));
  }

  async guardarAjusteExistencia() {
    if (this.ajusteSaving()) return;
    const i = this.ajusteItem();
    if (!i) return;
    const mecanismo = this.ajusteMecanismo();
    const valor = Number(this.ajusteValor());
    const motivo = this.ajusteMotivo().trim();
    if (!Number.isFinite(valor) || valor < 0) {
      this.ajusteError.set('Indica un valor válido (mayor o igual a 0).');
      return;
    }
    if (!motivo) {
      this.ajusteError.set('El motivo es obligatorio (queda en la auditoría).');
      return;
    }
    if ((mecanismo === 'apertura' || mecanismo === 'ajuste_real') && !this.esAdmin()) {
      this.ajusteError.set('Ese mecanismo es solo para administradores.');
      return;
    }
    this.ajusteSaving.set(true);
    this.ajusteError.set('');
    try {
      const art = i.articulo_id;
      const bod = this.bodegaId();
      if (mecanismo === 'conteo') {
        await this.service.ajustarStock(art, bod, valor, motivo);
        this.toast.success('Existencia ajustada.', 'Se registró en Conteos y ajustes.');
      } else if (mecanismo === 'apertura') {
        await this.service.setApertura(art, bod, valor, motivo);
        this.toast.success('Apertura actualizada.', 'Sin movimiento en el kardex.');
      } else {
        await this.service.ajusteRealStock(art, bod, valor, motivo);
        this.toast.success('Ajuste real aplicado.', 'El stock quedó en el valor real, sin escalón en la gráfica.');
      }
      this.ajusteItem.set(null);
      await this.load(bod);
    } catch (e: unknown) {
      this.ajusteError.set(e instanceof Error ? e.message : 'No se pudo aplicar el ajuste.');
    } finally {
      this.ajusteSaving.set(false);
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

  // AP5/AT12 — la edición de apertura y el ajuste real ahora viven dentro del modal
  // unificado "Ajustar existencia" (ver guardarAjusteExistencia). Ya no hay prompts sueltos.
}
