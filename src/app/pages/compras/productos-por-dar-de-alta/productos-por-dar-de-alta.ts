import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { OdooProductoSolicitudesService } from '../../../../shared/services/odoo-producto-solicitudes.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { OdooProductoSolicitud } from '../../../../shared/models/odoo-producto-solicitud.model';
import { Articulo, UNIDADES } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Paginator } from '../../../../shared/ui/paginator/paginator';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../../shared/ui/articulo-picker/articulo-picker';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

type ModoResolucion = 'vincular' | 'crear' | 'rechazar' | null;

/**
 * CY24 Fase B — bandeja "Productos por dar de alta en Odoo" (#24). Una línea de
 * OC sin producto en Odoo llega aquí como solicitud (D-11: nunca se publica con
 * texto libre); Compras la resuelve vinculando un artículo existente, creando
 * uno nuevo (articulo-sombra, origen='odoo', D-10) o rechazándola — nunca quien
 * la pidió (D-09, lo exige el RPC).
 */
@Component({
  selector: 'app-productos-por-dar-de-alta',
  imports: [DatePipe, FormDrawer, Skeleton, Paginator, ArticuloPicker, TranslatePipe],
  templateUrl: './productos-por-dar-de-alta.html',
  styleUrl: './productos-por-dar-de-alta.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductosPorDarDeAlta implements OnInit {
  private svc = inject(OdooProductoSolicitudesService);
  private articulosSvc = inject(ArticulosService);
  private categoriasSvc = inject(CategoriasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  readonly unidades = UNIDADES;

  // D-09: el RPC lo exige igual, pero mejor no ofrecer "Resolver" a quien de todos
  // modos será rechazado por el servidor.
  puedeResolver = computed(() => this.userService.hasRole('admin') || this.userService.hasModulo('compras'));

  solicitudes = signal<OdooProductoSolicitud[]>([]);
  loading = signal(true);
  error = signal('');
  tab = signal<'pendientes' | 'todas'>('pendientes');

  catalogo = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);

  pendientes = computed(() => this.solicitudes().filter((s) => s.estado === 'pendiente'));
  visible = computed(() => (this.tab() === 'pendientes' ? this.pendientes() : this.solicitudes()));

  page = signal(1);
  readonly PAGE_SIZE = 20;
  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.visible().slice(start, start + this.PAGE_SIZE);
  });

  // ── Solicitar alta ──
  crearOpen = signal(false);
  crearDescripcion = signal('');
  crearBusqueda = signal('');
  creando = signal(false);
  crearError = signal('');

  // ── Resolver / ver ──
  drawerOpen = signal(false);
  drawerSolicitud = signal<OdooProductoSolicitud | null>(null);
  modo = signal<ModoResolucion>(null);
  resolviendo = signal(false);
  resolverError = signal('');

  vincularArticuloId = signal<string | null>(null);
  nuevoNombre = signal('');
  nuevaCategoria = signal<number | null>(null);
  nuevaUnidad = signal('unidad');
  rechazarMotivo = signal('');

  async ngOnInit() {
    await this.loadAll();
    try {
      const [arts, cats] = await Promise.all([this.articulosSvc.getAll(), this.categoriasSvc.getAll()]);
      this.catalogo.set(arts);
      this.categorias.set(cats);
    } catch {
      /* el picker queda vacío; no bloquea ver la bandeja */
    }
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.solicitudes.set(await this.svc.listar());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la bandeja.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: 'pendientes' | 'todas') {
    this.tab.set(tab);
    this.page.set(1);
  }

  abrirCrear() {
    this.crearDescripcion.set('');
    this.crearBusqueda.set('');
    this.crearError.set('');
    this.crearOpen.set(true);
  }

  cerrarCrear() {
    if (this.creando()) return;
    this.crearOpen.set(false);
  }

  async confirmarCrear() {
    if (this.creando()) return;
    const descripcion = this.crearDescripcion().trim();
    const busqueda = this.crearBusqueda().trim();
    if (!descripcion) { this.crearError.set('Describe el material que necesitas.'); return; }
    if (!busqueda) { this.crearError.set('Escribe qué buscaste antes de pedir el alta (para que Compras no repita la búsqueda).'); return; }
    this.creando.set(true);
    this.crearError.set('');
    try {
      await this.svc.crear(descripcion, busqueda);
      this.toast.success('Solicitud enviada.', 'Compras la resolverá creando o vinculando el producto.');
      this.crearOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      this.crearError.set(e instanceof Error ? e.message : 'No se pudo enviar la solicitud.');
    } finally {
      this.creando.set(false);
    }
  }

  abrirDrawer(s: OdooProductoSolicitud) {
    this.drawerSolicitud.set(s);
    this.modo.set(null);
    this.resolverError.set('');
    this.vincularArticuloId.set(null);
    this.nuevoNombre.set(s.descripcion_libre);
    this.nuevaCategoria.set(this.categorias()[0]?.id ?? null);
    this.nuevaUnidad.set('unidad');
    this.rechazarMotivo.set('');
    this.drawerOpen.set(true);
  }

  cerrarDrawer() {
    if (this.resolviendo()) return;
    this.drawerOpen.set(false);
  }

  elegirModo(m: ModoResolucion) {
    this.resolverError.set('');
    this.modo.set(m);
  }

  onVincularSel(sel: ArticuloPickerSelection) {
    this.vincularArticuloId.set(sel.articuloId);
  }

  async confirmarVincular() {
    const s = this.drawerSolicitud();
    const articuloId = this.vincularArticuloId();
    if (!s || this.resolviendo()) return;
    if (!articuloId) { this.resolverError.set('Selecciona un artículo del catálogo.'); return; }
    await this.resolver(s.id, 'vinculado_existente', articuloId, null, 'No se pudo vincular.');
  }

  async confirmarCrearYResolver() {
    const s = this.drawerSolicitud();
    const nombre = this.nuevoNombre().trim();
    const categoriaId = this.nuevaCategoria();
    if (!s || this.resolviendo()) return;
    if (!nombre) { this.resolverError.set('El nombre del artículo es obligatorio.'); return; }
    if (categoriaId == null) { this.resolverError.set('Elige una categoría.'); return; }
    this.resolviendo.set(true);
    this.resolverError.set('');
    try {
      const articulo = await this.articulosSvc.create({
        nombre,
        descripcion: null,
        categoria_id: categoriaId,
        unidad: this.nuevaUnidad(),
        stock_minimo: 0,
        stock_maximo: null,
        precio_estimado: null,
        activo: true,
      });
      await this.svc.resolver(s.id, 'creado', articulo.id, null);
      this.catalogo.update((list) => [...list, articulo]);
      this.toast.success('Artículo creado.', 'Quedó marcado como puente a Odoo (D-10) y la línea de OC se actualizó.');
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      this.resolverError.set(e instanceof Error ? e.message : 'No se pudo crear el artículo.');
    } finally {
      this.resolviendo.set(false);
    }
  }

  async confirmarRechazar() {
    const s = this.drawerSolicitud();
    const motivo = this.rechazarMotivo().trim();
    if (!s || this.resolviendo()) return;
    if (!motivo) { this.resolverError.set('Escribe el motivo del rechazo.'); return; }
    await this.resolver(s.id, 'rechazado', null, motivo, 'No se pudo rechazar.');
  }

  private async resolver(id: string, decision: OdooProductoSolicitud['estado'], articuloId: string | null, motivo: string | null, errorPrefijo: string) {
    this.resolviendo.set(true);
    this.resolverError.set('');
    try {
      await this.svc.resolver(id, decision, articuloId, motivo);
      this.toast.success('Solicitud resuelta.');
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      this.resolverError.set(e instanceof Error ? e.message : errorPrefijo);
    } finally {
      this.resolviendo.set(false);
    }
  }

  estadoBadgeClass(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'sgc-badge sgc-badge--warning';
      case 'creado':
      case 'vinculado_existente': return 'sgc-badge sgc-badge--success';
      case 'rechazado': return 'sgc-badge sgc-badge--danger';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  estadoLabel(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'Pendiente';
      case 'creado': return 'Creado';
      case 'vinculado_existente': return 'Vinculado';
      case 'rechazado': return 'Rechazado';
      default: return estado;
    }
  }
}
