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
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import {
  Vehiculo,
  VehiculoFormData,
  VEHICULO_TIPOS,
  VEHICULO_ESTADOS,
  CAPACIDAD_UNIDADES,
} from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-flota-vehiculos',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './vehiculos.html',
  styleUrl: './vehiculos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlotaVehiculos implements OnInit {
  private vehiculosService = inject(VehiculosService);

  // ── Data ─────────────────────────────────────────────────
  vehiculos = signal<Vehiculo[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');
  dbNotReady = signal(false);

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedTipo = signal('');
  selectedEstado = signal('');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly TIPOS = VEHICULO_TIPOS;
  readonly ESTADOS = VEHICULO_ESTADOS;
  readonly CAPACIDAD_UNIDADES = CAPACIDAD_UNIDADES;

  form = new FormGroup({
    placa: new FormControl('', [Validators.required, Validators.maxLength(20)]),
    marca: new FormControl('', [Validators.required, Validators.maxLength(80)]),
    modelo: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    anio: new FormControl<number>(new Date().getFullYear(), [
      Validators.required,
      Validators.min(1980),
      Validators.max(new Date().getFullYear() + 1),
    ]),
    tipo: new FormControl('camion', [Validators.required]),
    estado: new FormControl('activo', [Validators.required]),
    color: new FormControl<string | null>(null),
    kilometraje: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    capacidad_valor: new FormControl<number | null>(null, [Validators.min(0)]),
    capacidad_unidad: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tipo = this.selectedTipo();
    const estado = this.selectedEstado();

    return this.vehiculos().filter((v) => {
      if (
        q &&
        !v.placa.toLowerCase().includes(q) &&
        !v.marca.toLowerCase().includes(q) &&
        !v.modelo.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (tipo && v.tipo !== tipo) return false;
      if (estado && v.estado !== estado) return false;
      return true;
    });
  });

  drawerTitle = computed(() => (this.editingId() ? 'Editar vehículo' : 'Nuevo vehículo'));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    this.dbNotReady.set(false);
    try {
      const vehiculos = await this.vehiculosService.getAll();
      this.vehiculos.set(vehiculos);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('permission denied')) {
        this.dbNotReady.set(true);
      } else {
        this.error.set(msg || 'Error al cargar vehículos.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(value: string) { this.searchQuery.set(value); }
  onTipoChange(value: string) { this.selectedTipo.set(value); }
  onEstadoChange(value: string) { this.selectedEstado.set(value); }

  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ tipo: 'camion', estado: 'activo', kilometraje: 0, anio: new Date().getFullYear() });
    this.drawerOpen.set(true);
  }

  openEdit(vehiculo: Vehiculo) {
    this.editingId.set(vehiculo.id);
    this.saveError.set('');
    this.form.reset({
      placa: vehiculo.placa,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      anio: vehiculo.anio,
      tipo: vehiculo.tipo,
      estado: vehiculo.estado,
      color: vehiculo.color,
      kilometraje: vehiculo.kilometraje,
      capacidad_valor: vehiculo.capacidad_valor,
      capacidad_unidad: vehiculo.capacidad_unidad,
      notas: vehiculo.notas,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() { this.drawerOpen.set(false); }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const raw = this.form.value;
    // Normalize plate (uppercase, trimmed, single spaces) so "a123bc" and
    // "A123 BC" don't become two different vehicles.
    const payload = {
      ...raw,
      placa: (raw.placa ?? '').trim().toUpperCase().replace(/\s+/g, ' '),
    } as VehiculoFormData;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.vehiculosService.update(id, payload);
        this.vehiculos.update((list) => list.map((v) => (v.id === id ? updated : v)));
      } else {
        const created = await this.vehiculosService.create(payload);
        this.vehiculos.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActivo(vehiculo: Vehiculo) {
    const next = !vehiculo.activo;
    this.vehiculos.update((list) =>
      list.map((v) => (v.id === vehiculo.id ? { ...v, activo: next } : v)),
    );
    try {
      await this.vehiculosService.toggleActivo(vehiculo.id, next);
    } catch {
      this.vehiculos.update((list) =>
        list.map((v) => (v.id === vehiculo.id ? { ...v, activo: !next } : v)),
      );
    }
  }

  getTipoLabel(tipo: string): string {
    return this.TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  getEstadoBadge(estado: string): string {
    if (estado === 'activo') return 'success';
    if (estado === 'mantenimiento') return 'warning';
    return 'neutral';
  }

  get f() { return this.form.controls; }
}
