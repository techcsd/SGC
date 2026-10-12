import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  viewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { GeocodingService } from '../geocoding.service';
import { PlacesService, PlacePrediction } from '../places.service';
import { GoogleMapsLoader } from '../google-maps-loader.service';
import { pinIcon } from '../google-maps-marker.util';
import { SupabaseService } from '../../../app/core/services/supabase.service';

export interface UbicacionSeleccionada {
  latitud: number;
  longitud: number;
  direccion: string;
}

// AO1/AO2 — Selector de ubicación sobre Google Maps. La búsqueda usa Google Places
// (edge places-search, key de servidor): cualquier lugar registrado en Google aparece
// y al elegir se pinea solo. El pin manual (clic en el mapa) y pegar link/coordenadas
// quedan como fallback. El resto de la app solo recibe {lat, lng, address}.
@Component({
  selector: 'app-location-picker',
  imports: [],
  templateUrl: './location-picker.html',
  styleUrl: './location-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationPicker implements AfterViewInit, OnDestroy {
  private geocoding = inject(GeocodingService);
  private places = inject(PlacesService);
  private loader = inject(GoogleMapsLoader);
  private supabase = inject(SupabaseService);

  latitud = input<number | null>(null);
  longitud = input<number | null>(null);
  /** CN1 — con un punto elegido, el selector se pliega a una fila (icono + nombre + ✓ +
   *  "Cambiar") para sacar el mapa de la vista. `false` lo deja siempre abierto. */
  plegable = input<boolean>(true);
  ubicacionChange = output<UbicacionSeleccionada>();

  /** CN1 — ¿plegado ahora mismo? */
  colapsado = signal(false);
  /** ¿Hay un punto elegido (para mostrar la fila plegada)? */
  tienePunto = computed(() => !!this.direccion() || (this.latitud() != null && this.longitud() != null));
  /** Etiqueta de la fila plegada: la dirección o las coordenadas. */
  etiquetaPunto = computed(() => {
    const d = this.direccion();
    if (d) return d;
    const la = this.latitud(); const lo = this.longitud();
    return la != null && lo != null ? `${la.toFixed(5)}, ${lo.toFixed(5)}` : '';
  });

  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private map: google.maps.Map | null = null;
  private marker: google.maps.Marker | null = null;
  private resizeObs: ResizeObserver | null = null;

  // Vista por defecto: Santo Domingo, RD.
  private readonly DEFAULT = { lat: 18.4861, lng: -69.9312 };

  direccion = signal('');
  buscando = signal(false);
  resultados = signal<PlacePrediction[]>([]);
  busquedaError = signal('');
  mapError = signal('');

  // AM7 — pegar link de Google Maps (incl. cortos maps.app.goo.gl) o coordenadas.
  resolviendoLink = signal(false);
  linkError = signal('');

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchAbort: AbortController | null = null;

  constructor() {
    // Reaccionar a cambios de los inputs lat/lng tras init (ubicación actual, edición,
    // selección de obra/almacén): mover el mapa y el marcador.
    effect(() => {
      const lat = this.latitud();
      const lng = this.longitud();
      if (this.map && lat != null && lng != null) {
        this.map.setCenter({ lat, lng });
        this.map.setZoom(15);
        void this.setMarker(lat, lng, false);
        // CN1 — un punto fijado por el padre (obra/almacén, "usar mi ubicación", edición)
        // también pliega el selector.
        if (this.plegable()) this.colapsado.set(true);
      }
    });
  }

  /** CN1 — pliega el selector si está activo el modo plegable. */
  private colapsarSiElegido() {
    if (this.plegable()) this.colapsado.set(true);
  }

  /** CN1 — "Cambiar": vuelve a abrir el mapa y recalcula su tamaño tras la transición. */
  cambiar() {
    this.colapsado.set(false);
    setTimeout(() => this.refrescar(), 240);
  }

  async ngAfterViewInit() {
    const lat = this.latitud();
    const lng = this.longitud();
    const center = lat != null && lng != null ? { lat, lng } : this.DEFAULT;

    try {
      await this.loader.load();
    } catch (e) {
      this.mapError.set((e as Error)?.message ?? 'Mapa no disponible.');
      return;
    }
    if (!this.mapEl()) return;

    this.map = new google.maps.Map(this.mapEl().nativeElement, {
      center,
      zoom: lat != null ? 15 : 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });

    if (lat != null && lng != null) {
      void this.setMarker(lat, lng, false);
      // CN1 — editar con un punto ya elegido arranca plegado.
      if (this.plegable()) this.colapsado.set(true);
    }

    this.map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) void this.setMarker(e.latLng.lat(), e.latLng.lng(), true);
    });

    // El drawer anima ~220ms; un ResizeObserver dispara un resize del mapa cuando el
    // contenedor cambia de tamaño (evita el mapa gris/descentrado).
    this.resizeObs = new ResizeObserver(() => {
      if (this.map) google.maps.event.trigger(this.map, 'resize');
    });
    this.resizeObs.observe(this.mapEl().nativeElement);
  }

  /** Fuerza recálculo del tamaño (llamar al abrir el contenedor/tab). */
  refrescar() {
    if (this.map) google.maps.event.trigger(this.map, 'resize');
  }

  ngOnDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.marker?.setMap(null);
    this.marker = null;
    this.map = null;
  }

  private async setMarker(lat: number, lng: number, emitAndGeocode: boolean) {
    if (!this.map) return;
    const position = { lat, lng };
    if (this.marker) {
      this.marker.setPosition(position);
    } else {
      this.marker = new google.maps.Marker({ position, map: this.map, icon: pinIcon('#ff5f00') });
    }
    if (emitAndGeocode) {
      const dir = await this.geocoding.reverse({ latitud: lat, longitud: lng });
      this.direccion.set(dir);
      this.ubicacionChange.emit({ latitud: lat, longitud: lng, direccion: dir });
      this.colapsarSiElegido();
    }
  }

  /** Autocompletar con Google Places (debounce + cancelación de peticiones obsoletas). */
  onBuscar(texto: string) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.busquedaError.set('');
    const q = texto.trim();
    if (q.length < 2) {
      this.resultados.set([]);
      this.buscando.set(false);
      return;
    }
    this.buscando.set(true);
    this.searchTimer = setTimeout(() => void this.ejecutarBusqueda(q), 300);
  }

  private async ejecutarBusqueda(q: string) {
    this.searchAbort?.abort();
    const ac = new AbortController();
    this.searchAbort = ac;
    try {
      const res = await this.places.autocomplete(q, ac.signal);
      if (ac.signal.aborted) return;
      this.resultados.set(res);
      if (res.length === 0) {
        this.busquedaError.set('Sin resultados. Prueba otro nombre o marca el punto en el mapa.');
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      this.resultados.set([]);
      this.busquedaError.set('No se pudo buscar ahora. Reintenta o marca el punto en el mapa.');
    } finally {
      if (!ac.signal.aborted) this.buscando.set(false);
    }
  }

  /** AM7 — resolver un link de Google Maps o coordenadas pegadas a un pin. */
  async resolverLink(texto: string) {
    const q = (texto ?? '').trim();
    this.linkError.set('');
    if (!q) return;
    this.resolviendoLink.set(true);
    try {
      const { data, error } = await this.supabase.client.functions.invoke('resolve-maps-link', {
        body: { url: q },
      });
      const lat = data?.lat;
      const lng = data?.lng;
      if (error || data?.error || typeof lat !== 'number' || typeof lng !== 'number') {
        // BK2/AU16 — el link apunta a un lugar sin coords exactas pero el edge
        // devolvió su nombre: salir del "modo link" y prellenar la búsqueda con
        // ese texto (mismo comportamiento que el lugar-picker de la app).
        const sugerido = data?.suggest_query as string | undefined;
        if (sugerido) {
          const el = this.searchInput()?.nativeElement;
          if (el) el.value = sugerido;
          this.linkError.set('El link apunta a un lugar sin coordenadas exactas. Lo busqué por su nombre — elige el resultado o marca el punto en el mapa.');
          this.onBuscar(sugerido);
          return;
        }
        this.linkError.set(data?.error || 'No se pudo resolver ese link. Pega el enlace de Google Maps o las coordenadas (ej. 18.56, -68.37).');
        return;
      }
      const dir = data?.resolved_url ? '' : `${lat}, ${lng}`;
      this.direccion.set(dir);
      this.map?.setCenter({ lat, lng });
      this.map?.setZoom(16);
      void this.setMarker(lat, lng, false);
      this.ubicacionChange.emit({ latitud: lat, longitud: lng, direccion: dir });
      this.colapsarSiElegido();
    } catch {
      this.linkError.set('No se pudo resolver el link ahora. Reintenta o marca el punto en el mapa.');
    } finally {
      this.resolviendoLink.set(false);
    }
  }

  async seleccionarResultado(r: PlacePrediction) {
    this.resultados.set([]);
    this.busquedaError.set('');
    const detalle = await this.places.details(r.placeId);
    if (!detalle) {
      this.busquedaError.set('No se pudo obtener ese lugar. Prueba otro o marca el punto en el mapa.');
      return;
    }
    const dir = detalle.address || detalle.name || r.description;
    this.direccion.set(dir);
    this.map?.setCenter({ lat: detalle.lat, lng: detalle.lng });
    this.map?.setZoom(16);
    void this.setMarker(detalle.lat, detalle.lng, false);
    this.ubicacionChange.emit({ latitud: detalle.lat, longitud: detalle.lng, direccion: dir });
    this.colapsarSiElegido();
  }
}
