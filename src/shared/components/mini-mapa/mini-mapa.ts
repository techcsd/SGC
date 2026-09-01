import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  signal,
  viewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  effect,
  inject,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Icon } from '../../ui/icon/icon';
import { GoogleMapsLoader } from '../../context/google-maps-loader.service';
import { pinIcon } from '../../context/google-maps-marker.util';

// Mini-mapa de SOLO LECTURA para mostrar un punto (prueba de ubicación). Aísla el SDK
// de Google Maps; sin interacción (no drag, no zoom, no click). Si no hay coordenadas
// no renderiza; si la key de Maps no está configurada, muestra el enlace externo.
@Component({
  selector: 'app-mini-mapa',
  imports: [DecimalPipe, Icon],
  templateUrl: './mini-mapa.html',
  styleUrl: './mini-mapa.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiniMapa implements AfterViewInit, OnDestroy {
  private loader = inject(GoogleMapsLoader);

  lat = input<number | null>(null);
  lng = input<number | null>(null);

  private mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: google.maps.Map | null = null;
  private marker: google.maps.Marker | null = null;

  hasCoords = computed(() => this.lat() != null && this.lng() != null);
  mapError = signal(false);

  /** Enlace externo a Google Maps centrado en el punto. */
  verEnMapaUrl = computed(() => {
    const lat = this.lat();
    const lng = this.lng();
    if (lat == null || lng == null) return null;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  });

  constructor() {
    // Reaccionar a cambios de coords tras init (contenido perezoso al expandir).
    effect(() => {
      const lat = this.lat();
      const lng = this.lng();
      if (this.map && lat != null && lng != null) {
        const pos = { lat, lng };
        this.map.setCenter(pos);
        this.setMarker(lat, lng);
      }
    });
  }

  async ngAfterViewInit() {
    const el = this.mapEl();
    const lat = this.lat();
    const lng = this.lng();
    if (!el || lat == null || lng == null) return;

    try {
      await this.loader.load();
    } catch {
      this.mapError.set(true);
      return;
    }
    if (!this.mapEl()) return;

    this.map = new google.maps.Map(el.nativeElement, {
      center: { lat, lng },
      zoom: 16,
      disableDefaultUI: true,
      gestureHandling: 'none',
      keyboardShortcuts: false,
      clickableIcons: false,
    });
    this.setMarker(lat, lng);
  }

  private setMarker(lat: number, lng: number) {
    if (!this.map) return;
    const position = { lat, lng };
    if (this.marker) {
      this.marker.setPosition(position);
    } else {
      this.marker = new google.maps.Marker({ position, map: this.map, icon: pinIcon('#ff5f00') });
    }
  }

  ngOnDestroy() {
    this.marker?.setMap(null);
    this.marker = null;
    this.map = null;
  }
}
