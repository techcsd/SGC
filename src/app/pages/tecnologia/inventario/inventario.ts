import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { EmpleadosService, EmpleadoDirectorio } from '../../../../shared/services/empleados.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  TecEquipo,
  TecEquipoFormData,
  TecEquipoEstado,
  TecEquipoHistorial,
  TecCompraOpcion,
  TEC_EQUIPO_ESTADOS,
} from '../../../../shared/models/tecnologia.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

/** AL1 — foto de la galería (existente o pendiente de subir). `key` identifica la
 *  portada (path si es existente, o el preview blob si es nueva). */
interface FotoItem {
  key: string; // path (existente) | preview url (nueva)
  url: string; // signed url (existente) | preview url (nueva)
  path: string | null; // path si ya está en storage; null si es nueva
  file: File | null; // archivo si es nueva
}

@Component({
  selector: 'app-tec-inventario',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, Lightbox],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecInventario implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private empleadosService = inject(EmpleadosService);
  private bodegasService = inject(BodegasService);
  private toast = inject(ToastService);

  readonly ESTADOS = TEC_EQUIPO_ESTADOS;

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;

  equipos = signal<TecEquipo[]>([]);
  empleados = signal<EmpleadoDirectorio[]>([]);
  comprasOpciones = signal<TecCompraOpcion[]>([]); // QA-070
  tipos = signal<{ value: string; label: string }[]>([]); // AL1 — catálogo
  bodegas = signal<{ id: string; nombre: string; es_central: boolean }[]>([]); // AL1 — ubicación
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ───────────────────────────────────────────────
  searchQuery = signal('');
  selectedEstado = signal<string>('');

  // ── Create/Edit drawer ────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  // AL1 — agregar tipo nuevo en línea
  addingTipo = signal(false);
  newTipoLabel = signal('');

  // ── Detail/history drawer ─────────────────────────────────
  detailOpen = signal(false);
  detailEquipo = signal<TecEquipo | null>(null);
  historial = signal<TecEquipoHistorial[]>([]);
  historialLoading = signal(false);
  detalleFotos = signal<FotoItem[]>([]); // AL1 — galería del detalle (portada primero)

  // ── AL1 — galería multi-foto del formulario ───────────────
  fotos = signal<FotoItem[]>([]);
  portadaKey = signal<string | null>(null);
  listaPortadas = signal<Record<string, string>>({}); // id → url portada (thumbnails)

  // ── AL1 — lightbox ────────────────────────────────────────
  lightboxUrl = signal<string | null>(null);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    tipo_id: new FormControl<string | null>(null, [Validators.required]),
    marca: new FormControl<string | null>(null),
    modelo: new FormControl<string | null>(null),
    serie: new FormControl<string | null>(null),
    estado: new FormControl<TecEquipoEstado>('en_stock', [Validators.required]),
    empleado_id: new FormControl<string | null>(null),
    asignado_en: new FormControl<string | null>(null),
    bodega_id: new FormControl<string | null>(null),
    ubicacion: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    // QA-071 — datos de compra/garantía
    costo: new FormControl<number | null>(null),
    moneda: new FormControl<'DOP' | 'USD'>('DOP'),
    fecha_compra: new FormControl<string | null>(null),
    garantia_hasta: new FormControl<string | null>(null),
    // QA-070 — origen: compra tecnológica
    origen_solicitud_compra_id: new FormControl<string | null>(null),
  });

  drawerTitle = computed(() => (this.editingId() ? 'Editar equipo' : 'Nuevo equipo'));

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    return this.equipos().filter((e) => {
      if (
        q &&
        !e.nombre.toLowerCase().includes(q) &&
        !(e.codigo?.toLowerCase().includes(q) ?? false) &&
        !(e.serie?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      if (estado && e.estado !== estado) return false;
      return true;
    });
  });

  hasActiveFilters = computed(() => !!this.searchQuery() || !!this.selectedEstado());

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [equipos, empleados, compras, tipos, bodegas] = await Promise.all([
        this.tecnologia.getEquipos(),
        this.empleadosService.getDirectorio(), // AN1 — referencia (no requiere módulo RRHH)
        this.tecnologia.getComprasTecOpciones(), // QA-070
        this.tecnologia.getEquipoTipos(), // AL1
        this.bodegasService.getAll(), // AL1
      ]);
      this.equipos.set(equipos);
      this.empleados.set(empleados);
      this.comprasOpciones.set(compras);
      this.tipos.set(tipos);
      this.bodegas.set(
        (bodegas as { id: string; nombre: string; proyecto_id: string | null }[]).map((b) => ({
          id: b.id,
          nombre: b.nombre,
          es_central: b.proyecto_id == null,
        })),
      );
      this.resolverFotos(equipos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el inventario.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  getTipoLabel(e: TecEquipo): string {
    if (e.tipo_id) {
      const t = this.tipos().find((x) => x.value === e.tipo_id);
      if (t) return t.label;
    }
    return e.tipo ?? '—';
  }

  getEstadoLabel(value: string): string {
    return this.ESTADOS.find((e) => e.value === value)?.label ?? value;
  }

  getEstadoBadge(value: string): string {
    return this.ESTADOS.find((e) => e.value === value)?.badge ?? 'neutral';
  }

  getEmpleadoNombre(e: TecEquipo): string {
    // AN1 — el embed `empleado:empleados(...)` falla para roles sin acceso a RRHH
    // (p.ej. Tecnología). Resolvemos primero desde el directorio de referencia.
    if (e.empleado_id) {
      const emp = this.empleados().find((x) => x.id === e.empleado_id);
      if (emp) return `${emp.nombre} ${emp.apellido ?? ''}`.trim();
    }
    if (e.empleado) return `${e.empleado.nombre} ${e.empleado.apellido}`;
    return '—';
  }

  getUbicacionLabel(e: TecEquipo): string {
    if (e.bodega_id) {
      const b = this.bodegas().find((x) => x.id === e.bodega_id);
      if (b) return b.nombre;
    }
    return e.ubicacion ?? '—';
  }

  // AL1 — costo formateado con su moneda (RD$ / US$).
  formatCosto(n: number | null | undefined, moneda?: 'DOP' | 'USD' | null): string {
    if (n == null) return '—';
    const simbolo = moneda === 'USD' ? 'US$' : 'RD$';
    return `${simbolo} ${Number(n).toLocaleString('es-DO', { maximumFractionDigits: 0 })}`;
  }

  // QA-070 — etiqueta de la compra de origen (para el detalle).
  compraLabel(id: string | null | undefined): string {
    if (!id) return '';
    return this.comprasOpciones().find((c) => c.id === id)?.label ?? 'Compra tecnológica';
  }

  // ── AL1 — resolución de portadas para el listado ──────────
  private portadaPathOf(e: TecEquipo): string | null {
    return e.foto_portada ?? (e.fotos && e.fotos.length ? e.fotos[0] : null) ?? e.foto_path ?? null;
  }

  private resolverFotos(equipos: TecEquipo[]) {
    for (const e of equipos) {
      const path = this.portadaPathOf(e);
      if (!path) continue;
      this.tecnologia.getEquipoFotoUrl(path).then((url) => {
        if (url) this.listaPortadas.update((m) => ({ ...m, [e.id]: url }));
      });
    }
  }

  fotoDe(e: TecEquipo): string | null {
    return this.listaPortadas()[e.id] ?? null;
  }

  onFotoError(equipoId: string) {
    this.listaPortadas.update((m) => {
      if (!(equipoId in m)) return m;
      const next = { ...m };
      delete next[equipoId];
      return next;
    });
  }

  // QA-050 — etiqueta es-DO para el tipo de cambio del historial.
  private readonly HIST_TIPO_LABELS: Record<string, string> = {
    registro: 'Registro',
    asignacion: 'Asignación',
    estado: 'Cambio de estado',
    edicion: 'Edición',
    reparacion: 'Reparación',
    baja: 'Dado de baja',
  };

  histTipoLabel(tipo: string): string {
    return this.HIST_TIPO_LABELS[tipo] ?? tipo.charAt(0).toUpperCase() + tipo.slice(1).replace(/_/g, ' ');
  }

  // ── AL1 — galería multi-foto del formulario ───────────────
  onFotosPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    input.value = '';
    if (!files.length) return;
    const nuevas: FotoItem[] = files.map((file) => {
      const preview = URL.createObjectURL(file);
      return { key: preview, url: preview, path: null, file };
    });
    this.fotos.update((list) => [...list, ...nuevas]);
    // primera foto = portada por defecto
    if (!this.portadaKey() && this.fotos().length) this.portadaKey.set(this.fotos()[0].key);
  }

  quitarFoto(item: FotoItem) {
    if (item.file && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
    this.fotos.update((list) => list.filter((f) => f.key !== item.key));
    if (this.portadaKey() === item.key) {
      this.portadaKey.set(this.fotos().length ? this.fotos()[0].key : null);
    }
  }

  marcarPortada(item: FotoItem) {
    this.portadaKey.set(item.key);
  }

  esPortada(item: FotoItem): boolean {
    return this.portadaKey() === item.key;
  }

  abrirLightbox(url: string) {
    this.lightboxUrl.set(url);
  }

  private async cargarFotosExistentes(e: TecEquipo | null): Promise<FotoItem[]> {
    if (!e) return [];
    const paths = e.fotos && e.fotos.length ? e.fotos : e.foto_path ? [e.foto_path] : [];
    const items: FotoItem[] = [];
    for (const p of paths) {
      const url = await this.tecnologia.getEquipoFotoUrl(p);
      if (url) items.push({ key: p, url, path: p, file: null });
    }
    return items;
  }

  // AL1 — agregar un tipo nuevo desde el formulario.
  async guardarTipoNuevo() {
    const label = this.newTipoLabel().trim();
    if (!label) return;
    try {
      const nuevo = await this.tecnologia.addEquipoTipo(label);
      this.tipos.update((list) => [...list, nuevo].sort((a, b) => a.label.localeCompare(b.label)));
      this.form.controls.tipo_id.setValue(nuevo.value);
      this.newTipoLabel.set('');
      this.addingTipo.set(false);
      this.toast.success('Tipo agregado');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar el tipo.');
    }
  }

  // ── Filters ───────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('');
  }

  // ── Create/Edit drawer ────────────────────────────────────
  private limpiarFotos() {
    for (const f of this.fotos()) if (f.file && f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
    this.fotos.set([]);
    this.portadaKey.set(null);
  }

  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.addingTipo.set(false);
    this.newTipoLabel.set('');
    this.form.reset({
      nombre: '',
      tipo_id: null,
      marca: null,
      modelo: null,
      serie: null,
      estado: 'en_stock',
      empleado_id: null,
      asignado_en: null,
      bodega_id: null,
      ubicacion: null,
      notas: null,
      costo: null,
      moneda: 'DOP',
      fecha_compra: null,
      garantia_hasta: null,
      origen_solicitud_compra_id: null,
    });
    this.limpiarFotos();
    this.drawerOpen.set(true);
  }

  async openEdit(e: TecEquipo) {
    this.editingId.set(e.id);
    this.saveError.set('');
    this.addingTipo.set(false);
    this.newTipoLabel.set('');
    this.form.reset({
      nombre: e.nombre,
      tipo_id: e.tipo_id,
      marca: e.marca,
      modelo: e.modelo,
      serie: e.serie,
      estado: e.estado,
      empleado_id: e.empleado_id,
      asignado_en: e.asignado_en,
      bodega_id: e.bodega_id,
      ubicacion: e.ubicacion,
      notas: e.notas,
      costo: e.costo,
      moneda: e.moneda ?? 'DOP',
      fecha_compra: e.fecha_compra,
      garantia_hasta: e.garantia_hasta,
      origen_solicitud_compra_id: e.origen_solicitud_compra_id,
    });
    this.limpiarFotos();
    this.drawerOpen.set(true);
    const existentes = await this.cargarFotosExistentes(e);
    this.fotos.set(existentes);
    this.portadaKey.set(
      e.foto_portada ?? (existentes.length ? existentes[0].key : null),
    );
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.value as unknown as TecEquipoFormData;

    try {
      const id = this.editingId();
      let equipoId: string;
      if (id) {
        await this.tecnologia.updateEquipo(id, payload);
        equipoId = id;
      } else {
        const created = await this.tecnologia.createEquipo(payload);
        equipoId = created.id;
      }

      // AL1 — subir fotos nuevas, componer galería + portada.
      try {
        const finalPaths: string[] = [];
        let portada: string | null = null;
        for (const f of this.fotos()) {
          let path = f.path;
          if (!path && f.file) path = await this.tecnologia.uploadEquipoFoto(equipoId, f.file);
          if (!path) continue;
          finalPaths.push(path);
          if (this.portadaKey() === f.key) portada = path;
        }
        if (!portada) portada = finalPaths[0] ?? null;
        await this.tecnologia.updateEquipo(equipoId, {
          fotos: finalPaths,
          foto_portada: portada,
          foto_path: portada, // back-compat
        });
      } catch {
        this.toast.warning('Fotos no subidas', 'El equipo se guardó, pero las fotos no.');
      }

      await this.loadAll();
      this.toast.success(id ? 'Equipo actualizado' : 'Equipo registrado');
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(e: TecEquipo) {
    if (!confirm(`¿Eliminar el equipo "${e.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.tecnologia.removeEquipo(e.id);
      this.equipos.update((list) => list.filter((x) => x.id !== e.id));
      this.toast.success('Equipo eliminado');
    } catch (err: unknown) {
      this.toast.error(err instanceof Error ? err.message : 'Error al eliminar.');
    }
  }

  // ── Detail / history drawer ───────────────────────────────
  async openDetail(e: TecEquipo) {
    this.detailEquipo.set(e);
    this.detailOpen.set(true);
    this.detalleFotos.set([]);
    this.cargarFotosExistentes(e).then((items) => {
      // portada primero
      const portada = e.foto_portada;
      const ordenadas = portada
        ? [...items].sort((a, b) => (a.path === portada ? -1 : b.path === portada ? 1 : 0))
        : items;
      this.detalleFotos.set(ordenadas);
    });
    this.historial.set([]);
    this.historialLoading.set(true);
    try {
      const historial = await this.tecnologia.getHistorial(e.id);
      this.historial.set(historial);
    } catch {
      this.toast.error('No se pudo cargar el historial.');
    } finally {
      this.historialLoading.set(false);
    }
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  // ── Exportar a Excel (listado filtrado) ───────────────────
  async exportar() {
    const rows = this.filtered().map((e) => ({
      'Código': e.codigo ?? '',
      'Nombre': e.nombre,
      'Tipo': this.getTipoLabel(e),
      'Marca': e.marca ?? '',
      'Modelo': e.modelo ?? '',
      'Serie': e.serie ?? '',
      'Estado': this.getEstadoLabel(e.estado),
      'Asignado a': e.empleado ? `${e.empleado.nombre} ${e.empleado.apellido}` : '',
      'Ubicación': this.getUbicacionLabel(e),
      'Costo': e.costo ?? '',
      'Moneda': e.moneda ?? 'DOP',
      'Fecha de compra': this.formatFecha(e.fecha_compra),
      'Garantía hasta': this.formatFecha(e.garantia_hasta),
    }));
    await exportarExcel('inventario-tecnologia', rows);
  }

  get f() {
    return this.form.controls;
  }
}
