import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProveedoresService, ProveedorPayload } from '../../../../shared/services/proveedores.service';
import { Proveedor } from '../../../../shared/models/proveedor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TelefonoMask } from '../../../../shared/ui/telefono-mask.directive';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatearTelefono } from '../../../../shared/utils/telefono.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { UserService } from '../../../core/services/user.service';
import { LocationPicker } from '../../../../shared/context/location-picker/location-picker';
import { Icon } from '../../../../shared/ui/icon/icon';
import type { UbicacionSeleccionada } from '../../../../shared/context/location-picker/location-picker';

// RNC (9 dígitos) o cédula (11 dígitos), con o sin guiones. Rechaza longitudes intermedias.
const RNC_CEDULA_PATTERN = /^(\d{9}|\d{11}|\d-\d{2}-\d{5}-\d|\d{3}-\d{7}-\d)$/;

@Component({
  selector: 'app-proveedores',
  imports: [ReactiveFormsModule, FormDrawer, TelefonoMask, Skeleton, LocationPicker, Icon],
  templateUrl: './proveedores.html',
  styleUrl: './proveedores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Proveedores implements OnInit {
  private proveedoresService = inject(ProveedoresService);
  private toast = inject(ToastService);
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  private datosPrueba = inject(DatosPruebaService);
  private userService = inject(UserService);

  formatTelefono = formatearTelefono;

  // ── Datos de prueba (Z5) ─────────────────────────────────
  esAdmin = computed(() => this.userService.hasRole('admin'));
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Data state ──────────────────────────────────────────
  proveedores = signal<Proveedor[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedActivo = signal<'all' | 'active' | 'inactive'>('all');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    rnc: new FormControl<string | null>(null, [Validators.pattern(RNC_CEDULA_PATTERN)]),
    contacto: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    telefono: new FormControl<string | null>(null, [Validators.maxLength(20)]),
    email: new FormControl<string | null>(null, [Validators.email, Validators.maxLength(150)]),
    direccion: new FormControl<string | null>(null),
    // AF32 — ferretería visible para choferes + ubicación.
    is_hardware_store: new FormControl<boolean>(false),
    lat: new FormControl<number | null>(null),
    lng: new FormControl<number | null>(null),
    activo: new FormControl<boolean>(true),
    es_prueba: new FormControl<boolean>(false),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const activo = this.selectedActivo();
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.proveedores().filter((p) => {
      if (p.es_prueba && !verPrueba) return false;
      if (
        q &&
        !p.nombre.toLowerCase().includes(q) &&
        !(p.rnc ?? '').toLowerCase().includes(q) &&
        !(p.email ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (activo === 'active' && !p.activo) return false;
      if (activo === 'inactive' && p.activo) return false;
      return true;
    });
  });

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar proveedor' : 'Nuevo proveedor',
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.proveedoresService.getAll();
      this.proveedores.set(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los proveedores.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onActivoChange(value: string) {
    this.selectedActivo.set(value as 'all' | 'active' | 'inactive');
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedActivo.set('all');
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ activo: true, es_prueba: false });
    this.drawerOpen.set(true);
  }

  openEdit(p: Proveedor) {
    this.editingId.set(p.id);
    this.saveError.set('');
    this.form.reset({
      nombre: p.nombre,
      rnc: p.rnc,
      contacto: p.contacto,
      telefono: p.telefono,
      email: p.email,
      direccion: p.direccion,
      is_hardware_store: p.is_hardware_store ?? false,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      activo: p.activo,
      es_prueba: p.es_prueba ?? false,
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

    const payload = this.form.value as ProveedorPayload;

    // Z5 — al marcar un proveedor existente como prueba, avisar cuántos
    // registros relacionados se marcarán también.
    const idEdit = this.editingId();
    if (idEdit && this.form.value.es_prueba) {
      const n = await this.datosPrueba.contarDerivados('proveedores', idEdit, true);
      if (n > 0 && !confirm(`Esto también marcará como prueba ${n} registro(s) relacionado(s). ¿Continuar?`)) {
        this.saving.set(false);
        return;
      }
    }

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.proveedoresService.update(id, payload);
        this.proveedores.update((list) => list.map((p) => (p.id === id ? updated : p)));
      } else {
        const created = await this.proveedoresService.create(payload);
        this.proveedores.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async toggleActivo(p: Proveedor) {
    const next = !p.activo;
    this.proveedores.update((list) =>
      list.map((item) => (item.id === p.id ? { ...item, activo: next } : item)),
    );
    try {
      await this.proveedoresService.toggleActivo(p.id, next);
    } catch (e: unknown) {
      this.proveedores.update((list) =>
        list.map((item) => (item.id === p.id ? { ...item, activo: !next } : item)),
      );
      this.toast.error('No se pudo cambiar el estado del proveedor', e instanceof Error ? e.message : undefined);
    }
  }

  /** Z5 — elimina definitivamente una fila de datos de prueba (solo admin). */
  async eliminarPrueba(p: Proveedor) {
    if (!this.esAdmin() || !p.es_prueba) return;
    if (!confirm(`¿Eliminar el dato de prueba "${p.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.datosPrueba.eliminar('proveedores', p.id);
      this.proveedores.update((list) => list.filter((x) => x.id !== p.id));
      this.toast.success('Dato de prueba eliminado', `Se eliminó "${p.nombre}".`);
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  // ── Exportar Excel (lista filtrada) ──────────────────────
  async exportarExcelProveedores() {
    const rows = this.filtered().map((p) => ({
      Nombre: p.nombre,
      'RNC / Cédula': p.rnc ?? '',
      Contacto: p.contacto ?? '',
      Teléfono: p.telefono ? this.formatTelefono(p.telefono) : '',
      Email: p.email ?? '',
      Dirección: p.direccion ?? '',
      Ferretería: p.is_hardware_store ? 'Sí' : '',
      Estado: p.activo ? 'Activo' : 'Inactivo',
    }));
    await exportarExcel('proveedores', rows, 'Proveedores');
  }

  // ── AG7 — Importar desde Excel/CSV ───────────────────────
  importOpen = signal(false);
  importPreview = signal<ImportPreviewRow[]>([]);
  importDupMode = signal<'update' | 'skip'>('update');
  importing = signal(false);
  importError = signal('');
  importNombre = signal('');

  importResumen = computed(() => {
    const rows = this.importPreview();
    return {
      total: rows.length,
      nuevos: rows.filter((r) => r.estado === 'nuevo').length,
      duplicados: rows.filter((r) => r.estado === 'duplicado').length,
      errores: rows.filter((r) => r.estado === 'error').length,
    };
  });

  abrirImport() {
    this.importPreview.set([]);
    this.importError.set('');
    this.importNombre.set('');
    this.importDupMode.set('update');
    this.importOpen.set(true);
  }
  cerrarImport() { this.importOpen.set(false); }

  /** Descarga una plantilla vacía con los encabezados esperados (+ una fila ejemplo). */
  async descargarPlantilla() {
    const rows = [{
      Nombre: 'Ferretería Ejemplo SRL',
      'RNC / Cédula': '101010101',
      Contacto: 'Juan Pérez',
      Teléfono: '8095551234',
      Email: 'ventas@ejemplo.com',
      Dirección: 'Av. Principal #1, Santo Domingo',
      Ferretería: 'Sí',
      Lat: '18.4861',
      Lng: '-69.9312',
    }];
    await exportarExcel('plantilla-proveedores', rows, 'Proveedores');
  }

  /** Lee el archivo (xlsx/csv), mapea columnas de forma flexible y arma el preview. */
  async onImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importError.set('');
    this.importNombre.set(file.name);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (!raw.length) { this.importError.set('El archivo no tiene filas.'); return; }

      // Mapeo flexible de encabezados (normaliza acentos/mayúsculas).
      const norm = (s: string) => s.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const pick = (row: Record<string, unknown>, keys: string[]): string => {
        for (const k of Object.keys(row)) {
          const nk = norm(k);
          if (keys.some((want) => nk === want || nk.includes(want))) {
            const v = row[k];
            return v == null ? '' : String(v).trim();
          }
        }
        return '';
      };

      // Índice de existentes por nombre y por RNC para detectar duplicados.
      const byNombre = new Map<string, Proveedor>();
      const byRnc = new Map<string, Proveedor>();
      for (const p of this.proveedores()) {
        byNombre.set(norm(p.nombre), p);
        if (p.rnc) byRnc.set(p.rnc.replace(/\D/g, ''), p);
      }

      const preview: ImportPreviewRow[] = raw.map((row, i) => {
        const nombre = pick(row, ['nombre', 'proveedor', 'razon social']);
        const rnc = pick(row, ['rnc', 'cedula', 'rnc / cedula', 'rnc/cedula']);
        const contacto = pick(row, ['contacto', 'persona']);
        const telefono = pick(row, ['telefono', 'tel', 'celular']);
        const email = pick(row, ['email', 'correo']);
        const direccion = pick(row, ['direccion', 'ubicacion']);
        const ferreteriaStr = pick(row, ['ferreteria', 'is_hardware_store', 'hardware']);
        const latStr = pick(row, ['lat', 'latitud']);
        const lngStr = pick(row, ['lng', 'lon', 'longitud']);

        const payload: ProveedorPayload = {
          nombre,
          rnc: rnc || null,
          contacto: contacto || null,
          telefono: telefono ? telefono.replace(/\D/g, '') || null : null,
          email: email || null,
          direccion: direccion || null,
          is_hardware_store: /^(si|sí|s|yes|true|1|x)$/i.test(ferreteriaStr),
          lat: latStr && !isNaN(Number(latStr)) ? Number(latStr) : null,
          lng: lngStr && !isNaN(Number(lngStr)) ? Number(lngStr) : null,
          activo: true,
        };

        // Validación por fila.
        if (!nombre) return { fila: i + 2, payload, estado: 'error' as const, detalle: 'Falta el nombre', match: null };
        const rncDigits = rnc.replace(/\D/g, '');
        const existente = byNombre.get(norm(nombre)) ?? (rncDigits ? byRnc.get(rncDigits) : undefined) ?? null;
        if (existente) {
          return { fila: i + 2, payload, estado: 'duplicado' as const, detalle: `Ya existe: ${existente.nombre}`, match: existente };
        }
        return { fila: i + 2, payload, estado: 'nuevo' as const, detalle: '', match: null };
      });

      this.importPreview.set(preview);
      if (!preview.some((r) => r.estado !== 'error')) {
        this.importError.set('Ninguna fila es válida. Revisa que la columna "Nombre" esté presente.');
      }
    } catch (e: unknown) {
      this.importError.set(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  }

  /** Ejecuta el import: inserta nuevos y actualiza/salta duplicados según la opción. */
  async confirmarImport() {
    if (this.importing()) return;
    const rows = this.importPreview();
    const nuevos = rows.filter((r) => r.estado === 'nuevo');
    const dups = rows.filter((r) => r.estado === 'duplicado');
    if (!nuevos.length && !(dups.length && this.importDupMode() === 'update')) {
      this.importError.set('No hay filas para importar.');
      return;
    }
    this.importing.set(true);
    this.importError.set('');
    let creados = 0, actualizados = 0, saltados = 0, fallidos = 0;
    try {
      // Insertar nuevos en lote.
      if (nuevos.length) {
        try {
          const created = await this.proveedoresService.insertMany(nuevos.map((r) => r.payload));
          creados = created.length;
          this.proveedores.update((list) => [...created, ...list]);
        } catch {
          fallidos += nuevos.length;
        }
      }
      // Duplicados: actualizar o saltar.
      if (dups.length) {
        if (this.importDupMode() === 'skip') {
          saltados = dups.length;
        } else {
          for (const r of dups) {
            if (!r.match) continue;
            try {
              const updated = await this.proveedoresService.update(r.match.id, r.payload);
              this.proveedores.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
              actualizados++;
            } catch {
              fallidos++;
            }
          }
        }
      }
      // AL3 — bitácora de importación (best-effort, no bloquea).
      await this.proveedoresService.registrarImport(
        { total: creados + actualizados + saltados + fallidos, creados, actualizados, saltados, fallidos },
      );
      this.toast.success(
        'Importación completada',
        `${creados} nuevo(s), ${actualizados} actualizado(s), ${saltados} saltado(s)${fallidos ? `, ${fallidos} con error` : ''}.`,
      );
      this.importOpen.set(false);
    } catch (e: unknown) {
      this.importError.set(e instanceof Error ? e.message : 'Error durante la importación.');
    } finally {
      this.importing.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }

  // AS22 — ubicación estándar (link/coords/pin/Places) en el form de proveedores.
  // La ubicación de ferreterías alimenta el select del chofer (ferreterias_visibles).
  onUbicacion(u: UbicacionSeleccionada) {
    this.form.patchValue({
      lat: u.latitud,
      lng: u.longitud,
      direccion: this.form.value.direccion?.trim() ? this.form.value.direccion : u.direccion,
    });
  }
}

/** AG7 — fila del preview de importación de proveedores. */
export interface ImportPreviewRow {
  fila: number;
  payload: ProveedorPayload;
  estado: 'nuevo' | 'duplicado' | 'error';
  detalle: string;
  match: Proveedor | null;
}
