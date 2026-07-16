import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  TecEquipo,
  TecEquipoFormData,
  TecEquipoEstado,
  TecEquipoHistorial,
  TecCompraOpcion,
  TEC_EQUIPO_TIPOS,
  TEC_EQUIPO_ESTADOS,
} from '../../../../shared/models/tecnologia.model';
import { Empleado } from '../../../../shared/models/empleado.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

@Component({
  selector: 'app-tec-inventario',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecInventario implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private empleadosService = inject(EmpleadosService);
  private toast = inject(ToastService);

  readonly TIPOS = TEC_EQUIPO_TIPOS;
  readonly ESTADOS = TEC_EQUIPO_ESTADOS;

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;

  equipos = signal<TecEquipo[]>([]);
  empleados = signal<Empleado[]>([]);
  comprasOpciones = signal<TecCompraOpcion[]>([]); // QA-070
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

  // ── Detail/history drawer ─────────────────────────────────
  detailOpen = signal(false);
  detailEquipo = signal<TecEquipo | null>(null);
  historial = signal<TecEquipoHistorial[]>([]);
  historialLoading = signal(false);

  // ── U17 — foto del equipo ─────────────────────────────────
  private fotoFile = signal<File | null>(null);
  fotoPreview = signal<string | null>(null);   // preview local del archivo nuevo
  fotoActualUrl = signal<string | null>(null);  // URL firmada de la foto ya guardada
  listaFotos = signal<Record<string, string>>({}); // id → URL firmada (thumbnails)
  detalleFotoUrl = signal<string | null>(null);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    tipo: new FormControl<string | null>(null, [Validators.required]),
    marca: new FormControl<string | null>(null),
    modelo: new FormControl<string | null>(null),
    serie: new FormControl<string | null>(null),
    estado: new FormControl<TecEquipoEstado>('en_stock', [Validators.required]),
    empleado_id: new FormControl<string | null>(null),
    asignado_en: new FormControl<string | null>(null),
    ubicacion: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    // QA-071 — datos de compra/garantía
    costo: new FormControl<number | null>(null),
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
      const [equipos, empleados, compras] = await Promise.all([
        this.tecnologia.getEquipos(),
        this.empleadosService.getAll(),
        this.tecnologia.getComprasTecOpciones(), // QA-070
      ]);
      this.equipos.set(equipos);
      this.empleados.set(empleados);
      this.comprasOpciones.set(compras);
      this.resolverFotos(equipos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el inventario.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  getTipoLabel(value: string): string {
    return this.TIPOS.find((t) => t.value === value)?.label ?? value;
  }

  getEstadoLabel(value: string): string {
    return this.ESTADOS.find((e) => e.value === value)?.label ?? value;
  }

  getEstadoBadge(value: string): string {
    return this.ESTADOS.find((e) => e.value === value)?.badge ?? 'neutral';
  }

  getEmpleadoNombre(e: TecEquipo): string {
    if (e.empleado) return `${e.empleado.nombre} ${e.empleado.apellido}`;
    return '—';
  }

  // QA-071 — costo formateado como RD$ (sin decimales).
  formatCosto(n: number | null | undefined): string {
    if (n == null) return '—';
    return `RD$ ${Number(n).toLocaleString('es-DO', { maximumFractionDigits: 0 })}`;
  }

  // QA-070 — etiqueta de la compra de origen (para el detalle).
  compraLabel(id: string | null | undefined): string {
    if (!id) return '';
    return this.comprasOpciones().find((c) => c.id === id)?.label ?? 'Compra tecnológica';
  }

  // ── U17 — fotos ───────────────────────────────────────────
  private resolverFotos(equipos: TecEquipo[]) {
    for (const e of equipos) {
      if (!e.foto_path) continue;
      this.tecnologia.getEquipoFotoUrl(e.foto_path).then((url) => {
        if (url) this.listaFotos.update((m) => ({ ...m, [e.id]: url }));
      });
    }
  }

  fotoDe(e: TecEquipo): string | null {
    return this.listaFotos()[e.id] ?? null;
  }

  // QA-051 — si la URL firmada falla (expirada/404), descarta la miniatura para
  // que el @else muestre el placesholder en vez de un ícono de imagen rota.
  onFotoError(equipoId: string) {
    this.listaFotos.update((m) => {
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

  onFotoPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = Array.from(input.files ?? []).find((f) => f.type.startsWith('image/'));
    input.value = '';
    if (!file) return;
    if (this.fotoPreview()) URL.revokeObjectURL(this.fotoPreview()!);
    this.fotoFile.set(file);
    this.fotoPreview.set(URL.createObjectURL(file));
  }

  quitarFotoNueva() {
    if (this.fotoPreview()) URL.revokeObjectURL(this.fotoPreview()!);
    this.fotoFile.set(null);
    this.fotoPreview.set(null);
  }

  private resetFotoState(e: TecEquipo | null) {
    this.quitarFotoNueva();
    this.fotoActualUrl.set(null);
    if (e?.foto_path) {
      this.tecnologia.getEquipoFotoUrl(e.foto_path).then((url) => this.fotoActualUrl.set(url));
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
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({
      nombre: '',
      tipo: null,
      marca: null,
      modelo: null,
      serie: null,
      estado: 'en_stock',
      empleado_id: null,
      asignado_en: null,
      ubicacion: null,
      notas: null,
      costo: null,
      fecha_compra: null,
      garantia_hasta: null,
      origen_solicitud_compra_id: null,
    });
    this.resetFotoState(null);
    this.drawerOpen.set(true);
  }

  openEdit(e: TecEquipo) {
    this.editingId.set(e.id);
    this.saveError.set('');
    this.resetFotoState(e);
    this.form.reset({
      nombre: e.nombre,
      tipo: e.tipo,
      marca: e.marca,
      modelo: e.modelo,
      serie: e.serie,
      estado: e.estado,
      empleado_id: e.empleado_id,
      asignado_en: e.asignado_en,
      ubicacion: e.ubicacion,
      notas: e.notas,
      costo: e.costo,
      fecha_compra: e.fecha_compra,
      garantia_hasta: e.garantia_hasta,
      origen_solicitud_compra_id: e.origen_solicitud_compra_id,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.value as TecEquipoFormData;

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

      // U17 — subir la foto nueva (si hay) al equipo ya existente y guardar el path.
      const file = this.fotoFile();
      if (file) {
        try {
          const path = await this.tecnologia.uploadEquipoFoto(equipoId, file);
          await this.tecnologia.updateEquipo(equipoId, { foto_path: path });
        } catch {
          this.toast.warning('Foto no subida', 'El equipo se guardó, pero la foto no.');
        }
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
    this.detalleFotoUrl.set(this.listaFotos()[e.id] ?? null);
    if (!this.detalleFotoUrl() && e.foto_path) {
      this.tecnologia.getEquipoFotoUrl(e.foto_path).then((url) => this.detalleFotoUrl.set(url));
    }
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
      'Tipo': this.getTipoLabel(e.tipo),
      'Marca': e.marca ?? '',
      'Modelo': e.modelo ?? '',
      'Serie': e.serie ?? '',
      'Estado': this.getEstadoLabel(e.estado),
      'Asignado a': e.empleado ? `${e.empleado.nombre} ${e.empleado.apellido}` : '',
      'Ubicación': e.ubicacion ?? '',
      'Costo (RD$)': e.costo ?? '',
      'Fecha de compra': this.formatFecha(e.fecha_compra),
      'Garantía hasta': this.formatFecha(e.garantia_hasta),
    }));
    await exportarExcel('inventario-tecnologia', rows);
  }

  get f() {
    return this.form.controls;
  }
}
