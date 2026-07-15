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
import { RouterLink } from '@angular/router';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { FlotaConfigService } from '../../../../shared/services/flota-config.service';
import {
  Vehiculo,
  VehiculoFormData,
  VEHICULO_TIPOS,
  VEHICULO_ESTADOS,
  CAPACIDAD_UNIDADES,
  estadoVencimiento,
  VENCIMIENTO_LABEL,
  VENCIMIENTO_BADGE,
  proximoMantenimientoKm,
  kmFaltanMantenimiento,
} from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { ToastService } from '../../../../shared/services/toast.service';

interface PendingFoto {
  file: File;
  preview: string;
}

@Component({
  selector: 'app-flota-vehiculos',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, RouterLink],
  templateUrl: './vehiculos.html',
  styleUrl: './vehiculos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlotaVehiculos implements OnInit {
  private vehiculosService = inject(VehiculosService);
  private flotaConfig = inject(FlotaConfigService);
  private toast = inject(ToastService);

  // ── Drawer photos ────────────────────────────────────────
  fotoPaths = signal<string[]>([]); // existing persisted photo paths
  fotoFiles = signal<PendingFoto[]>([]); // newly picked, not yet uploaded
  fotoUrls = signal<Record<string, string>>({}); // path → signed URL for thumbnails
  private originalFotos: string[] = [];

  // ── Data ─────────────────────────────────────────────────
  vehiculos = signal<Vehiculo[]>([]);
  /** U6 — primera foto (URL firmada) por vehículo, para el thumbnail del listado. */
  listaFotos = signal<Record<string, string>>({});
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
    vencimiento_matricula: new FormControl<string | null>(null),
    vencimiento_seguro: new FormControl<string | null>(null),
    km_ultimo_mantenimiento: new FormControl<number | null>(null, [Validators.min(0)]),
    intervalo_mantenimiento_km: new FormControl<number>(5000, [Validators.min(1)]),
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
      this.resolverFotosLista(vehiculos);
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

  /** Resuelve la 1ª foto de cada vehículo a URL firmada (thumbnails del listado). */
  private resolverFotosLista(vehiculos: Vehiculo[]) {
    for (const v of vehiculos) {
      const first = v.fotos?.[0];
      if (!first) continue;
      this.vehiculosService.getFotoUrl(first).then((url) => {
        if (url) this.listaFotos.update((m) => ({ ...m, [v.id]: url }));
      });
    }
  }

  fotoDe(v: Vehiculo): string | null {
    return this.listaFotos()[v.id] ?? null;
  }

  onSearch(value: string) { this.searchQuery.set(value); }
  onTipoChange(value: string) { this.selectedTipo.set(value); }
  onEstadoChange(value: string) { this.selectedEstado.set(value); }

  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.resetFotos([]);
    this.form.reset({ tipo: 'camion', estado: 'activo', kilometraje: 0, anio: new Date().getFullYear(), intervalo_mantenimiento_km: 5000 });
    this.drawerOpen.set(true);
  }

  openEdit(vehiculo: Vehiculo) {
    this.editingId.set(vehiculo.id);
    this.saveError.set('');
    this.resetFotos(vehiculo.fotos ?? []);
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
      vencimiento_matricula: vehiculo.vencimiento_matricula,
      vencimiento_seguro: vehiculo.vencimiento_seguro,
      km_ultimo_mantenimiento: vehiculo.km_ultimo_mantenimiento,
      intervalo_mantenimiento_km: vehiculo.intervalo_mantenimiento_km ?? 5000,
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
      this.vehiculosService.getFotoUrl(path).then((url) => {
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
      let saved: Vehiculo;
      if (id) {
        saved = await this.vehiculosService.update(id, payload);
      } else {
        saved = await this.vehiculosService.create(payload);
      }

      // Photos: upload any newly-picked files to the (now known) vehicle id,
      // then persist the full list. A failed upload never blocks the save.
      const uploaded: string[] = [];
      for (const pending of this.fotoFiles()) {
        try {
          uploaded.push(await this.vehiculosService.uploadFoto(saved.id, pending.file));
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
          await this.vehiculosService.setFotos(saved.id, finalFotos);
          saved = { ...saved, fotos: finalFotos };
        } catch {
          this.toast.warning('Fotos no guardadas', 'El vehículo se guardó, pero las fotos no.');
        }
      } else {
        saved = { ...saved, fotos: finalFotos };
      }

      if (id) {
        this.vehiculos.update((list) => list.map((v) => (v.id === id ? saved : v)));
      } else {
        this.vehiculos.update((list) => [saved, ...list]);
      }
      this.revokePreviews();
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
    if (estado === 'no_disponible') return 'danger';
    return 'neutral';
  }

  // ── Vencimientos / mantenimiento (badges derivados) ──────
  vencMeta(fecha: string | null | undefined): { label: string; badge: string } | null {
    const est = estadoVencimiento(fecha);
    return est ? { label: VENCIMIENTO_LABEL[est], badge: VENCIMIENTO_BADGE[est] } : null;
  }
  proximoMant = proximoMantenimientoKm;
  kmFaltanMant = kmFaltanMantenimiento;

  /** Estado de mantenimiento por km para el badge de la lista. */
  mantMeta(v: Vehiculo): { label: string; badge: string } | null {
    const faltan = kmFaltanMantenimiento(v);
    if (faltan == null) return null;
    if (faltan <= 0) return { label: 'Mant. vencido', badge: 'danger' };
    if (faltan <= this.flotaConfig.umbralPrecitaKm()) return { label: 'Agendar pre-cita', badge: 'warning' };
    return { label: 'Mant. al día', badge: 'success' };
  }

  get f() { return this.form.controls; }
}
