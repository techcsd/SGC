import {
  Component, ChangeDetectionStrategy, inject, signal, computed, effect,
  viewChild, ElementRef, AfterViewInit, OnDestroy, OnInit,
} from '@angular/core';
import { FlotaSubnav } from '../flota-subnav/flota-subnav';
import { Router } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  SeguimientoService, UltimaPosicion, ChoferEstadoRow, RutaActiva, ChoferEstado,
} from '../../../../shared/services/seguimiento.service';
import { GoogleMapsLoader } from '../../../../shared/context/google-maps-loader.service';
import { pinIcon } from '../../../../shared/context/google-maps-marker.util';
import { identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatTimestampDisplay, formatHoraTimestamp } from '../../../../shared/utils/fecha.util';

/** AS14 — ruta de hoy agrupada por su identidad visible (vehículo + origen→destino).
 *  Colapsa duplicados visuales; si un mismo trayecto tiene varias rutas (AV13
 *  cambiar-destino) las agrupa bajo una sola tarjeta con nota "N tramos". */
interface RutaHoyGrupo {
  key: string;
  rep: RutaActiva;
  ids: string[];
  count: number;
  inicio: string | null;
}

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
// AS14 — "en vivo": la última posición tiene menos de estos minutos.
const EN_VIVO_MIN = 2;
const STALE_COLOR = '#9ca3af';
// AS14 — anti-recta: NO unir dos puntos consecutivos si el hueco supera estos
// umbrales (confirmado por Xaviel). El hueco se dibuja como "sin señal" (gris punteado).
const GAP_MIN = 5;   // minutos entre puntos (solo si hay timestamps)
const GAP_KM = 2;    // kilómetros entre puntos
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
  imports: [FlotaSubnav, Skeleton],
  templateUrl: './seguimiento.html',
  styleUrl: './seguimiento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Seguimiento implements OnInit, AfterViewInit, OnDestroy {
  private svc = inject(SeguimientoService);
  private loader = inject(GoogleMapsLoader);
  private router = inject(Router);
  readonly ESTADO_META = ESTADO_META;
  readonly fechaHora = formatTimestampDisplay;
  readonly hora = formatHoraTimestamp;
  readonly idVehiculo = identificacionVehiculo;

  private mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: google.maps.Map | null = null;
  private mapReady = signal(false);   // AU2 — el mapa ya está creado y puede pintar
  private hasFitted = false;          // AU2 — el fitBounds inicial solo corre una vez
  private markers = new Map<string, google.maps.Marker>();
  private infoWindow: google.maps.InfoWindow | null = null;
  private channel: RealtimeChannel | null = null;
  private trailLines: google.maps.Polyline[] = [];      // AJ14/AS14 — trazado de ruta (uno por tramo)
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

  /** AS14 — rutas de hoy agrupadas por identidad visible (vehículo + origen→destino),
   *  para no pintar 3 tarjetas idénticas. Una tarjeta por trayecto; si el mismo
   *  trayecto tiene varias rutas (AV13 cambiar-destino) se anota "N tramos". */
  rutasHoyAgrupadas = computed<RutaHoyGrupo[]>(() => {
    const grupos = new Map<string, RutaActiva[]>();
    for (const r of this.rutasHoy()) {
      const key = `${this.idVehiculo(r)}|${r.origen ?? ''}→${r.destino ?? ''}`;
      const arr = grupos.get(key);
      if (arr) arr.push(r); else grupos.set(key, [r]);
    }
    return [...grupos.entries()].map(([key, rs]) => {
      const ordenadas = [...rs].sort((a, b) =>
        (a.iniciada_at ?? a.fecha).localeCompare(b.iniciada_at ?? b.fecha));
      return {
        key,
        rep: ordenadas[ordenadas.length - 1], // la más reciente representa el grupo
        ids: rs.map((r) => r.id),
        count: rs.length,
        inicio: ordenadas[0].iniciada_at ?? null,
      };
    });
  });

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

  constructor() {
    // AU2 — pintar los marcadores de forma REACTIVA a `posiciones()`. Antes había
    // un `paint()` de una sola vez (con setTimeout de 400 ms) que competía con la
    // carga de datos: si las posiciones llegaban tarde, el paint corría en vacío y
    // NUNCA se repetía, así que solo los choferes que emitían en tiempo real (los
    // frescos, p. ej. Joan) obtenían marcador vía la suscripción realtime; los de
    // posición vieja nunca se pintaban, aunque el mapa sí navegaba hasta ellos al
    // seleccionarlos (usa `posiciones()[uid]`, que sí estaba poblado). Con el effect,
    // cada cambio de `posiciones()` repinta TODO, incluidos los marcadores "sin señal".
    effect(() => {
      const pos = this.posiciones();
      if (!this.mapReady() || !this.map) return;
      const vistos = new Set<string>();
      for (const [uid, p] of Object.entries(pos)) {
        this.upsertMarker(uid, p);
        vistos.add(uid);
      }
      // Quitar marcadores de choferes que ya no vienen en posiciones.
      for (const [uid, m] of this.markers) {
        if (!vistos.has(uid)) { m.setMap(null); this.markers.delete(uid); }
      }
      // El encuadre inicial solo una vez (no reencuadrar tras cada tick/selección).
      if (!this.hasFitted && this.markers.size) { this.fitToMarkers(); this.hasFitted = true; }
    });
  }

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

  /** AS14 — posición reciente (< EN_VIVO_MIN) → indicador "en vivo". */
  posVivo(c: { pos: UltimaPosicion | null }): boolean {
    return this.esVivo(c.pos?.capturado_en);
  }

  /** AV1 — última señal más vieja que STALE_MIN → el marcador se atenúa. */
  private esStale(iso: string | null | undefined): boolean {
    if (!iso) return true;
    const t = new Date(iso).getTime();
    return isNaN(t) || Date.now() - t > STALE_MIN * 60000;
  }

  /** AS14 — "en vivo": la última posición tiene menos de EN_VIVO_MIN (2 min). */
  private esVivo(iso: string | null | undefined): boolean {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return !isNaN(t) && Date.now() - t < EN_VIVO_MIN * 60000;
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

    // AU2 — el mapa ya existe: el effect() del constructor pinta todos los
    // marcadores en cuanto haya posiciones (sin carreras de timing).
    this.mapReady.set(true);

    // Realtime: al llegar una posición nueva, actualizar el signal; el effect
    // repinta/mueve el marcador correspondiente.
    this.channel = this.svc.subscribePosiciones((row) => {
      this.posiciones.update((m) => ({ ...m, [row.usuario_id]: { ...m[row.usuario_id], ...row } }));
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
    const vivo = this.esVivo(p.capturado_en);
    const color = stale ? STALE_COLOR : this.estadoMeta(this.estadoDe(uid)).color;
    const nombre = this.nombreDe(uid);
    // AS14 — el hover del marcador confirma la frescura: en vivo / hace N min / sin señal.
    const cuando = this.haceCuanto(p.capturado_en);
    const title = stale
      ? `${nombre} · sin señal ${cuando}`
      : vivo
        ? `${nombre} · en vivo`
        : `${nombre} · ${cuando}`;
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
        this.infoWindow.setContent(this.infoWindowContent(usuarioId));
        this.infoWindow.open({ map: this.map, anchor: m });
      }
    }
    // AV1 — dibuja SU trayectoria de hoy (solo la del seleccionado), color propio.
    void this.trazarChofer(usuarioId);
  }

  /** AS14 — ruta activa del chofer (enlace best-effort por nombre del conductor;
   *  rutas_activas_y_hoy no expone el usuario_id/conductor_id del chofer). */
  private rutaActivaDe(usuarioId: string): RutaActiva | null {
    const nombre = this.nombreDe(usuarioId).trim().toLowerCase();
    if (!nombre) return null;
    return this.rutasActivas().find(
      (r) => (r.conductor_nombre ?? '').trim().toLowerCase() === nombre,
    ) ?? null;
  }

  /** AS14 — contenido enriquecido del InfoWindow del marcador en vivo: nombre,
   *  vehículo, frescura ("en vivo" / "hace N min" / "sin señal"), ruta activa y
   *  un botón "Ver recorrido" que abre el Recorrido diario de ese chofer/fecha. */
  private infoWindowContent(usuarioId: string): HTMLElement {
    const p = this.posiciones()[usuarioId];
    const stale = this.esStale(p?.capturado_en);
    const vivo = this.esVivo(p?.capturado_en);
    const veh = p?.vehiculo ? this.idVehiculo(p.vehiculo) : null;
    const ruta = this.rutaActivaDe(usuarioId);

    const el = document.createElement('div');
    el.style.cssText = 'min-width:180px;max-width:240px;font-size:13px;color:var(--sgc-text,#1e293b);line-height:1.35;';

    const row = (text: string, extra = '') => {
      const d = document.createElement('div');
      d.style.cssText = extra;
      d.textContent = text;
      el.appendChild(d);
      return d;
    };

    row(this.nombreDe(usuarioId), 'font-weight:700;margin-bottom:2px;');
    if (veh) row(veh, 'color:var(--sgc-text-muted,#64748b);font-size:12px;');

    if (p?.capturado_en) {
      const cuando = this.haceCuanto(p.capturado_en);
      if (vivo) row('En vivo · ' + cuando, 'color:#16a34a;font-weight:600;font-size:12px;margin-top:2px;');
      else if (stale) row('Sin señal · ' + cuando, 'color:#b45309;font-size:12px;margin-top:2px;');
      else row('Última posición · ' + cuando, 'color:var(--sgc-text-muted,#64748b);font-size:12px;margin-top:2px;');
    } else {
      row('Sin ubicación reportada', 'color:#b45309;font-size:12px;margin-top:2px;');
    }

    if (ruta) row('En ruta: ' + (ruta.origen ?? '') + ' → ' + (ruta.destino ?? ''), 'font-size:12px;margin-top:2px;');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Ver recorrido';
    btn.style.cssText =
      'margin-top:8px;width:100%;padding:6px 8px;font:inherit;font-size:12px;font-weight:700;' +
      'background:var(--sgc-primary,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;';
    btn.addEventListener('click', () => {
      void this.router.navigate(['/flota/recorrido-diario'], {
        queryParams: { chofer: usuarioId, fecha: hoyRD() },
      });
    });
    el.appendChild(btn);
    return el;
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
      // AV7/AS14 — pega cada tramo a las calles (map-matching, caché server-side) y
      // parte los huecos GPS (>2 km) como "sin señal" (línea gris punteada).
      const bounds = new google.maps.LatLngBounds();
      let puntos = 0;
      for (const coords of segmentos) {
        if (this.seleccionado() !== usuarioId || !this.map) return;
        const r = await this.dibujarGps(coords, color, 5, this.choferTrail);
        puntos += r.puntos;
        if (!r.bounds.isEmpty()) bounds.union(r.bounds);
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
      await this.dibujarTraza(coords);
      this.rutaTrazada.set(rutaId);
      this.trazaInfo.set({ puntos: coords.length, km, vivo: activa });
      if (!coords.length) this.error.set('Esta ruta todavía no tiene puntos de GPS.');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el trayecto.');
    } finally {
      this.trazaCargando.set(false);
    }
  }

  private async dibujarTraza(coords: [number, number][]) {
    this.limpiarTraza();
    if (!this.map || !coords.length) return;
    // AS14 — mismo pipeline que la trayectoria del chofer: snap-to-roads + anti-recta.
    const { bounds } = await this.dibujarGps(coords, '#2563eb', 4, this.trailLines);
    if (!this.map) return;
    // Marcadores inicio/fin sobre los puntos crudos reales (no los snapped).
    const start = { lat: coords[0][0], lng: coords[0][1] };
    const endc = coords[coords.length - 1];
    const end = { lat: endc[0], lng: endc[1] };
    this.trailMarkers.push(
      new google.maps.Marker({ position: start, map: this.map, icon: pinIcon('#16a34a', 26), title: 'Inicio' }),
    );
    if (coords.length > 1) {
      this.trailMarkers.push(
        new google.maps.Marker({ position: end, map: this.map, icon: pinIcon('#dc2626', 26), title: 'Último punto' }),
      );
    }
    bounds.extend(start);
    bounds.extend(end);
    if (!bounds.isEmpty()) this.map.fitBounds(bounds, 60);
  }

  /**
   * AS14 — dibuja una polilínea a partir de puntos GPS crudos:
   *  1) parte la línea en los huecos (> GAP_KM km o > GAP_MIN min entre puntos
   *     consecutivos, cuando hay timestamps) para no unir dos posiciones con una
   *     recta falsa; 2) pega cada sub-tramo a las calles (snapToRoads, caché
   *     server-side, con fallback a las coords crudas); 3) marca cada hueco como
   *     "sin señal" (línea gris punteada). Empuja las polilíneas a `sink`.
   */
  private async dibujarGps(
    coords: [number, number][],
    color: string,
    weight: number,
    sink: google.maps.Polyline[],
  ): Promise<{ puntos: number; bounds: google.maps.LatLngBounds }> {
    const bounds = new google.maps.LatLngBounds();
    let puntos = 0;
    if (!this.map || !coords?.length) return { puntos, bounds };
    const tramos = this.partirEnTramos(coords);
    let prevEnd: google.maps.LatLngLiteral | null = null;
    for (const tramo of tramos) {
      const snapped = await this.svc.snapToRoads(tramo);
      if (!this.map) break;
      const path = snapped.map(([lat, lng]) => ({ lat, lng }));
      if (!path.length) continue;
      puntos += path.length;
      for (const pt of path) bounds.extend(pt);
      // Hueco entre el fin del tramo anterior y el inicio de este = "sin señal".
      if (prevEnd) sink.push(this.lineaSinSenal(prevEnd, path[0]));
      if (path.length >= 2) {
        sink.push(new google.maps.Polyline({
          path, map: this.map, strokeColor: color, strokeWeight: weight, strokeOpacity: 0.85,
        }));
      }
      prevEnd = path[path.length - 1];
    }
    return { puntos, bounds };
  }

  /** AS14 — parte una lista de puntos en sub-tramos allí donde el salto supera
   *  GAP_KM (distancia) o GAP_MIN (tiempo, si el punto trae timestamp opcional). */
  private partirEnTramos(coords: [number, number][]): [number, number][][] {
    const segs: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) {
        const km = this.haversineKm(coords[i - 1], coords[i]);
        if (km > GAP_KM) { if (cur.length) segs.push(cur); cur = []; }
      }
      cur.push(coords[i]);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  /** AS14 — distancia entre dos coordenadas (km) por haversine. */
  private haversineKm(a: [number, number], b: [number, number]): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** AS14 — conector "sin señal": línea gris punteada entre dos tramos con hueco. */
  private lineaSinSenal(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): google.maps.Polyline {
    const dash: google.maps.IconSequence = {
      icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: STALE_COLOR, scale: 3 },
      offset: '0', repeat: '12px',
    };
    return new google.maps.Polyline({
      path: [a, b], map: this.map!, strokeOpacity: 0, icons: [dash],
    });
  }

  private limpiarTraza() {
    for (const l of this.trailLines) l.setMap(null);
    this.trailLines = [];
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
