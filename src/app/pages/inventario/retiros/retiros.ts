import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import {
  RetirosService,
  RetiroListItem,
  RetiroEstado,
  MotivoDano,
  Disposicion,
  RetiroItem,
} from '../../../../shared/services/retiros.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../../shared/ui/articulo-picker/articulo-picker';
import { QtyStepper } from '../../../../shared/ui/qty-stepper/qty-stepper';

interface FormItem {
  articulo_id: string;
  esOtro: boolean;
  descripcion: string;
  cantidad: number;
  unidad: string;
}
const NUEVO_ITEM = (): FormItem => ({ articulo_id: '', esOtro: false, descripcion: '', cantidad: 1, unidad: '' });

const MOTIVO_LABEL: Record<MotivoDano, string> = {
  danado_obra: 'Dañado en obra',
  defecto_fabrica: 'Defecto de fábrica',
  vencido: 'Vencido',
  otro: 'Otro',
};
const ESTADO_LABEL: Record<RetiroEstado, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  en_retiro: 'En retiro (transporte)',
  en_cuarentena: 'En cuarentena',
  dispuesta: 'Dispuesta',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};
const ESTADO_BADGE: Record<RetiroEstado, string> = {
  pendiente: 'warning',
  aprobada: 'info',
  en_retiro: 'info',
  en_cuarentena: 'warning',
  dispuesta: 'success',
  rechazada: 'danger',
  cancelada: 'neutral',
};
const DISPOSICION_LABEL: Record<Disposicion, string> = {
  descarte: 'Descarte (merma)',
  reparacion: 'Reparación',
  devolucion: 'Devolución a proveedor',
};

@Component({
  selector: 'app-inventario-retiros',
  imports: [DatePipe, FormDrawer, Skeleton, ArticuloPicker, QtyStepper],
  templateUrl: './retiros.html',
  styleUrl: './retiros.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioRetiros implements OnInit {
  private retiros = inject(RetirosService);
  private proyectosSvc = inject(ProyectosService);
  private bodegasSvc = inject(BodegasService);
  private articulosSvc = inject(ArticulosService);
  private categoriasSvc = inject(CategoriasService);
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  motivoLabel = (m: string) => MOTIVO_LABEL[m as MotivoDano] ?? m;
  estadoLabel = (e: string) => ESTADO_LABEL[e as RetiroEstado] ?? e;
  estadoBadge = (e: string) => ESTADO_BADGE[e as RetiroEstado] ?? 'neutral';
  disposicionLabel = (d: string | null) => (d ? DISPOSICION_LABEL[d as Disposicion] ?? d : '');

  tab = signal<'solicitudes' | 'cuarentena'>('solicitudes');
  loading = signal(true);
  error = signal('');
  filas = signal<RetiroListItem[]>([]);
  cuarentena = signal<Awaited<ReturnType<RetirosService['cuarentena']>>>([]);
  filtroEstado = signal<RetiroEstado | 'todos'>('todos');

  proyectos = signal<Proyecto[]>([]);
  bodegas = signal<Bodega[]>([]);
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  proveedores = signal<{ id: string; nombre: string }[]>([]);

  filasVisibles = computed(() => {
    const e = this.filtroEstado();
    return e === 'todos' ? this.filas() : this.filas().filter((f) => f.estado === e);
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  crearAbierto = signal(false);
  guardando = signal(false);
  fProyecto = signal('');
  fAlmacen = signal('');
  fMotivo = signal<MotivoDano>('danado_obra');
  fMotivoDetalle = signal('');
  fNotas = signal('');
  fItems = signal<FormItem[]>([NUEVO_ITEM()]);
  fFotos = signal<{ path: string; nombre: string }[]>([]);
  subiendoFoto = signal(false);
  private crearId = this.retiros.nuevoId();

  // ── Detalle ────────────────────────────────────────────────────────────────
  detalleAbierto = signal(false);
  detalle = signal<Record<string, unknown> | null>(null);
  detalleFotosUrls = signal<string[]>([]);
  accion = signal<'ver' | 'rechazar' | 'conduce' | 'recibir' | 'disponer' | 'cancelar'>('ver');
  procesando = signal(false);
  // campos de acción
  aMotivo = signal('');
  aTransporta = signal('');
  aPlacaPath = signal('');
  aCargaPath = signal('');
  aEmisorFirmaPath = signal('');
  aRecepFotoPath = signal('');
  aRecepFirmaPath = signal('');
  aRecepNotas = signal('');
  aDisposicion = signal<Disposicion>('descarte');
  aDisposicionNota = signal('');
  aProveedor = signal('');

  async ngOnInit() {
    await Promise.all([this.load(), this.loadCatalogos()]);
  }

  async loadCatalogos() {
    try {
      const [proy, bod, arts, cats] = await Promise.all([
        this.proyectosSvc.getAll(),
        this.bodegasSvc.getAll(),
        this.articulosSvc.getAll(),
        this.categoriasSvc.getAll(),
      ]);
      this.proyectos.set(proy);
      this.bodegas.set(bod);
      this.articulos.set(arts);
      this.categorias.set(cats);
      const { data } = await this.supabase.client.from('proveedores').select('id,nombre').order('nombre');
      this.proveedores.set((data ?? []) as { id: string; nombre: string }[]);
    } catch {
      /* catálogos best-effort */
    }
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      if (this.tab() === 'cuarentena') {
        this.cuarentena.set(await this.retiros.cuarentena());
      } else {
        this.filas.set(await this.retiros.listado());
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(t: 'solicitudes' | 'cuarentena') {
    this.tab.set(t);
    this.load();
  }
  setFiltro(e: RetiroEstado | 'todos') {
    this.filtroEstado.set(e);
  }

  articuloById = (id: string) => this.articulos().find((a) => a.id === id);

  // ── Crear ────────────────────────────────────────────────────────────────
  abrirCrear() {
    this.crearId = this.retiros.nuevoId();
    this.fProyecto.set('');
    this.fAlmacen.set('');
    this.fMotivo.set('danado_obra');
    this.fMotivoDetalle.set('');
    this.fNotas.set('');
    this.fItems.set([NUEVO_ITEM()]);
    this.fFotos.set([]);
    this.crearAbierto.set(true);
  }
  addItem() {
    this.fItems.update((it) => [...it, NUEVO_ITEM()]);
  }
  removeItem(i: number) {
    this.fItems.update((it) => it.filter((_, idx) => idx !== i));
  }
  onPick(i: number, sel: ArticuloPickerSelection) {
    this.fItems.update((items) =>
      items.map((item, idx) => {
        if (idx !== i) return item;
        const a = sel.articuloId ? this.articuloById(sel.articuloId) : undefined;
        return {
          ...item,
          articulo_id: sel.articuloId ?? '',
          esOtro: sel.esOtro,
          unidad: a?.unidad ?? (sel.esOtro ? item.unidad : ''),
          descripcion: sel.esOtro ? item.descripcion : a?.nombre ?? '',
        };
      }),
    );
  }
  setCantidad(i: number, v: number | string) {
    const cantidad = Number(v) || 0;
    this.fItems.update((it) => it.map((item, idx) => (idx === i ? { ...item, cantidad } : item)));
  }
  setDescripcion(i: number, v: string) {
    this.fItems.update((it) => it.map((item, idx) => (idx === i ? { ...item, descripcion: v } : item)));
  }
  setUnidad(i: number, v: string) {
    this.fItems.update((it) => it.map((item, idx) => (idx === i ? { ...item, unidad: v } : item)));
  }

  async onFotoSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    this.subiendoFoto.set(true);
    try {
      for (const f of files) {
        const path = await this.retiros.uploadEvidencia(`${this.crearId}/dano`, f);
        this.fFotos.update((fs) => [...fs, { path, nombre: f.name }]);
      }
    } catch (e) {
      this.toast.error('No se pudo subir la foto', e instanceof Error ? e.message : undefined);
    } finally {
      this.subiendoFoto.set(false);
      input.value = '';
    }
  }
  removeFoto(i: number) {
    this.fFotos.update((fs) => fs.filter((_, idx) => idx !== i));
  }

  async guardarCrear() {
    const items: RetiroItem[] = this.fItems()
      .filter((it) => (it.articulo_id || it.descripcion.trim()) && it.cantidad > 0)
      .map((it) => ({
        articulo_id: it.articulo_id || null,
        descripcion: it.descripcion.trim() || 'Artículo',
        cantidad: it.cantidad,
        unidad: it.unidad || null,
      }));
    if (!this.fProyecto()) { this.toast.error('Selecciona la obra.'); return; }
    if (!items.length) { this.toast.error('Agrega al menos un artículo.'); return; }
    if (!this.fFotos().length) { this.toast.error('Agrega al menos una foto del material dañado.'); return; }
    if (this.fMotivo() === 'otro' && !this.fMotivoDetalle().trim()) {
      this.toast.error('Describe el motivo del daño.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.retiros.crear({
        proyecto_id: this.fProyecto(),
        almacen_destino_id: this.fAlmacen() || null,
        motivo_dano: this.fMotivo(),
        motivo_dano_detalle: this.fMotivoDetalle().trim() || null,
        notas: this.fNotas().trim() || null,
        items,
        fotos: this.fFotos(),
      });
      this.toast.success('Retiro solicitado');
      this.crearAbierto.set(false);
      await this.load();
    } catch (e) {
      this.toast.error('No se pudo crear el retiro', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Detalle + acciones ───────────────────────────────────────────────────
  async abrirDetalle(f: RetiroListItem) {
    this.accion.set('ver');
    this.detalleAbierto.set(true);
    this.detalle.set(null);
    this.detalleFotosUrls.set([]);
    this.resetAccion();
    try {
      const d = await this.retiros.detalle(f.id);
      this.detalle.set(d);
      const fotos = (d['fotos'] as { path: string }[] | undefined) ?? [];
      const urls = await Promise.all(fotos.map((x) => this.retiros.signedUrl(x.path)));
      this.detalleFotosUrls.set(urls.filter((u): u is string => !!u));
    } catch (e) {
      this.toast.error('No se pudo cargar el detalle', e instanceof Error ? e.message : undefined);
    }
  }
  get retiroActual(): Record<string, unknown> | null {
    return (this.detalle()?.['retiro'] as Record<string, unknown>) ?? null;
  }
  get itemsActual(): RetiroItem[] {
    return (this.detalle()?.['items'] as RetiroItem[]) ?? [];
  }
  resetAccion() {
    this.aMotivo.set('');
    this.aTransporta.set('');
    this.aPlacaPath.set('');
    this.aCargaPath.set('');
    this.aEmisorFirmaPath.set('');
    this.aRecepFotoPath.set('');
    this.aRecepFirmaPath.set('');
    this.aRecepNotas.set('');
    this.aDisposicion.set('descarte');
    this.aDisposicionNota.set('');
    this.aProveedor.set('');
  }
  setAccion(a: 'ver' | 'rechazar' | 'conduce' | 'recibir' | 'disponer' | 'cancelar') {
    this.resetAccion();
    this.accion.set(a);
  }

  private retiroId(): string {
    return (this.retiroActual?.['id'] as string) ?? '';
  }

  async subirA(target: 'placa' | 'carga' | 'emisor' | 'recepFoto' | 'recepFirma', ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const path = await this.retiros.uploadEvidencia(`${this.retiroId()}/${target}`, f);
      if (target === 'placa') this.aPlacaPath.set(path);
      else if (target === 'carga') this.aCargaPath.set(path);
      else if (target === 'emisor') this.aEmisorFirmaPath.set(path);
      else if (target === 'recepFoto') this.aRecepFotoPath.set(path);
      else if (target === 'recepFirma') this.aRecepFirmaPath.set(path);
    } catch (e) {
      this.toast.error('No se pudo subir', e instanceof Error ? e.message : undefined);
    } finally {
      input.value = '';
    }
  }

  private async run(fn: () => Promise<unknown>, ok: string) {
    this.procesando.set(true);
    try {
      await fn();
      this.toast.success(ok);
      this.detalleAbierto.set(false);
      await this.load();
    } catch (e) {
      this.toast.error('No se pudo completar', e instanceof Error ? e.message : undefined);
    } finally {
      this.procesando.set(false);
    }
  }

  aprobar() {
    this.run(() => this.retiros.aprobar(this.retiroId()), 'Retiro aprobado');
  }
  confirmarRechazo() {
    if (!this.aMotivo().trim()) { this.toast.error('Indica el motivo.'); return; }
    this.run(() => this.retiros.rechazar(this.retiroId(), this.aMotivo().trim()), 'Retiro rechazado');
  }
  confirmarCancelar() {
    if (!this.aMotivo().trim()) { this.toast.error('Indica el motivo.'); return; }
    this.run(() => this.retiros.cancelar(this.retiroId(), this.aMotivo().trim()), 'Retiro cancelado');
  }
  confirmarConduce() {
    if (!this.aTransporta().trim()) { this.toast.error('Indica quién transporta.'); return; }
    if (!this.aPlacaPath()) { this.toast.error('Sube la foto de la placa.'); return; }
    this.run(
      () =>
        this.retiros.generarConduce(this.retiroId(), {
          transporta_texto: this.aTransporta().trim(),
          placa_foto_path: this.aPlacaPath(),
          carga_foto_path: this.aCargaPath() || null,
          emisor_firma_path: this.aEmisorFirmaPath() || null,
        }),
      'Conduce de retiro generado',
    );
  }
  confirmarRecibir() {
    if (!this.aRecepFotoPath()) { this.toast.error('Sube la foto de recepción.'); return; }
    if (!this.aRecepFirmaPath()) { this.toast.error('Sube la firma del receptor.'); return; }
    this.run(
      () =>
        this.retiros.recibir(
          this.retiroId(),
          this.aRecepFotoPath(),
          this.aRecepFirmaPath(),
          this.aRecepNotas().trim() || null,
        ),
      'Material recibido en cuarentena',
    );
  }
  confirmarDisponer() {
    if (this.aDisposicion() === 'devolucion' && !this.aProveedor()) {
      this.toast.error('Selecciona el proveedor.');
      return;
    }
    this.run(
      () =>
        this.retiros.disponer(
          this.retiroId(),
          this.aDisposicion(),
          this.aDisposicionNota().trim() || null,
          this.aDisposicion() === 'devolucion' ? this.aProveedor() : null,
        ),
      'Disposición registrada',
    );
  }
}
