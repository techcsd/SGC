import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  viewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as L from 'leaflet';

// Mini-mapa de SOLO LECTURA para mostrar un punto (prueba de ubicación). Aísla
// leaflet/OSM igual que location-picker; sin interacción (no drag, no zoom, no
// click). Si no hay coordenadas, no renderiza mapa (el padre muestra el vacío).
@Component({
  selector: 'app-mini-mapa',
  imports: [DecimalPipe],
  templateUrl: './mini-mapa.html',
  styleUrl: './mini-mapa.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiniMapa implements AfterViewInit, OnDestroy {
  lat = input<number | null>(null);
  lng = input<number | null>(null);

  private mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private resizeObs: ResizeObserver | null = null;

  hasCoords = computed(() => this.lat() != null && this.lng() != null);

  /** Enlace externo a OpenStreetMap centrado en el punto. */
  verEnMapaUrl = computed(() => {
    const lat = this.lat();
    const lng = this.lng();
    if (lat == null || lng == null) return null;
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  });

  constructor() {
    // Reaccionar a cambios de coords tras init (contenido perezoso al expandir).
    effect(() => {
      const lat = this.lat();
      const lng = this.lng();
      if (this.map && lat != null && lng != null) {
        this.map.setView([lat, lng], 16);
        this.setMarker(lat, lng);
      }
    });
  }

  ngAfterViewInit() {
    const el = this.mapEl();
    const lat = this.lat();
    const lng = this.lng();
    if (!el || lat == null || lng == null) return;

    this.map = L.map(el.nativeElement, {
      center: [lat, lng],
      zoom: 16,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(this.map);
    this.setMarker(lat, lng);

    // El contenedor puede iniciar con tamaño 0 (fila expandible / drawer animado):
    // un ResizeObserver recalcula el tamaño en cuanto el layout se asienta —
    // cura definitiva de los "tiles grises" sin depender de timers frágiles.
    this.resizeObs = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObs.observe(el.nativeElement);
    requestAnimationFrame(() => this.map?.invalidateSize());
  }

  private setMarker(lat: number, lng: number) {
    if (!this.map) return;
    const icon = L.divIcon({
      className: 'mm-marker',
      html: '<div class="mm-marker__pin"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 20],
    });
    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
    } else {
      this.marker = L.marker([lat, lng], { icon }).addTo(this.map);
    }
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.map?.remove();
    this.map = null;
  }
}
