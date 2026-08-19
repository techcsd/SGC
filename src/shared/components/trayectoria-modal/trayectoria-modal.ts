import {
  Component, ChangeDetectionStrategy, inject, signal, input, output,
  viewChild, ElementRef, effect,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SeguimientoService } from '../../services/seguimiento.service';
import { GoogleMapsLoader } from '../../context/google-maps-loader.service';
import { pinIcon } from '../../context/google-maps-marker.util';
import { MapLegend } from '../../ui/map-legend/map-legend';

/**
 * AU5 — Modal reutilizable "Ver trayectoria": replay del recorrido consolidado de
 * una ruta (ruta_trayecto / trayecto_polyline, AJ14). Se usa al completar una ruta
 * y desde el detalle de rutas finalizadas. El mapa se inicializa de forma reactiva
 * cuando su contenedor entra al DOM (mismo patrón robusto que Recorrido diario).
 */
@Component({
  selector: 'app-trayectoria-modal',
  imports: [DecimalPipe, MapLegend],
  templateUrl: './trayectoria-modal.html',
  styleUrl: './trayectoria-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrayectoriaModal {
  private svc = inject(SeguimientoService);
  private loader = inject(GoogleMapsLoader);

  rutaId = input.required<string>();
  titulo = input<string>('Trayectoria de la ruta');
  close = output<void>();

  private mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: google.maps.Map | null = null;
  private line: google.maps.Polyline | null = null;
  private markers: google.maps.Marker[] = [];
  private mapReady = false;
  private mapInitStarted = false;

  loading = signal(true);
  error = signal('');
  puntos = signal(0);
  km = signal<number | null>(null);
  private coords: [number, number][] = [];
  private snapped: [number, number][] = [];  // AV7 — coords pegadas a la calle

  constructor() {
    effect(() => {
      const el = this.mapEl();
      if (el && !this.mapInitStarted && !this.error()) {
        this.mapInitStarted = true;
        void this.initMap(el.nativeElement);
      }
    });
    // Carga el trayecto en cuanto se conoce el rutaId.
    effect(() => {
      const id = this.rutaId();
      if (id) void this.cargar(id);
    });
  }

  private async cargar(rutaId: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const t = await this.svc.getRutaTrayecto(rutaId);
      this.coords = t.coords ?? [];
      this.puntos.set(t.puntos ?? this.coords.length);
      this.km.set(t.km ?? null);
      if (this.coords.length < 2) {
        this.error.set('Esta ruta no tiene trayectoria registrada (sin puntos GPS suficientes).');
      }
      // AV7 — pega el trayecto a las calles (caché server-side); cae a lo crudo si falla.
      this.snapped = this.coords.length >= 2 ? await this.svc.snapToRoads(this.coords) : this.coords;
      this.dibujar();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la trayectoria.');
    } finally {
      this.loading.set(false);
    }
  }

  private async initMap(host: HTMLDivElement) {
    try {
      await this.loader.load();
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'Mapa no disponible.');
      this.mapInitStarted = false;
      return;
    }
    this.map = new google.maps.Map(host, {
      center: { lat: 18.4861, lng: -69.9312 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    this.mapReady = true;
    this.dibujar();
  }

  private dibujar() {
    if (!this.mapReady || !this.map || this.coords.length < 2) return;
    this.line?.setMap(null);
    for (const m of this.markers) m.setMap(null);
    this.markers = [];
    // Línea = trayecto pegado a la calle (AV7); marcadores inicio/fin = puntos crudos reales.
    const drawCoords = this.snapped.length >= 2 ? this.snapped : this.coords;
    const path = drawCoords.map(([lat, lng]) => ({ lat, lng }));
    this.line = new google.maps.Polyline({
      path, map: this.map, strokeColor: '#2563eb', strokeWeight: 4, strokeOpacity: 0.85,
    });
    const bounds = new google.maps.LatLngBounds();
    for (const p of path) bounds.extend(p);
    const raw = this.coords.map(([lat, lng]) => ({ lat, lng }));
    this.markers.push(new google.maps.Marker({
      position: raw[0], map: this.map, icon: pinIcon('#16a34a', 28), title: 'Inicio',
    }));
    this.markers.push(new google.maps.Marker({
      position: raw[raw.length - 1], map: this.map, icon: pinIcon('#dc2626', 28), title: 'Fin',
    }));
    this.map.fitBounds(bounds, 40);
  }

  cerrar() {
    this.close.emit();
  }
}
