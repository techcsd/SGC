import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  SalidasService, MaterialNoCatalogadoRow,
} from '../../../../shared/services/salidas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { Articulo, UNIDADES } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../../shared/ui/articulo-picker/articulo-picker';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * AU4 — Bandeja "Material no catalogado": items libres que los choferes escribieron
 * en los conduces porque el artículo no existía. Desde aquí el admin/inventario
 * crea el artículo (prellenado) o lo vincula a uno existente, para depurar el
 * catálogo (regla AT11: toda esa data es visible). Vínculo simple: no mueve stock
 * retroactivo (el item libre nunca tocó stock); el artículo creado entra al flujo
 * normal hacia adelante.
 */
@Component({
  selector: 'app-material-no-catalogado',
  imports: [RouterLink, ArticuloPicker, Skeleton],
  templateUrl: './material-no-catalogado.html',
  styleUrl: './material-no-catalogado.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialNoCatalogado implements OnInit {
  private svc = inject(SalidasService);
  private articulosSvc = inject(ArticulosService);
  private categoriasSvc = inject(CategoriasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  readonly unidades = UNIDADES;

  puedeGestionar = computed(() => this.userService.hasRole('admin') || this.userService.hasModulo('inventario'));

  filas = signal<MaterialNoCatalogadoRow[]>([]);
  loading = signal(true);
  incluirResueltos = signal(false);

  // Catálogo (para vincular / categorías al crear).
  catalogo = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);

  // Item en edición (crear, vincular o declinar).
  activo = signal<MaterialNoCatalogadoRow | null>(null);
  modo = signal<'crear' | 'vincular' | 'declinar' | null>(null);
  guardando = signal(false);

  // AT11 — declinar (→ historial). Motivos rápidos; "ya existe" apunta al correcto.
  readonly MOTIVOS_DECLINAR = [
    { value: 'no_necesario', label: 'No es necesario crear el artículo' },
    { value: 'ya_existe', label: 'Ya existe en el catálogo' },
    { value: 'duplicado', label: 'Duplicado' },
    { value: 'otro', label: 'Otro' },
  ];
  declinarMotivo = signal<string>('no_necesario');
  declinarNota = signal('');
  declinarArticuloId = signal<string | null>(null);

  // Form crear artículo.
  nuevoNombre = signal('');
  nuevaCategoria = signal<number | null>(null);
  nuevaUnidad = signal<string>('unidad');
  // Vincular a existente.
  vincularArticuloId = signal<string | null>(null);
  // AY13 — per-case: ¿generar el movimiento de inventario retroactivo al vincular?
  generarMovimiento = signal(false);

  async ngOnInit() {
    await this.cargar();
    try {
      const [arts, cats] = await Promise.all([
        this.articulosSvc.getAll(),
        this.categoriasSvc.getAll(),
      ]);
      this.catalogo.set(arts);
      this.categorias.set(cats);
    } catch { /* reintentable */ }
  }

  private async cargar() {
    this.loading.set(true);
    try {
      this.filas.set(await this.svc.getMaterialNoCatalogado(this.incluirResueltos()));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar la bandeja.');
    } finally {
      this.loading.set(false);
    }
  }

  async toggleResueltos(v: boolean) {
    this.incluirResueltos.set(v);
    await this.cargar();
  }

  abrirCrear(fila: MaterialNoCatalogadoRow) {
    this.activo.set(fila);
    this.modo.set('crear');
    this.nuevoNombre.set(fila.nombre);
    this.nuevaCategoria.set(this.categorias()[0]?.id ?? null);
    this.nuevaUnidad.set(fila.unidad || 'unidad');
    this.generarMovimiento.set(false);
  }

  abrirVincular(fila: MaterialNoCatalogadoRow) {
    this.activo.set(fila);
    this.modo.set('vincular');
    this.vincularArticuloId.set(null);
    this.generarMovimiento.set(false);
  }

  abrirDeclinar(fila: MaterialNoCatalogadoRow) {
    this.activo.set(fila);
    this.modo.set('declinar');
    this.declinarMotivo.set('no_necesario');
    this.declinarNota.set('');
    this.declinarArticuloId.set(null);
  }

  cerrar() {
    if (this.guardando()) return;
    this.activo.set(null);
    this.modo.set(null);
  }

  onVincularSel(sel: ArticuloPickerSelection) {
    this.vincularArticuloId.set(sel.articuloId);
  }

  onDeclinarSel(sel: ArticuloPickerSelection) {
    this.declinarArticuloId.set(sel.articuloId);
  }

  async confirmarDeclinar() {
    const fila = this.activo();
    if (!fila || this.guardando()) return;
    const motivoVal = this.declinarMotivo();
    const label = this.MOTIVOS_DECLINAR.find((m) => m.value === motivoVal)?.label ?? motivoVal;
    let motivo = label;
    let sugerido: string | null = null;
    if (motivoVal === 'ya_existe') {
      sugerido = this.declinarArticuloId();
      if (!sugerido) { this.toast.error('Indica cuál artículo del catálogo ya existe.'); return; }
      const art = this.catalogo().find((a) => a.id === sugerido);
      if (art) motivo = `Ya existe en el catálogo: ${art.nombre}`;
    } else if (motivoVal === 'otro') {
      const nota = this.declinarNota().trim();
      if (!nota) { this.toast.error('Escribe el motivo.'); return; }
      motivo = nota;
    }
    this.guardando.set(true);
    try {
      await this.svc.declinarItemLibre(fila.id, motivo, sugerido);
      this.toast.success('Material declinado.', 'Pasó a historial y se notificó a quien lo reportó.');
      this.cerrar();
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo declinar.');
    } finally {
      this.guardando.set(false);
    }
  }

  async revertirDeclinacion(fila: MaterialNoCatalogadoRow) {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.svc.revertirDeclinacionItemLibre(fila.id);
      this.toast.success('Se revirtió el rechazo.', 'El material vuelve a la bandeja como pendiente.');
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo revertir.');
    } finally {
      this.guardando.set(false);
    }
  }

  async crearYVincular() {
    const fila = this.activo();
    if (!fila || this.guardando()) return;
    const nombre = this.nuevoNombre().trim();
    const catId = this.nuevaCategoria();
    if (!nombre) { this.toast.error('El nombre es obligatorio.'); return; }
    if (catId == null) { this.toast.error('Elige una categoría.'); return; }
    this.guardando.set(true);
    try {
      const art = await this.articulosSvc.create({
        nombre,
        descripcion: null,
        categoria_id: catId,
        unidad: this.nuevaUnidad(),
        stock_minimo: 0,
        stock_maximo: null,
        precio_estimado: null,
        activo: true,
      });
      await this.svc.vincularItemLibre(fila.id, art.id, this.generarMovimiento());
      this.toast.success('Artículo creado y vinculado.', 'Ya está en el catálogo para futuros conduces.');
      this.cerrar();
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear el artículo.');
    } finally {
      this.guardando.set(false);
    }
  }

  async vincular() {
    const fila = this.activo();
    const artId = this.vincularArticuloId();
    if (!fila || this.guardando()) return;
    if (!artId) { this.toast.error('Selecciona un artículo del catálogo.'); return; }
    this.guardando.set(true);
    try {
      await this.svc.vincularItemLibre(fila.id, artId, this.generarMovimiento());
      this.toast.success('Item vinculado al artículo.');
      this.cerrar();
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo vincular.');
    } finally {
      this.guardando.set(false);
    }
  }
}
