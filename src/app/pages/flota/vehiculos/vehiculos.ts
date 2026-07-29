import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { FlotaConfigService } from '../../../../shared/services/flota-config.service';
import {
  Vehiculo,
  VehiculoFormData,
  VehiculoMedidaUso,
  VEHICULO_TIPOS,
  VEHICULO_ESTADOS,
  VEHICULO_USOS,
  VEHICULO_MEDIDAS_USO,
  VEHICULO_COLORES,
  VEHICULO_ASEGURADORAS,
  CAPACIDAD_UNIDADES,
  estadoVencimiento,
  VENCIMIENTO_LABEL,
  VENCIMIENTO_BADGE,
  proximoMantenimientoKm,
  kmFaltanMantenimiento,
  unidadUso,
  labelLecturaUso,
} from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Img } from '../../../../shared/components/img/img';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

interface PendingFoto {
  file: File;
  preview: string;
}

/**
 * Y9 3.1 — El km del último mantenimiento no puede superar el odómetro
 * (vehiculos.kilometraje). Valida en cliente antes de escribir; el trigger de BD
 * lo refuerza. Error en el grupo: `kmUltimoMantMayor`.
 */
function kmUltimoMantCoherente(group: AbstractControl): ValidationErrors | null {
  const odo = group.get('kilometraje')?.value;
  const kmUlt = group.get('km_ultimo_mantenimiento')?.value;
  if (odo != null && kmUlt != null && Number(kmUlt) > Number(odo)) {
    return { kmUltimoMantMayor: true };
  }
  return null;
}

@Component({
  selector: 'app-flota-vehiculos',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, RouterLink, Img],
  templateUrl: './vehiculos.html',
  styleUrl: './vehiculos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlotaVehiculos implements OnInit {
  private vehiculosService = inject(VehiculosService);
  private flotaConfig = inject(FlotaConfigService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private route = inject(ActivatedRoute);

  // P6 — solo roles elevados crean/editan/activan/desactivan (espejo de RLS).
  puedeGestionar = this.userService.esFlotaElevado;
  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));

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
  // AA17 — filtro por uso (obra | administrativo/"oficina").
  selectedUso = signal('');
  selectedEstado = signal('');
  // T2 — mostrar datos de prueba (solo admin; por defecto ocultos).
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  private datosPrueba = inject(DatosPruebaService);
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly TIPOS = VEHICULO_TIPOS;
  readonly ESTADOS = VEHICULO_ESTADOS;
  readonly USOS = VEHICULO_USOS;
  readonly MEDIDAS_USO = VEHICULO_MEDIDAS_USO;
  readonly COLORES = VEHICULO_COLORES;
  readonly ASEGURADORAS = VEHICULO_ASEGURADORAS;
  readonly CAPACIDAD_UNIDADES = CAPACIDAD_UNIDADES;

  // AA19 — path de la foto de portada elegida (existente o preview de una pendiente).
  fotoPortada = signal<string | null>(null);

  form = new FormGroup({
    placa: new FormControl('', [Validators.required, Validators.maxLength(20)]),
    vin: new FormControl<string | null>(null, [Validators.maxLength(17)]),
    marca: new FormControl('', [Validators.required, Validators.maxLength(80)]),
    modelo: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    anio: new FormControl<number>(new Date().getFullYear(), [
      Validators.required,
      Validators.min(1980),
      Validators.max(new Date().getFullYear() + 1),
    ]),
    tipo: new FormControl('camion', [Validators.required]),
    estado: new FormControl('activo', [Validators.required]),
    uso: new FormControl('obra', [Validators.required]),
    // AA18.3 — unidad del odómetro (km | horas).
    medida_uso: new FormControl<VehiculoMedidaUso>('km', [Validators.required]),
    // AA18.2 — color como select + "Otro" → input manual (colorOtro).
    colorSel: new FormControl<string | null>(null),
    colorOtro: new FormControl<string | null>(null, [Validators.maxLength(40)]),
    kilometraje: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    capacidad_valor: new FormControl<number | null>(null, [Validators.min(0)]),
    capacidad_unidad: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    numero_matricula: new FormControl<string | null>(null, [Validators.maxLength(50)]),
    numero_seguro: new FormControl<string | null>(null, [Validators.maxLength(50)]),
    // AA18.4 — aseguradora como select con "Seguros Universal" por default + "Otro".
    aseguradoraSel: new FormControl<string | null>('Seguros Universal'),
    aseguradoraOtro: new FormControl<string | null>(null, [Validators.maxLength(80)]),
    vencimiento_matricula: new FormControl<string | null>(null),
    vencimiento_seguro: new FormControl<string | null>(null),
    km_ultimo_mantenimiento: new FormControl<number | null>(null, [Validators.min(0)]),
    intervalo_mantenimiento_km: new FormControl<number>(5000, [Validators.min(1)]),
    // AA18.3 — ciclo de mantenimiento en horas (para equipos por horómetro).
    intervalo_mantenimiento_horas: new FormControl<number | null>(null, [Validators.min(1)]),
    // S20 — rendimiento esperado (km/gal) de referencia manual.
    rendimiento_esperado_km_gal: new FormControl<number | null>(null, [Validators.min(0)]),
    // T2 — dato de prueba (solo admin lo edita).
    es_prueba: new FormControl<boolean>(false),
  }, { validators: kmUltimoMantCoherente });

  // AA18.3 — bridge reactivo (OnPush): unidad del vehículo en edición para labels.
  private medidaUsoSig = toSignal(this.form.controls.medida_uso.valueChanges, {
    initialValue: 'km' as VehiculoMedidaUso | null,
  });
  esHoras = computed(() => this.medidaUsoSig() === 'horas');
  labelLectura = computed(() => labelLecturaUso(this.medidaUsoSig() ?? 'km'));
  unidadLectura = computed(() => (this.medidaUsoSig() === 'horas' ? 'h' : 'km'));

  // AA18.2/4 — bridges para mostrar el input "Otro" del color/aseguradora.
  private colorSelSig = toSignal(this.form.controls.colorSel.valueChanges, { initialValue: null as string | null });
  colorEsOtro = computed(() => this.colorSelSig() === 'Otro');
  private aseguradoraSelSig = toSignal(this.form.controls.aseguradoraSel.valueChanges, {
    initialValue: 'Seguros Universal' as string | null,
  });
  aseguradoraEsOtro = computed(() => this.aseguradoraSelSig() === 'Otro');

  /** AA18.3 — unidad de un vehículo del listado (para mostrar km/h). */
  unidadDe = unidadUso;

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tipo = this.selectedTipo();
    const estado = this.selectedEstado();
    // T2 — no-admin: nunca ve datos de prueba. Admin: los oculta salvo que active el toggle.
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.vehiculos().filter((v) => {
      if (v.es_prueba && !verPrueba) return false;
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
      if (this.selectedUso() && (v.uso ?? 'obra') !== this.selectedUso()) return false;
      return true;
    });
  });

  /** AA17 — etiqueta de uso ("Obra" / "Oficina") para badges y reportes. */
  usoLabel(uso: string | null | undefined): string {
    return this.USOS.find((u) => u.value === (uso ?? 'obra'))?.label ?? 'Obra';
  }

  drawerTitle = computed(() => (this.editingId() ? 'Editar vehículo' : 'Nuevo vehículo'));

  async ngOnInit() {
    // Q3 — drill-down desde el dashboard: filtrar por estado (?estado=activo).
    const estado = this.route.snapshot.queryParamMap.get('estado');
    if (estado) this.selectedEstado.set(estado);
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

  /** Resuelve la foto de PORTADA (fallback 1ª) de cada vehículo a URL firmada. */
  private resolverFotosLista(vehiculos: Vehiculo[]) {
    for (const v of vehiculos) {
      const first = v.foto_portada ?? v.fotos?.[0];
      if (!first) continue;
      // Y6 — la card se renderiza a ≥280 CSS px (grid minmax(280px,1fr)); a DPR 2
      // necesita ~800px. Antes pedía 320 → borroso (regresión W9). Sin upscaling
      // porque la original de cámara siempre supera 800px.
      this.vehiculosService.getFotoUrl(first, { width: 800, quality: 75 }).then((url) => {
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
  onUsoChange(value: string) { this.selectedUso.set(value); }

  /** Exporta los vehículos filtrados a Excel. */
  async exportar() {
    const rows = this.filtered().map((v) => ({
      Placa: v.placa,
      VIN: v.vin ?? '',
      Tipo: this.getTipoLabel(v.tipo),
      Marca: v.marca,
      Modelo: v.modelo,
      Año: v.anio,
      Estado: this.ESTADOS.find((e) => e.value === v.estado)?.label ?? v.estado,
      Uso: this.usoLabel(v.uso),
      Medida: v.medida_uso === 'horas' ? 'Horas' : 'Km',
      Lectura: v.kilometraje,
      'Nº matrícula': v.numero_matricula ?? '',
      'Nº seguro': v.numero_seguro ?? '',
      Aseguradora: v.aseguradora ?? '',
      Activo: v.activo ? 'Sí' : 'No',
    }));
    await exportarExcel('vehiculos', rows);
  }

  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.resetFotos([], null);
    this.form.reset({
      tipo: 'camion', estado: 'activo', uso: 'obra', medida_uso: 'km',
      kilometraje: 0, anio: new Date().getFullYear(), intervalo_mantenimiento_km: 5000,
      aseguradoraSel: 'Seguros Universal', es_prueba: false,
    });
    this.drawerOpen.set(true);
  }

  openEdit(vehiculo: Vehiculo) {
    this.editingId.set(vehiculo.id);
    this.saveError.set('');
    this.resetFotos(vehiculo.fotos ?? [], vehiculo.foto_portada ?? null);
    // AA18.2/4 — resolver color/aseguradora al par (select, "Otro"+input).
    const color = vehiculo.color ?? null;
    const colorEnLista = color != null && this.COLORES.includes(color);
    const aseg = vehiculo.aseguradora ?? null;
    const asegEnLista = aseg != null && this.ASEGURADORAS.includes(aseg);
    this.form.reset({
      placa: vehiculo.placa,
      vin: vehiculo.vin,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      anio: vehiculo.anio,
      tipo: vehiculo.tipo,
      estado: vehiculo.estado,
      uso: vehiculo.uso ?? 'obra',
      medida_uso: vehiculo.medida_uso ?? 'km',
      colorSel: color == null ? null : colorEnLista ? color : 'Otro',
      colorOtro: color != null && !colorEnLista ? color : null,
      kilometraje: vehiculo.kilometraje,
      capacidad_valor: vehiculo.capacidad_valor,
      capacidad_unidad: vehiculo.capacidad_unidad,
      notas: vehiculo.notas,
      numero_matricula: vehiculo.numero_matricula,
      numero_seguro: vehiculo.numero_seguro,
      aseguradoraSel: aseg == null ? null : asegEnLista ? aseg : 'Otro',
      aseguradoraOtro: aseg != null && !asegEnLista ? aseg : null,
      vencimiento_matricula: vehiculo.vencimiento_matricula,
      vencimiento_seguro: vehiculo.vencimiento_seguro,
      km_ultimo_mantenimiento: vehiculo.km_ultimo_mantenimiento,
      intervalo_mantenimiento_km: vehiculo.intervalo_mantenimiento_km ?? 5000,
      intervalo_mantenimiento_horas: vehiculo.intervalo_mantenimiento_horas,
      rendimiento_esperado_km_gal: vehiculo.rendimiento_esperado_km_gal,
      es_prueba: vehiculo.es_prueba ?? false,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
    this.revokePreviews();
  }

  // ── Photos ───────────────────────────────────────────────
  private resetFotos(existing: string[], portada: string | null) {
    this.revokePreviews();
    this.originalFotos = [...existing];
    this.fotoPaths.set([...existing]);
    this.fotoFiles.set([]);
    this.fotoUrls.set({});
    // AA19 — portada: la guardada si sigue en la lista, si no la primera.
    this.fotoPortada.set(portada && existing.includes(portada) ? portada : existing[0] ?? null);
    for (const path of existing) {
      this.vehiculosService.getFotoUrl(path).then((url) => {
        if (url) this.fotoUrls.update((m) => ({ ...m, [path]: url }));
      });
    }
  }

  // ── AA19 — reordenar + portada ────────────────────────────
  /** Mueve una foto EXISTENTE una posición (dir -1 = arriba, +1 = abajo). */
  moverFoto(index: number, dir: -1 | 1) {
    this.fotoPaths.update((list) => {
      const next = [...list];
      const j = index + dir;
      if (j < 0 || j >= next.length) return list;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  /** Marca una foto (existente por path, o pendiente por preview) como portada. */
  usarComoPortada(key: string) {
    this.fotoPortada.set(key);
  }

  esPortada(key: string): boolean {
    return this.fotoPortada() === key;
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
      if (target) {
        URL.revokeObjectURL(target.preview);
        if (this.fotoPortada() === target.preview) this.fotoPortada.set(this.fotoPaths()[0] ?? null);
      }
      return list.filter((_, i) => i !== index);
    });
  }

  removeExistingFoto(path: string) {
    this.fotoPaths.update((list) => list.filter((p) => p !== path));
    // AA19 — si era la portada, cae a la primera restante.
    if (this.fotoPortada() === path) this.fotoPortada.set(this.fotoPaths()[0] ?? null);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const raw = this.form.value;
    // Normalize plate (uppercase, trimmed, single spaces) so "a123bc" and
    // "A123 BC" don't become two different vehicles. V1 — VIN igual (mayúsculas,
    // sin espacios) para que el índice único case-insensitive sea consistente.
    const vin = (raw.vin ?? '').trim().toUpperCase().replace(/\s+/g, '');
    // AA18.2/4 — resolver color/aseguradora del par (select, "Otro"+input).
    const color = raw.colorSel === 'Otro' ? (raw.colorOtro?.trim() || null) : (raw.colorSel || null);
    const aseguradora = raw.aseguradoraSel === 'Otro'
      ? (raw.aseguradoraOtro?.trim() || null)
      : (raw.aseguradoraSel || null);
    // Descartar los controles auxiliares que no son columnas reales.
    const { colorSel: _c, colorOtro: _co, aseguradoraSel: _a, aseguradoraOtro: _ao, ...rest } = raw;
    const payload = {
      ...rest,
      placa: (raw.placa ?? '').trim().toUpperCase().replace(/\s+/g, ' '),
      vin: vin || null,
      color,
      aseguradora,
      // AA18.3 — para vehículos por km, no arrastrar el intervalo de horas.
      intervalo_mantenimiento_horas: raw.medida_uso === 'horas' ? raw.intervalo_mantenimiento_horas : null,
    } as VehiculoFormData;

    // X14 — al marcar un vehículo existente como prueba, avisar cuántos
    // registros relacionados se marcarán también (checklists, echadas, etc.).
    const idEdit = this.editingId();
    if (idEdit && payload.es_prueba) {
      const n = await this.datosPrueba.contarDerivados('vehiculos', idEdit, true);
      if (n > 0 && !confirm(`Esto también marcará como prueba ${n} registro(s) relacionado(s) (checklists, echadas, entregas, mantenimientos…). ¿Continuar?`)) {
        this.saving.set(false);
        return;
      }
    }

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
      // AA19 — mapear el preview de cada pendiente a su path subido, para poder
      // resolver la portada aunque el usuario la haya elegido antes de subir.
      const uploaded: string[] = [];
      const previewToPath: Record<string, string> = {};
      for (const pending of this.fotoFiles()) {
        try {
          const path = await this.vehiculosService.uploadFoto(saved.id, pending.file);
          uploaded.push(path);
          previewToPath[pending.preview] = path;
        } catch {
          this.toast.warning('Foto no subida', `No se pudo subir "${pending.file.name}".`);
        }
      }

      const finalFotos = [...this.fotoPaths(), ...uploaded];
      // AA19 — portada final: si apuntaba a una pendiente, usar su path subido;
      // si sigue siendo válida, mantenerla; si no, la primera.
      const portadaSel = this.fotoPortada();
      let finalPortada: string | null = null;
      if (portadaSel && previewToPath[portadaSel]) finalPortada = previewToPath[portadaSel];
      else if (portadaSel && finalFotos.includes(portadaSel)) finalPortada = portadaSel;
      else finalPortada = finalFotos[0] ?? null;

      const changed =
        finalFotos.length !== this.originalFotos.length ||
        finalFotos.some((p, i) => p !== this.originalFotos[i]) ||
        finalPortada !== (saved.foto_portada ?? null);
      if (changed) {
        try {
          await this.vehiculosService.setFotos(saved.id, finalFotos, finalPortada);
          saved = { ...saved, fotos: finalFotos, foto_portada: finalPortada };
        } catch {
          this.toast.warning('Fotos no guardadas', 'El vehículo se guardó, pero las fotos no.');
        }
      } else {
        saved = { ...saved, fotos: finalFotos, foto_portada: finalPortada };
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

  /** T2 — elimina definitivamente una fila de datos de prueba (solo admin). */
  async eliminarPrueba(v: Vehiculo) {
    if (!this.esAdmin() || !v.es_prueba) return;
    if (!confirm(`¿Eliminar el dato de prueba "${v.placa}"? Esta acción no se puede deshacer.`)) return;
    try {
      const ok = await this.vehiculosService.eliminarDatoPrueba(v.id);
      if (!ok) {
        this.toast.warning('No eliminado', 'La fila no es un dato de prueba.');
        return;
      }
      this.vehiculos.update((list) => list.filter((x) => x.id !== v.id));
      this.toast.success('Dato de prueba eliminado', `Se eliminó "${v.placa}".`);
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
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

  /** P6 — badge reconciliado: si está desactivado, manda "Desactivado". */
  vehiculoBadge(v: Vehiculo): string {
    return v.activo ? this.getEstadoBadge(v.estado) : 'neutral';
  }
  vehiculoEstadoLabel(v: Vehiculo): string {
    if (!v.activo) return 'Desactivado';
    return v.estado === 'activo'
      ? 'Activo'
      : v.estado === 'mantenimiento'
        ? 'Mantenimiento'
        : v.estado === 'no_disponible'
          ? 'No disponible'
          : 'Baja';
  }

  // ── Vencimientos / mantenimiento (badges derivados) ──────
  vencMeta(fecha: string | null | undefined): { label: string; badge: string } | null {
    const est = estadoVencimiento(fecha);
    return est ? { label: VENCIMIENTO_LABEL[est], badge: VENCIMIENTO_BADGE[est] } : null;
  }
  proximoMant = proximoMantenimientoKm;
  kmFaltanMant = kmFaltanMantenimiento;

  /** Estado de mantenimiento (km u horas) para el badge de la lista. AA18.3. */
  mantMeta(v: Vehiculo): { label: string; badge: string } | null {
    const faltan = kmFaltanMantenimiento(v);
    if (faltan == null) return null;
    // Umbral de pre-cita según la unidad del vehículo (25 h por defecto para horómetro).
    const umbral = v.medida_uso === 'horas' ? 25 : this.flotaConfig.umbralPrecitaKm();
    if (faltan <= 0) return { label: 'Mant. vencido', badge: 'danger' };
    if (faltan <= umbral) return { label: 'Agendar pre-cita', badge: 'warning' };
    return { label: 'Mant. al día', badge: 'success' };
  }

  get f() { return this.form.controls; }
}
