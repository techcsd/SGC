import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
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

  // Default view: Santo Domingo, DR.
  private readonly DEFAULT: L.LatLngTuple = [18.4861, -69.9312];

  direccion = signal('');
  buscando = signal(false);
  resultados = signal<LugarBusqueda[]>([]);

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

    // Leaflet sometimes needs a nudge when created inside a drawer that animates in.
    setTimeout(() => this.map?.invalidateSize(), 200);
  }

  ngOnDestroy() {
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

  async onBuscar(texto: string) {
    if (!texto.trim()) {
      this.resultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      this.resultados.set(await this.geocoding.buscar(texto));
    } finally {
      this.buscando.set(false);
    }
  }

  seleccionarResultado(r: LugarBusqueda) {
    this.resultados.set([]);
    this.direccion.set(r.nombre);
    this.map?.setView([r.latitud, r.longitud], 16);
    void this.setMarker(r.latitud, r.longitud, false);
    this.ubicacionChange.emit({ latitud: r.latitud, longitud: r.longitud, direccion: r.nombre });
  }
}
