import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
  viewChild, ElementRef, AfterViewInit, OnDestroy, OnInit,
} from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  SeguimientoService, UltimaPosicion, ChoferEstadoRow, RutaActiva, ChoferEstado,
} from '../../../../shared/services/seguimiento.service';
import { GoogleMapsLoader } from '../../../../shared/context/google-maps-loader.service';
import { pinIcon } from '../../../../shared/context/google-maps-marker.util';
import { identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { MapLegend } from '../../../../shared/ui/map-legend/map-legend';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

const ESTADO_META: Record<ChoferEstado, { label: string; color: string }> = {
  disponible: { label: 'Disponible', color: '#16a34a' },
  en_ruta:    { label: 'En ruta',    color: '#2563eb' },
  descanso:   { label: 'Descanso',   color: '#6b7280' },
  almuerzo:   { label: 'Almuerzo',   color: '#f97316' },
  inactivo:   { label: 'Inactivo',   color: '#374151' },
  otros:      { label: 'Otros',      color: '#7c3aed' },
};

// AV1 — un marcador sin señal por más de estos minutos se atenúa ("sin señal").
const STALE_MIN = 10;
const STALE_COLOR = '#9ca3af';
// Local del hoy en RD (para pedir el recorrido del día del chofer seleccionado).
function hoyRD(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * AF27 — Seguimiento / Control de rutas: mapa en vivo (Google Maps) con la última
 * posición de cada chofer, su estado (AF28), rutas activas y conduces en tránsito.
 * Solo para jefe de flota / admin / tecnología (gated por ruta).
 */
@Component({
  selector: 'app-seguimiento',
  imports: [Skeleton, MapLegend],
  templateUrl: './seguimiento.html',
  styleUrl: './seguimiento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Seguimiento implements OnInit, AfterViewInit, OnDestroy {
  private svc = inject(SeguimientoService);
  private loader = inject(GoogleMapsLoader);
  readonly ESTADO_META = ESTADO_META;
  readonly fechaHora = formatTimestampDisplay;
  readonly idVehiculo = identificacionVehiculo;

  private mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: google.maps.Map | null = null;
  private markers = new Map<string, google.maps.Marker>();
  private infoWindow: google.maps.InfoWindow | null = null;
  private channel: RealtimeChannel | null = null;
  private trail: google.maps.Polyline | null = null;   // AJ14 — trazado de ruta dibujado
  private trailMarkers: google.maps.Marker[] = [];      // inicio/fin del trayecto
  private markerAnim = new Map<string, number>();       // AV1 — RAF por marcador (interpolación)
  private choferTrail: google.maps.Polyline[] = [];     // AV1 — trayectoria del chofer seleccionado
  private choferTrailMarkers: google.maps.Marker[] = [];
  trazaChoferCargando = signal(false);
  trazaChoferInfo = signal<{ puntos: number; km: number | null } | null>(null);

  rutaTrazada = signal<string | null>(null);
  trazaInfo = signal<{ puntos: number; km: number | null; vivo: boolean } | null>(null);
  trazaCargando = signal(false);
  mapError = signal('');

  posiciones = signal<Record<string, UltimaPosicion>>({});
  estados = signal<ChoferEstadoRow[]>([]);
  rutas = signal<RutaActiva[]>([]);
  loading = signal(true);
  error = signal('');
  seleccionado = signal<string | null>(null);

  /** Lista del panel: choferes con estado + su última posición (si hay). */
  choferes = computed(() => {
    const pos = this.posiciones();
    return this.estados().map((e) => ({
      ...e,
      pos: pos[e.usuario_id] ?? null,
    }));
  });

  rutasActivas = computed(() => this.rutas().filter((r) => r.seccion === 'activa'));
  rutasHoy = computed(() => this.rutas().filter((r) => r.seccion === 'hoy'));

  enRutaCount = computed(() => this.choferes().filter((c) => c.estado === 'en_ruta').length);
  conUbicacion = computed(() => this.choferes().filter((c) => c.pos?.capturado_en).length);

  leyenda = computed(() => {
    const counts = new Map<ChoferEstado, number>();
    for (const c of this.choferes()) counts.set(c.estado as ChoferEstado, (counts.get(c.estado as ChoferEstado) ?? 0) + 1);
    return (Object.keys(ESTADO_META) as ChoferEstado[]).map((e) => ({
      estado: e, label: ESTADO_META[e].label, color: ESTADO_META[e].color, count: counts.get(e) ?? 0,
    }));
  });
  mostrarLeyenda = signal(true);
  toggleLeyenda() { this.mostrarLeyenda.update((v) => !v); }

  estadoMeta(e: ChoferEstado) { return ESTADO_META[e] ?? ESTADO_META.inactivo; }

  haceCuanto(iso: string | null | undefined): string {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return 'hace instantes';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'hace 1 día' : `hace ${d} días`;
  }

  posVieja(c: { pos: UltimaPosicion | null }): boolean {
    return this.esStale(c.pos?.capturado_en);
  }

  /** AV1 — última señal más vieja que STALE_MIN → el marcador se atenúa. */
  private esStale(iso: string | null | undefined): boolean {
    if (!iso) return true;
    const t = new Date(iso).getTime();
    return isNaN(t) || Date.now() - t > STALE_MIN * 60000;
  }

  async ngOnInit() {
    try {
      const [pos, est, rut] = await Promise.all([
        this.svc.getPosiciones(),
        this.svc.getChoferesEstado(),
        this.svc.getRutasActivas(),
      ]);
      const map: Record<string, UltimaPosicion> = {};
      for (const p of pos) map[p.usuario_id] = p;
      this.posiciones.set(map);
      this.estados.set(est);
      this.rutas.set(rut);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el seguimiento.');
    } finally {
      this.loading.set(false);
    }
  }

  async ngAfterViewInit() {
    const el = this.mapEl();
    if (!el) return;
    try {
      await this.loader.load();
    } catch (e) {
      this.mapError.set((e as Error)?.message ?? 'Mapa no disponible.');
      return;
    }
    if (!this.mapEl()) return;

    // Centro por defecto: Santo Domingo, RD.
    this.map = new google.maps.Map(el.nativeElement, {
      center: { lat: 18.4861, lng: -69.9312 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    this.infoWindow = new google.maps.InfoWindow();

    const paint = () => {
      if (!this.map) return;
      for (const [uid, p] of Object.entries(this.posiciones())) this.upsertMarker(uid, p);
      this.fitToMarkers();
    };
    if (Object.keys(this.posiciones()).length) paint();
    else setTimeout(paint, 400);

    // Realtime: mueve/crea markers al llegar posiciones nuevas.
    this.channel = this.svc.subscribePosiciones((row) => {
      this.posiciones.update((m) => ({ ...m, [row.usuario_id]: { ...m[row.usuario_id], ...row } }));
      this.upsertMarker(row.usuario_id, row);
    });
  }

  private estadoDe(usuarioId: string): ChoferEstado {
    return (this.estados().find((e) => e.usuario_id === usuarioId)?.estado ?? 'inactivo') as ChoferEstado;
  }

  private nombreDe(usuarioId: string): string {
    const p = this.posiciones()[usuarioId];
    return p?.usuario?.nombre ?? this.estados().find((e) => e.usuario_id === usuarioId)?.nombre ?? 'Chofer';
  }

  private upsertMarker(uid: string, p: UltimaPosicion) {
    if (!this.map || p.lat == null || p.lng == null) return;
    const stale = this.esStale(p.capturado_en);
    const color = stale ? STALE_COLOR : this.estadoMeta(this.estadoDe(uid)).color;
    const nombre = this.nombreDe(uid);
    const title = stale ? `${nombre} · sin señal ${this.haceCuanto(p.capturado_en)}` : nombre;
    const position = { lat: p.lat, lng: p.lng };
    const existing = this.markers.get(uid);
    if (existing) {
      // AV1 — punto en movimiento: interpola suave de la posición actual a la nueva.
      this.animarMarcador(uid, existing, position);
      existing.setIcon(pinIcon(color));
      existing.setOpacity(stale ? 0.45 : 1);
      existing.setTitle(title);
    } else {
      const m = new google.maps.Marker({
        position, map: this.map, icon: pinIcon(color), title, opacity: stale ? 0.45 : 1,
      });
      m.addListener('click', () => this.seleccionar(uid, false));
      this.markers.set(uid, m);
    }
  }

  /** AV1 — anima el marcador entre su posición actual y la nueva (~900 ms). */
  private animarMarcador(uid: string, m: google.maps.Marker, to: google.maps.LatLngLiteral) {
    const from = m.getPosition();
    const prev = this.markerAnim.get(uid);
    if (prev) cancelAnimationFrame(prev);
    if (!from) { m.setPosition(to); return; }
    const fromLat = from.lat(), fromLng = from.lng();
    const dLat = to.lat - fromLat, dLng = to.lng - fromLng;
    // Saltos grandes (batch atrasado) → mover directo, sin animar cruzando la ciudad.
    if (Math.abs(dLat) > 0.05 || Math.abs(dLng) > 0.05) { m.setPosition(to); return; }
    const dur = 900;
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 === null) t0 = ts;
      const k = Math.min(1, (ts - t0) / dur);
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
      m.setPosition({ lat: fromLat + dLat * ease, lng: fromLng + dLng * ease });
      if (k < 1) this.markerAnim.set(uid, requestAnimationFrame(step));
      else this.markerAnim.delete(uid);
    };
    this.markerAnim.set(uid, requestAnimationFrame(step));
  }

  private fitToMarkers() {
    if (!this.map || this.markers.size === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const m of this.markers.values()) {
      const pos = m.getPosition();
      if (pos) bounds.extend(pos);
    }
    this.map.fitBounds(bounds, 60);
    if (this.markers.size === 1) this.map.setZoom(Math.min(this.map.getZoom() ?? 15, 15));
  }

  seleccionar(usuarioId: string, pan = true) {
    // AV1 — click sobre el ya seleccionado = deseleccionar (oculta su trayectoria).
    if (this.seleccionado() === usuarioId) {
      this.seleccionado.set(null);
      this.limpiarChoferTraza();
      this.infoWindow?.close();
      return;
    }
    this.seleccionado.set(usuarioId);
    const p = this.posiciones()[usuarioId];
    if (p && this.map && p.lat != null) {
      if (pan) {
        this.map.panTo({ lat: p.lat, lng: p.lng });
        this.map.setZoom(15);
      }
      const m = this.markers.get(usuarioId);
      if (m && this.infoWindow) {
        this.infoWindow.setContent(this.nombreDe(usuarioId));
        this.infoWindow.open({ map: this.map, anchor: m });
      }
    }
    // AV1 — dibuja SU trayectoria de hoy (solo la del seleccionado), color propio.
    void this.trazarChofer(usuarioId);
  }

  /** AV1 — trayectoria del chofer seleccionado (recorrido de hoy), en su color. */
  private async trazarChofer(usuarioId: string) {
    this.limpiarChoferTraza();
    this.trazaChoferInfo.set(null);
    this.trazaChoferCargando.set(true);
    try {
      const rec = await this.svc.getRecorridoDiario(usuarioId, hoyRD());
      // si cambió la selección mientras cargaba, no pintar.
      if (this.seleccionado() !== usuarioId || !this.map || !rec) return;
      const color = this.estadoMeta(this.estadoDe(usuarioId)).color;
      const segmentos = rec.tramos?.length ? rec.tramos.map((t) => t.coords ?? []) : [rec.coords ?? []];
      // AV7 — pega cada tramo a las calles (map-matching, con caché server-side).
      const snapped = await Promise.all(segmentos.map((c) => this.svc.snapToRoads(c)));
      if (this.seleccionado() !== usuarioId || !this.map) return;
      const bounds = new google.maps.LatLngBounds();
      let puntos = 0;
      for (const coords of snapped) {
        if (coords.length < 2) { puntos += coords.length; coords.forEach(([la, ln]) => bounds.extend({ lat: la, lng: ln })); continue; }
        const path = coords.map(([lat, lng]) => ({ lat, lng }));
        this.choferTrail.push(new google.maps.Polyline({
          path, map: this.map, strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85,
        }));
        path.forEach((pt) => bounds.extend(pt));
        puntos += path.length;
      }
      this.trazaChoferInfo.set({ puntos, km: rec.km ?? null });
      if (puntos > 1 && !bounds.isEmpty()) this.map.fitBounds(bounds, 80);
    } catch {
      // trayectoria best-effort: no romper el mapa si falla.
    } finally {
      this.trazaChoferCargando.set(false);
    }
  }

  private limpiarChoferTraza() {
    for (const l of this.choferTrail) l.setMap(null);
    this.choferTrail = [];
    for (const m of this.choferTrailMarkers) m.setMap(null);
    this.choferTrailMarkers = [];
  }

  /** AJ14 — dibuja el trayecto de una ruta: breadcrumb en vivo (activa) o
   *  polyline consolidada (finalizada). Vuelve a llamar para limpiar. */
  async trazarRuta(rutaId: string, activa: boolean) {
    if (this.rutaTrazada() === rutaId) { this.limpiarTraza(); return; }
    this.trazaCargando.set(true);
    try {
      let coords: [number, number][] = [];
      let km: number | null = null;
      if (activa) {
        coords = await this.svc.getRutaBreadcrumb(rutaId);
      } else {
        const t = await this.svc.getRutaTrayecto(rutaId);
        coords = t.coords ?? [];
        km = t.km ?? null;
      }
      this.dibujarTraza(coords);
      this.rutaTrazada.set(rutaId);
      this.trazaInfo.set({ puntos: coords.length, km, vivo: activa });
      if (!coords.length) this.error.set('Esta ruta todavía no tiene puntos de GPS.');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el trayecto.');
    } finally {
      this.trazaCargando.set(false);
    }
  }

  private dibujarTraza(coords: [number, number][]) {
    this.limpiarTraza();
    if (!this.map || !coords.length) return;
    const path = coords.map(([lat, lng]) => ({ lat, lng }));
    this.trail = new google.maps.Polyline({
      path, map: this.map, strokeColor: '#2563eb', strokeWeight: 4, strokeOpacity: 0.85,
    });
    const start = path[0];
    const end = path[path.length - 1];
    this.trailMarkers.push(
      new google.maps.Marker({ position: start, map: this.map, icon: pinIcon('#16a34a', 26), title: 'Inicio' }),
    );
    if (path.length > 1) {
      this.trailMarkers.push(
        new google.maps.Marker({ position: end, map: this.map, icon: pinIcon('#dc2626', 26), title: 'Último punto' }),
      );
    }
    const bounds = new google.maps.LatLngBounds();
    for (const p of path) bounds.extend(p);
    this.map.fitBounds(bounds, 60);
  }

  private limpiarTraza() {
    if (this.trail) { this.trail.setMap(null); this.trail = null; }
    for (const m of this.trailMarkers) m.setMap(null);
    this.trailMarkers = [];
    this.rutaTrazada.set(null);
    this.trazaInfo.set(null);
  }

  ngOnDestroy() {
    if (this.channel) this.svc.removeChannel(this.channel);
    for (const id of this.markerAnim.values()) cancelAnimationFrame(id);
    this.markerAnim.clear();
    for (const m of this.markers.values()) m.setMap(null);
    this.markers.clear();
    this.limpiarTraza();
    this.limpiarChoferTraza();
    this.map = null;
  }
}
