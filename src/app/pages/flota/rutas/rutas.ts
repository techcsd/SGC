import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RutasService } from '../../../../shared/services/rutas.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { Ruta, RutaFormData, RutaEstado, RUTA_ESTADOS, destinoCoords } from '../../../../shared/models/ruta.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { VehiculoPicker } from '../../../../shared/components/vehiculo-picker/vehiculo-picker';
import { WeatherCard } from '../../../../shared/context/weather-card/weather-card';
import { LocationPicker, UbicacionSeleccionada } from '../../../../shared/context/location-picker/location-picker';
import { RoutingService } from '../../../../shared/context/routing.service';
import { GeocodingService } from '../../../../shared/context/geocoding.service';
import { RutasClimaService, RutaClima } from '../../../../shared/context/rutas-clima.service';
import { formatFechaDisplay, formatearDuracion, todayIso } from '../../../../shared/utils/fecha.util';
import { Paginator } from '../../../../shared/ui/paginator/paginator';

type ObraDestino = Pick<Proyecto, 'id' | 'codigo' | 'nombre' | 'latitud' | 'longitud'>;

@Component({
  selector: 'app-rutas',
  imports: [ReactiveFormsModule, FormDrawer, WeatherCard, LocationPicker, VehiculoPicker, Skeleton, Paginator],
  templateUrl: './rutas.html',
  styleUrl: './rutas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Rutas implements OnInit {
  formatFecha = formatFechaDisplay;
  formatDur = formatearDuracion; // U23 — duración legible ("1 h 28 min")

  private route = inject(ActivatedRoute);
  private rutasService = inject(RutasService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private proyectosService = inject(ProyectosService);
  private bodegasService = inject(BodegasService);
  private rutasClima = inject(RutasClimaService);
  private routingService = inject(RoutingService);
  private geocoding = inject(GeocodingService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private datosPrueba = inject(DatosPruebaService);

  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  mostrarPrueba = signal(false);

  // ── Data state ──────────────────────────────────────────
  rutas = signal<Ruta[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
  obrasDestino = signal<ObraDestino[]>([]);
  /** U22 — almacenes con coordenadas, usables como origen/destino. */
  almacenes = signal<Bodega[]>([]);
  rutasClimaMap = signal<Map<string, RutaClima>>(new Map());
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Destination weather (drawer) ─────────────────────────
  private destinoProyectoId = signal<string | null>(null);
  private destinoLat = signal<number | null>(null);
  private destinoLng = signal<number | null>(null);
  private formFecha = signal<string>('');
  drawerClima = signal<RutaClima | null>(null);

  // ── Origin + auto route estimate (drawer) ────────────────
  private origenLat = signal<number | null>(null);
  private origenLng = signal<number | null>(null);
  calculandoRuta = signal(false);
  autoEstimado = signal(false);

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedEstado = signal('');

  readonly RUTA_ESTADOS = RUTA_ESTADOS;
  readonly today = todayIso();

  // ── Create/edit drawer ────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  // ── R3 — Detalle de ruta (read-only) ─────────────────────
  detailOpen = signal(false);
  detailRuta = signal<Ruta | null>(null);
  /** Coordenadas del destino de la ruta en detalle (para mini-mapa + clima). */
  detailDestino = computed(() => {
    const r = this.detailRuta();
    return r ? destinoCoords(r) : null;
  });

  openDetail(r: Ruta) {
    this.detailRuta.set(r);
    this.detailOpen.set(true);
  }
  closeDetail() {
    this.detailOpen.set(false);
  }

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca o desmarca una ruta como dato de prueba. */
  async marcarPrueba(r: Ruta, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar('rutas', r.id, valor);
      this.rutas.update((list) => list.map((x) => (x.id === r.id ? { ...x, es_prueba: valor } : x)));
      this.detailRuta.update((d) => (d && d.id === r.id ? { ...d, es_prueba: valor } : d));
      this.toast.success(valor ? 'Marcado como dato de prueba' : 'Ya no es dato de prueba');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  /** Elimina definitivamente una ruta de prueba (solo admin). */
  async eliminarPrueba(r: Ruta) {
    if (!this.esAdmin() || !r.es_prueba) return;
    if (!confirm('¿Eliminar este dato de prueba? Esta acción no se puede deshacer.')) return;
    try {
      await this.datosPrueba.eliminar('rutas', r.id);
      this.rutas.update((list) => list.filter((x) => x.id !== r.id));
      this.detailOpen.set(false);
      this.toast.success('Dato de prueba eliminado');
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    origen: new FormControl('', [Validators.required]),
    destino: new FormControl('', [Validators.required]),
    origen_lat: new FormControl<number | null>(null),
    origen_lng: new FormControl<number | null>(null),
    destino_proyecto_id: new FormControl<string | null>(null),
    destino_lat: new FormControl<number | null>(null),
    destino_lng: new FormControl<number | null>(null),
    fecha: new FormControl(this.today, [Validators.required]),
    km_estimado: new FormControl<number | null>(null, [Validators.min(0)]),
    tiempo_estimado_min: new FormControl<number | null>(null, [Validators.min(0)]),
    estado: new FormControl<RutaEstado>('planificada', [Validators.required]),
    notas: new FormControl<string | null>(null),
  });

  constructor() {
    // Keep the drawer's destination weather in sync with the picked obra/point + date.
    effect(() => {
      const coords = this.drawerDestinoCoords();
      const fecha = this.formFecha();
      if (!this.drawerOpen() || !coords || !fecha) {
        this.drawerClima.set(null);
        return;
      }
      void this.cargarDrawerClima(coords.latitud, coords.longitud, fecha);
    });
  }

  // ── Registrar real drawer ──────────────────────────────────
  registrarDrawerOpen = signal(false);
  registrarTarget = signal<Ruta | null>(null);
  registrarForm = new FormGroup({
    km_real: new FormControl<number | null>(null, [Validators.min(0)]),
    tiempo_real_min: new FormControl<number | null>(null, [Validators.min(0)]),
    estado: new FormControl<RutaEstado>('completada', [Validators.required]),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    // T2 — admin: oculta datos de prueba salvo que active el toggle (no-admin nunca los recibe).
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.rutas().filter((r) => {
      if (r.es_prueba && !verPrueba) return false;
      if (
        q &&
        !r.origen.toLowerCase().includes(q) &&
        !r.destino.toLowerCase().includes(q) &&
        !(r.vehiculo?.placa ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (estado && r.estado !== estado) return false;
      return true;
    });
  });

  page = signal(1);
  readonly PAGE_SIZE = 20;
  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  // QA-001 — un vehículo dado de baja o no disponible no puede asignarse a una ruta.
  activeVehiculos = computed(() =>
    this.vehiculos().filter(
      (v) => v.activo && v.estado !== 'no_disponible' && v.estado !== 'baja',
    ),
  );
  activeConductores = computed(() => this.conductores().filter((c) => c.activo));

  private obrasMap = computed(() => new Map(this.obrasDestino().map((o) => [o.id, o])));

  /** Destination coordinates currently selected in the drawer (obra wins over point). */
  drawerDestinoCoords = computed<{ latitud: number; longitud: number } | null>(() => {
    const pid = this.destinoProyectoId();
    if (pid) {
      const o = this.obrasMap().get(pid);
      if (o?.latitud != null && o?.longitud != null) return { latitud: o.latitud, longitud: o.longitud };
    }
    const lat = this.destinoLat();
    const lng = this.destinoLng();
    if (lat != null && lng != null) return { latitud: lat, longitud: lng };
    return null;
  });

  drawerTitle = computed(() => (this.editingId() ? 'Editar ruta' : 'Planificar ruta'));
  obraSeleccionada = computed(() => !!this.destinoProyectoId());

  private async cargarDrawerClima(latitud: number, longitud: number, fecha: string) {
    try {
      this.drawerClima.set(await this.rutasClima.getClimaDestino({ latitud, longitud }, fecha));
    } catch {
      this.drawerClima.set(null);
    }
  }

  async ngOnInit() {
    await this.loadAll();
    // S16 — deep-link desde la notificación de ruta asignada (?item=): abre el detalle.
    const item = this.route.snapshot.queryParamMap.get('item');
    if (item) {
      const r = this.rutas().find((x) => x.id === item);
      if (r) this.openDetail(r);
    }
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [rutas, vehiculos, conductores, obras, bodegas] = await Promise.all([
        this.rutasService.getAll(),
        this.vehiculosService.getAll(),
        this.conductoresService.getAll(),
        this.proyectosService.getActivasConUbicacion(),
        this.bodegasService.getAll(),
      ]);
      this.rutas.set(rutas);
      this.vehiculos.set(vehiculos);
      this.conductores.set(conductores);
      this.obrasDestino.set(obras as ObraDestino[]);
      this.almacenes.set(bodegas.filter((b) => b.latitud != null && b.longitud != null && b.activo));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los datos.');
    } finally {
      this.loading.set(false);
    }
    // Weather-at-destination for upcoming trips — best-effort, after the list shows.
    void this.cargarClimaRutas();
  }

  /** Trip-day weather for upcoming (not-yet-done) rutas that have a destination point. */
  private async cargarClimaRutas() {
    const hoy = this.today;
    const proximas = this.rutas()
      .filter((r) => (r.estado === 'planificada' || r.estado === 'en_curso') && r.fecha >= hoy)
      .map((r) => ({ id: r.id, coords: destinoCoords(r), fecha: r.fecha }))
      .filter((r): r is { id: string; coords: { latitud: number; longitud: number }; fecha: string } => r.coords !== null);
    if (proximas.length === 0) return;
    try {
      this.rutasClimaMap.set(await this.rutasClima.getClimaRutas(proximas));
    } catch {
      /* enrichment only */
    }
  }

  /** Advisory chip for a ruta row (null = none/favorable/past). */
  climaRuta(r: Ruta): RutaClima['recomendacion'] | null {
    return this.rutasClimaMap().get(r.id)?.recomendacion ?? null;
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
    this.page.set(1);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
    this.page.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('');
    this.page.set(1);
  }

  // ── Create/edit drawer ────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ fecha: this.today, estado: 'planificada' });
    this.origenLat.set(null);
    this.origenLng.set(null);
    this.autoEstimado.set(false);
    this.syncDestinoSignals(null, null, null, this.today);
    this.drawerOpen.set(true);
  }

  openEdit(r: Ruta) {
    this.editingId.set(r.id);
    this.saveError.set('');
    this.form.reset({
      vehiculo_id: r.vehiculo_id,
      conductor_id: r.conductor_id,
      origen: r.origen,
      destino: r.destino,
      origen_lat: r.origen_lat ?? null,
      origen_lng: r.origen_lng ?? null,
      destino_proyecto_id: r.destino_proyecto_id,
      destino_lat: r.destino_lat,
      destino_lng: r.destino_lng,
      fecha: r.fecha,
      km_estimado: r.km_estimado,
      tiempo_estimado_min: r.tiempo_estimado_min,
      estado: r.estado,
      notas: r.notas,
    });
    this.origenLat.set(r.origen_lat ?? null);
    this.origenLng.set(r.origen_lng ?? null);
    this.autoEstimado.set(false);
    this.syncDestinoSignals(r.destino_proyecto_id, r.destino_lat, r.destino_lng, r.fecha);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  private syncDestinoSignals(pid: string | null, lat: number | null, lng: number | null, fecha: string) {
    this.destinoProyectoId.set(pid);
    this.destinoLat.set(lat);
    this.destinoLng.set(lng);
    this.formFecha.set(fecha);
  }

  // ── Origin selection + auto route estimate ───────────────
  onOrigenPicked(u: UbicacionSeleccionada) {
    this.form.patchValue({ origen_lat: u.latitud, origen_lng: u.longitud });
    this.origenLat.set(u.latitud);
    this.origenLng.set(u.longitud);
    if (u.direccion) {
      this.form.patchValue({ origen: u.direccion });
    }
    void this.recalcularRuta();
  }

  /** "Usar mi ubicación actual" — geolocate the browser, set origin, then estimate. */
  usarUbicacionActual() {
    if (!('geolocation' in navigator)) {
      this.saveError.set('Tu navegador no permite obtener la ubicación actual.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.form.patchValue({ origen_lat: lat, origen_lng: lng });
        this.origenLat.set(lat);
        this.origenLng.set(lng);
        const dir = await this.geocoding.reverse({ latitud: lat, longitud: lng });
        if (dir) this.form.patchValue({ origen: dir });
        void this.recalcularRuta();
      },
      () => {
        this.saveError.set('No se pudo obtener tu ubicación actual. Marca el origen en el mapa.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  /**
   * Auto-fill km/tiempo from the map (OSRM) whenever both origin and destination
   * points are known. Fields stay editable — this only patches the estimate.
   */
  async recalcularRuta() {
    const oLat = this.origenLat();
    const oLng = this.origenLng();
    const dest = this.drawerDestinoCoords();
    if (oLat == null || oLng == null || !dest) return;

    this.calculandoRuta.set(true);
    try {
      const res = await this.routingService.calcular(oLat, oLng, dest.latitud, dest.longitud);
      if (res) {
        this.form.patchValue({
          km_estimado: res.distancia_km,
          tiempo_estimado_min: res.duracion_min,
        });
        this.autoEstimado.set(true);
      }
    } finally {
      this.calculandoRuta.set(false);
    }
  }

  // ── Destination selection ────────────────────────────────
  onObraChange(proyectoId: string) {
    const id = proyectoId || null;
    // Picking an obra takes over the destination point; clear any manual point.
    this.form.patchValue({ destino_proyecto_id: id, destino_lat: null, destino_lng: null });
    this.destinoProyectoId.set(id);
    this.destinoLat.set(null);
    this.destinoLng.set(null);
    if (id) {
      const o = this.obrasMap().get(id);
      if (o && !this.form.controls.destino.value?.trim()) {
        this.form.patchValue({ destino: o.nombre });
      }
    }
    void this.recalcularRuta();
  }

  onDestinoPicked(u: UbicacionSeleccionada) {
    // A manual map point clears the obra link.
    this.form.patchValue({ destino_lat: u.latitud, destino_lng: u.longitud, destino_proyecto_id: null });
    this.destinoLat.set(u.latitud);
    this.destinoLng.set(u.longitud);
    this.destinoProyectoId.set(null);
    if (!this.form.controls.destino.value?.trim() && u.direccion) {
      this.form.patchValue({ destino: u.direccion });
    }
    void this.recalcularRuta();
  }

  onFechaChange(fecha: string) {
    this.formFecha.set(fecha);
  }

  // ── U22 — origen/destino desde una obra o un almacén del sistema ──────────
  private coordsDeLugar(v: string): { lat: number; lng: number; label: string } | null {
    const [kind, id] = v.split(':');
    if (kind === 'obra') {
      const o = this.obrasMap().get(id);
      if (o?.latitud != null && o?.longitud != null) return { lat: o.latitud, lng: o.longitud, label: o.nombre };
    } else if (kind === 'alm') {
      const b = this.almacenes().find((x) => x.id === id);
      if (b?.latitud != null && b?.longitud != null) return { lat: b.latitud, lng: b.longitud, label: b.nombre };
    }
    return null;
  }

  onOrigenLugar(v: string) {
    const c = v ? this.coordsDeLugar(v) : null;
    if (!c) return;
    this.form.patchValue({ origen_lat: c.lat, origen_lng: c.lng, origen: c.label });
    this.origenLat.set(c.lat);
    this.origenLng.set(c.lng);
    void this.recalcularRuta();
  }

  onDestinoLugar(v: string) {
    if (!v) return;
    if (v.startsWith('obra:')) {
      this.onObraChange(v.slice(5));
      return;
    }
    const c = this.coordsDeLugar(v);
    if (!c) return;
    // Almacén = punto de destino (no hay link de proyecto).
    this.form.patchValue({ destino_lat: c.lat, destino_lng: c.lng, destino_proyecto_id: null, destino: c.label });
    this.destinoLat.set(c.lat);
    this.destinoLng.set(c.lng);
    this.destinoProyectoId.set(null);
    void this.recalcularRuta();
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.value as RutaFormData;
    const userId = this.userService.profile()?.id ?? null;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.rutasService.update(id, payload);
        this.rutas.update((list) => list.map((r) => (r.id === id ? updated : r)));
      } else {
        const created = await this.rutasService.create(payload, userId);
        this.rutas.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
      void this.cargarClimaRutas();
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  nivelClima(nivel: string): string {
    return nivel === 'peligro' ? 'clima-chip--peligro' : 'clima-chip--precaucion';
  }

  // ── Registrar real (actual km/time) ───────────────────────
  openRegistrar(r: Ruta) {
    this.registrarTarget.set(r);
    this.saveError.set('');
    this.registrarForm.reset({
      km_real: r.km_real ?? r.km_estimado,
      tiempo_real_min: r.tiempo_real_min ?? r.tiempo_estimado_min,
      estado: 'completada',
    });
    this.registrarDrawerOpen.set(true);
  }

  closeRegistrar() {
    this.registrarDrawerOpen.set(false);
    this.registrarTarget.set(null);
  }

  async onSaveRegistrar() {
    const target = this.registrarTarget();
    if (!target || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const v = this.registrarForm.value;

    try {
      const updated = await this.rutasService.registrarReal(target.id, {
        km_real: v.km_real ?? null,
        tiempo_real_min: v.tiempo_real_min ?? null,
        estado: v.estado ?? 'completada',
      });
      this.rutas.update((list) => list.map((r) => (r.id === target.id ? updated : r)));
      this.closeRegistrar();
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getEstadoInfo(estado: RutaEstado) {
    return RUTA_ESTADOS.find((e) => e.value === estado);
  }

  kmDesvio(r: Ruta): number | null {
    if (r.km_real == null || r.km_estimado == null) return null;
    return r.km_real - r.km_estimado;
  }

  tiempoDesvio(r: Ruta): number | null {
    if (r.tiempo_real_min == null || r.tiempo_estimado_min == null) return null;
    return r.tiempo_real_min - r.tiempo_estimado_min;
  }

  get f() {
    return this.form.controls;
  }

  get rf() {
    return this.registrarForm.controls;
  }
}
