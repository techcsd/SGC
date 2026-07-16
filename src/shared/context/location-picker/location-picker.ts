import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  effect,
  viewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import * as L from 'leaflet';
import { GeocodingService, LugarBusqueda } from '../geocoding.service';

export interface UbicacionSeleccionada {
  latitud: number;
  longitud: number;
  direccion: string;
}

// Leaflet + OpenStreetMap is intentionally isolated in THIS component. The rest
// of the app only receives provider-independent {lat, lng, address}. Swapping to
// Google Maps later means rewriting only this file (and adding a key) — the
// MapsProvider boundary is the component's output contract.
@Component({
  selector: 'app-location-picker',
  imports: [],
  templateUrl: './location-picker.html',
  styleUrl: './location-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationPicker implements AfterViewInit, OnDestroy {
  private geocoding = inject(GeocodingService);

  latitud = input<number | null>(null);
  longitud = input<number | null>(null);
  ubicacionChange = output<UbicacionSeleccionada>();

  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private resizeObs: ResizeObserver | null = null;

  // Default view: Santo Domingo, DR.
  private readonly DEFAULT: L.LatLngTuple = [18.4861, -69.9312];

  direccion = signal('');
  buscando = signal(false);
  resultados = signal<LugarBusqueda[]>([]);
  busquedaError = signal('');

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchAbort: AbortController | null = null;

  constructor() {
    // U21 — reaccionar a cambios de los inputs lat/lng DESPUÉS de init (ubicación
    // actual, edición, selección de obra/almacén): mover el mapa y el marcador.
    effect(() => {
      const lat = this.latitud();
      const lng = this.longitud();
      if (this.map && lat != null && lng != null) {
        this.map.setView([lat, lng], 15);
        void this.setMarker(lat, lng, false);
      }
    });
  }

  ngAfterViewInit() {
    const lat = this.latitud();
    const lng = this.longitud();
    const center: L.LatLngTuple = lat != null && lng != null ? [lat, lng] : this.DEFAULT;

    this.map = L.map(this.mapEl().nativeElement, { center, zoom: lat != null ? 15 : 11 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);

    if (lat != null && lng != null) {
      this.setMarker(lat, lng, false);
    }

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      this.setMarker(e.latlng.lat, e.latlng.lng, true);
    });

    // U18 — el drawer anima ~220ms; recalcular tamaño DESPUÉS del transform (si no,
    // los tiles salen grises/desalineados). Un ResizeObserver reacciona a CUALQUIER
    // cambio de tamaño del contenedor (animación del drawer, apertura diferida,
    // cambio de pestaña) — más fiable que los timers sueltos.
    this.resizeObs = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObs.observe(this.mapEl().nativeElement);
    requestAnimationFrame(() => this.map?.invalidateSize());
    setTimeout(() => this.map?.invalidateSize(), 320);
  }

  /** Fuerza recálculo del tamaño (llamar al abrir el contenedor/tab). */
  refrescar() {
    this.map?.invalidateSize();
  }

  ngOnDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.map?.remove();
    this.map = null;
  }

  private customIcon(): L.DivIcon {
    // DivIcon avoids Leaflet's image assets (which break under bundlers).
    return L.divIcon({
      className: 'lp-marker',
      html: '<div class="lp-marker__pin"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 22],
    });
  }

  private async setMarker(lat: number, lng: number, emitAndGeocode: boolean) {
    if (!this.map) return;
    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
    } else {
      this.marker = L.marker([lat, lng], { icon: this.customIcon() }).addTo(this.map);
    }
    if (emitAndGeocode) {
      const dir = await this.geocoding.reverse({ latitud: lat, longitud: lng });
      this.direccion.set(dir);
      this.ubicacionChange.emit({ latitud: lat, longitud: lng, direccion: dir });
    }
  }

  /** U19 — debounce por tecleo (Nominatim limita ~1 req/s) + cancelar obsoletas. */
  onBuscar(texto: string) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.busquedaError.set('');
    const q = texto.trim();
    if (!q) {
      this.resultados.set([]);
      this.buscando.set(false);
      return;
    }
    this.buscando.set(true);
    this.searchTimer = setTimeout(() => void this.ejecutarBusqueda(q), 400);
  }

  private async ejecutarBusqueda(q: string) {
    this.searchAbort?.abort();
    const ac = new AbortController();
    this.searchAbort = ac;
    try {
      const res = await this.geocoding.buscar(q, ac.signal);
      if (ac.signal.aborted) return;
      this.resultados.set(res);
      if (res.length === 0) {
        this.busquedaError.set('Sin resultados. Prueba otro nombre o marca el punto en el mapa.');
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      this.resultados.set([]);
      this.busquedaError.set('No se pudo buscar ahora (servicio de mapas ocupado). Reintenta o marca el punto en el mapa.');
    } finally {
      if (!ac.signal.aborted) this.buscando.set(false);
    }
  }

  seleccionarResultado(r: LugarBusqueda) {
    this.resultados.set([]);
    this.busquedaError.set('');
    this.direccion.set(r.nombre);
    this.map?.setView([r.latitud, r.longitud], 16);
    void this.setMarker(r.latitud, r.longitud, false);
    this.ubicacionChange.emit({ latitud: r.latitud, longitud: r.longitud, direccion: r.nombre });
  }
}
