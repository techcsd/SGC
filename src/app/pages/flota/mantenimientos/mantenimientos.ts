import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MantenimientosService } from '../../../../shared/services/mantenimientos.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import {
  Mantenimiento,
  MantenimientoFormData,
  MANT_TIPOS,
  MANT_ESTADOS,
} from '../../../../shared/models/mantenimiento.model';
import { Vehiculo, kmFaltanMantenimiento } from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';

interface PendingFoto {
  file: File;
  preview: string;
}

@Component({
  selector: 'app-mantenimientos',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe, Skeleton],
  templateUrl: './mantenimientos.html',
  styleUrl: './mantenimientos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mantenimientos implements OnInit {
  private mantenimientosService = inject(MantenimientosService);
  private vehiculosService = inject(VehiculosService);
  private proveedoresService = inject(ProveedoresService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private datosPrueba = inject(DatosPruebaService);

  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  mostrarPrueba = signal(false);

  // ── Drawer photos ────────────────────────────────────────
  fotoPaths = signal<string[]>([]); // existing persisted photo paths
  fotoFiles = signal<PendingFoto[]>([]); // newly picked, not yet uploaded
  fotoUrls = signal<Record<string, string>>({}); // path → signed URL for thumbnails (drawer)
  private rowFotoUrls = signal<Record<string, string>>({}); // path → signed URL for list rows
  private originalFotos: string[] = [];

  /** Signed URL of a photo shown in a list row (or null while resolving). */
  rowFotoUrl(path: string): string | null {
    return this.rowFotoUrls()[path] ?? null;
  }

  /** Resolves signed URLs for every photo across the loaded maintenance rows. */
  private resolveListaFotos(list: Mantenimiento[]) {
    for (const path of list.flatMap((m) => m.fotos ?? [])) {
      if (this.rowFotoUrls()[path]) continue;
      this.mantenimientosService.getFotoUrl(path).then((url) => {
        if (url) this.rowFotoUrls.update((m) => ({ ...m, [path]: url }));
      });
    }
  }

  formatFecha = formatFechaDisplay;

  // Existing supplier names → datalist so "taller" spellings stay consistent.
  proveedorNombres = signal<string[]>([]);

  // ── Data state ──────────────────────────────────────────
  mantenimientos = signal<Mantenimiento[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedTipo = signal('');
  selectedEstado = signal('');
  selectedVehiculo = signal(''); // R4b — drill-down desde Reportes (?vehiculo=)

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly MANT_TIPOS = MANT_TIPOS;
  readonly MANT_ESTADOS = MANT_ESTADOS;

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    tipo: new FormControl('preventivo', [Validators.required]),
    estado: new FormControl('pendiente', [Validators.required]),
    descripcion: new FormControl('', [Validators.required]),
    fecha: new FormControl('', [Validators.required]),
    costo: new FormControl<number | null>(null, [Validators.min(0)]),
    kilometraje_al_mantenimiento: new FormControl<number | null>(null, [Validators.min(0)]),
    proveedor: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tipo = this.selectedTipo();
    const estado = this.selectedEstado();
    // T2 — no-admin nunca ve datos de prueba (RLS server-side); admin los oculta salvo toggle.
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.mantenimientos().filter((m) => {
      if (m.es_prueba && !verPrueba) return false;
      if (
        q &&
        !m.vehiculo?.placa.toLowerCase().includes(q) &&
        !m.vehiculo?.marca.toLowerCase().includes(q) &&
        !m.proveedor?.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (tipo && m.tipo !== tipo) return false;
      if (estado && m.estado !== estado) return false;
      if (this.selectedVehiculo() && m.vehiculo_id !== this.selectedVehiculo()) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar mantenimiento' : 'Nuevo mantenimiento',
  );

  // ── T16 — Vehículos cerca o vencidos de mantenimiento (por km) ──────────────
  // Umbral "cerca": faltan <=500 km; "vencido": km faltantes <= 0.
  readonly UMBRAL_CERCA_KM = 500;
  vehiculosMantenimiento = computed(() => {
    const conMant = new Set(
      this.mantenimientos()
        .filter((m) => m.estado !== 'completado')
        .map((m) => m.vehiculo_id),
    );
    return this.vehiculos()
      .filter((v) => v.activo && v.estado !== 'baja')
      .map((v) => ({ v, faltan: kmFaltanMantenimiento(v) }))
      .filter((x) => x.faltan != null && x.faltan <= this.UMBRAL_CERCA_KM)
      // No repetir los que ya tienen un mantenimiento abierto/programado.
      .filter((x) => !conMant.has(x.v.id))
      .sort((a, b) => (a.faltan ?? 0) - (b.faltan ?? 0));
  });

  /** Abre el drawer prellenado para un vehículo del banner de mantenimiento. */
  crearDesdeBanner(vehiculoId: string, vencido: boolean) {
    this.openCreateDesdeAviso(vehiculoId, vencido ? 'correctivo' : 'preventivo');
  }

  // ── Upcoming maintenance alert (next 7 days) ──────────────
  proximosMantenimientos = computed(() => {
    const today = new Date();
    const in7Days = new Date();
    in7Days.setDate(today.getDate() + 7);
    const todayStr = this.toDateStr(today);
    const in7Str = this.toDateStr(in7Days);

    return this.mantenimientos()
      .filter((m) => m.estado !== 'completado' && m.fecha >= todayStr && m.fecha <= in7Str)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  });

  async ngOnInit() {
    await this.loadAll();
    // R9: crear cita precargada desde un aviso de flota (?nuevo=1&vehiculo=..&tipo=..).
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('nuevo')) {
      this.openCreateDesdeAviso(qp.get('vehiculo'), qp.get('tipo') ?? 'preventivo');
    } else if (qp.get('vehiculo')) {
      // R4b — llegada desde Reportes: filtra la lista por ese vehículo.
      this.selectedVehiculo.set(qp.get('vehiculo')!);
    }
  }

  /** Abre el drawer de creación precargando vehículo, km actual, tipo y fecha. */
  openCreateDesdeAviso(vehiculoId: string | null, tipo: string) {
    this.openCreate();
    const v = this.vehiculos().find((x) => x.id === vehiculoId);
    this.form.patchValue({
      vehiculo_id: vehiculoId ?? '',
      tipo,
      fecha: this.toDateStr(new Date()),
      kilometraje_al_mantenimiento: v?.kilometraje ?? null,
      descripcion:
        tipo === 'correctivo'
          ? 'Mantenimiento por alerta de kilometraje'
          : 'Mantenimiento preventivo programado',
    });
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [mantenimientos, vehiculos, proveedores] = await Promise.all([
        this.mantenimientosService.getAll(),
        this.vehiculosService.getAll(),
        this.proveedoresService.getAll(),
      ]);
      this.mantenimientos.set(mantenimientos);
      this.vehiculos.set(vehiculos);
      this.proveedorNombres.set(proveedores.filter((p) => p.activo).map((p) => p.nombre));
      this.resolveListaFotos(mantenimientos);
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

  onTipoChange(value: string) {
    this.selectedTipo.set(value);
    this.currentPage.set(1);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedTipo.set('');
    this.selectedEstado.set('');
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

  /** Exporta los mantenimientos filtrados a Excel. */
  async exportar() {
    const rows = this.filtered().map((m) => ({
      Fecha: this.formatFecha(m.fecha),
      Vehículo: m.vehiculo?.placa ?? '',
      Tipo: this.getTipoLabel(m.tipo),
      Estado: this.getEstadoLabel(m.estado),
      Costo: m.costo ?? '',
      Proveedor: m.proveedor ?? '',
      Km: m.kilometraje_al_mantenimiento ?? '',
    }));
    await exportarExcel('mantenimientos', rows);
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.resetFotos([]);
    this.form.reset({ tipo: 'preventivo', estado: 'pendiente' });
    this.drawerOpen.set(true);
  }

  completandoId = signal<string | null>(null);

  /** Marca el mantenimiento como hecho: resetea el contador del vehículo + atiende avisos. */
  async completar(m: Mantenimiento) {
    if (this.completandoId()) return;
    this.completandoId.set(m.id);
    try {
      await this.mantenimientosService.completar(m.id, m.kilometraje_al_mantenimiento ?? null);
      await this.loadAll();
      this.toast.success('Mantenimiento completado', 'Se actualizó el próximo mantenimiento del vehículo.');
    } catch (e: unknown) {
      this.toast.error('No se pudo completar', e instanceof Error ? e.message : undefined);
    } finally {
      this.completandoId.set(null);
    }
  }

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca o desmarca un mantenimiento como dato de prueba. */
  async marcarPrueba(m: Mantenimiento, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar('mantenimientos', m.id, valor);
      this.mantenimientos.update((list) =>
        list.map((x) => (x.id === m.id ? { ...x, es_prueba: valor } : x)),
      );
      this.toast.success(
        valor ? 'Marcado como prueba' : 'Quitado de prueba',
        valor ? 'El mantenimiento se ocultará del listado.' : 'El mantenimiento vuelve al listado.',
      );
    } catch (e: unknown) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }

  /** Elimina definitivamente un mantenimiento marcado como prueba. */
  async eliminarPrueba(m: Mantenimiento) {
    if (!this.esAdmin() || !m.es_prueba) return;
    if (!confirm('¿Eliminar este dato de prueba? Esta acción no se puede deshacer.')) return;
    try {
      await this.datosPrueba.eliminar('mantenimientos', m.id);
      this.mantenimientos.update((list) => list.filter((x) => x.id !== m.id));
      this.toast.success('Dato de prueba eliminado', 'El mantenimiento se eliminó definitivamente.');
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  openEdit(m: Mantenimiento) {
    this.editingId.set(m.id);
    this.saveError.set('');
    this.resetFotos(m.fotos ?? []);
    this.form.reset({
      vehiculo_id: m.vehiculo_id,
      tipo: m.tipo,
      estado: m.estado,
      descripcion: m.descripcion,
      fecha: m.fecha,
      costo: m.costo,
      kilometraje_al_mantenimiento: m.kilometraje_al_mantenimiento,
      proveedor: m.proveedor,
      notas: m.notas,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
    this.revokePreviews();
  }

  // ── Photos ───────────────────────────────────────────────
  private resetFotos(existing: string[]) {
    this.revokePreviews();
    this.originalFotos = [...existing];
    this.fotoPaths.set([...existing]);
    this.fotoFiles.set([]);
    this.fotoUrls.set({});
    for (const path of existing) {
      this.mantenimientosService.getFotoUrl(path).then((url) => {
        if (url) this.fotoUrls.update((m) => ({ ...m, [path]: url }));
      });
    }
  }

  private revokePreviews() {
    for (const p of this.fotoFiles()) URL.revokeObjectURL(p.preview);
  }

  onFilesPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    const pending = picked.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    this.fotoFiles.update((list) => [...list, ...pending]);
    input.value = ''; // allow re-picking the same file
  }

  removePending(index: number) {
    this.fotoFiles.update((list) => {
      const target = list[index];
      if (target) URL.revokeObjectURL(target.preview);
      return list.filter((_, i) => i !== index);
    });
  }

  removeExistingFoto(path: string) {
    this.fotoPaths.update((list) => list.filter((p) => p !== path));
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const payload = this.form.value as MantenimientoFormData;

    const conflict = this.findWeekConflict(payload);
    if (conflict) {
      this.saveError.set(
        `Conflicto de calendario: el vehículo ${conflict.vehiculo?.placa ?? ''} ya tiene un mantenimiento programado la semana del ${formatFechaDisplay(conflict.fecha)}. No se pueden programar dos vehículos en mantenimiento la misma semana.`,
      );
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const id = this.editingId();
      let saved: Mantenimiento;
      if (id) {
        saved = await this.mantenimientosService.update(id, payload);
      } else {
        saved = await this.mantenimientosService.create(payload);
      }

      // Photos: upload any newly-picked files to the (now known) record id,
      // then persist the full list. A failed upload never blocks the save.
      const uploaded: string[] = [];
      for (const pending of this.fotoFiles()) {
        try {
          uploaded.push(await this.mantenimientosService.uploadFoto(saved.id, pending.file));
        } catch {
          this.toast.warning('Foto no subida', `No se pudo subir "${pending.file.name}".`);
        }
      }

      const finalFotos = [...this.fotoPaths(), ...uploaded];
      const changed =
        finalFotos.length !== this.originalFotos.length ||
        finalFotos.some((p, i) => p !== this.originalFotos[i]);
      if (changed) {
        try {
          await this.mantenimientosService.setFotos(saved.id, finalFotos);
          saved = { ...saved, fotos: finalFotos };
        } catch {
          this.toast.warning('Fotos no guardadas', 'El mantenimiento se guardó, pero las fotos no.');
        }
      } else {
        saved = { ...saved, fotos: finalFotos };
      }

      if (id) {
        this.mantenimientos.update((list) => list.map((m) => (m.id === id ? saved : m)));
      } else {
        this.mantenimientos.update((list) => [saved, ...list]);
      }
      this.resolveListaFotos([saved]);
      this.revokePreviews();
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** ISO-ish week key ("2026-W27") derived from a YYYY-MM-DD string, no UTC parsing. */
  private getWeekKey(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 4 - (date.getDay() || 7));
    const yearStart = new Date(date.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getFullYear()}-W${weekNo}`;
  }

  /** Two different vehicles can't both be scheduled for maintenance the same week. */
  private findWeekConflict(payload: MantenimientoFormData): Mantenimiento | null {
    if (payload.estado === 'completado') return null;
    const targetWeek = this.getWeekKey(payload.fecha);
    const editing = this.editingId();

    return (
      this.mantenimientos().find((m) => {
        if (m.id === editing) return false;
        if (m.estado === 'completado') return false;
        if (m.vehiculo_id === payload.vehiculo_id) return false;
        return this.getWeekKey(m.fecha) === targetWeek;
      }) ?? null
    );
  }

  getEstadoBadge(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'sgc-badge sgc-badge--warning';
      case 'en_proceso': return 'sgc-badge sgc-badge--info';
      case 'completado': return 'sgc-badge sgc-badge--success';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  getEstadoLabel(estado: string): string {
    return MANT_ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }

  getTipoLabel(tipo: string): string {
    return MANT_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  get f() {
    return this.form.controls;
  }
}
