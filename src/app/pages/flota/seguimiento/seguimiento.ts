import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
  viewChild, ElementRef, AfterViewInit, OnDestroy, OnInit,
} from '@angular/core';
import * as L from 'leaflet';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  SeguimientoService, UltimaPosicion, ChoferEstadoRow, RutaActiva, ChoferEstado,
} from '../../../../shared/services/seguimiento.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

const ESTADO_META: Record<ChoferEstado, { label: string; color: string }> = {
  disponible: { label: 'Disponible', color: '#16a34a' },
  en_ruta:    { label: 'En ruta',    color: '#2563eb' },
  descanso:   { label: 'Descanso',   color: '#6b7280' },
  almuerzo:   { label: 'Almuerzo',   color: '#f97316' },
  inactivo:   { label: 'Inactivo',   color: '#374151' },
  otros:      { label: 'Otros',      color: '#7c3aed' },
};

/**
 * AF27 — Seguimiento / Control de rutas: mapa en vivo con la última posición de
 * cada chofer, su estado (AF28), rutas activas y conduces en tránsito. Solo para
 * jefe de flota / admin / tecnología (gated por ruta).
 */
@Component({
  selector: 'app-seguimiento',
  imports: [Skeleton],
  templateUrl: './seguimiento.html',
  styleUrl: './seguimiento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Seguimiento implements OnInit, AfterViewInit, OnDestroy {
  private svc = inject(SeguimientoService);
  readonly ESTADO_META = ESTADO_META;
  readonly fechaHora = formatTimestampDisplay;

  private mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private markers = new Map<string, L.Marker>();
  private channel: RealtimeChannel | null = null;

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

  estadoMeta(e: ChoferEstado) { return ESTADO_META[e] ?? ESTADO_META.inactivo; }

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

  ngAfterViewInit() {
    const el = this.mapEl();
    if (!el) return;
    // Centro por defecto: Santo Domingo, RD.
    this.map = L.map(el.nativeElement, { center: [18.4861, -69.9312], zoom: 11, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this.map);
    requestAnimationFrame(() => this.map?.invalidateSize());

    // Pinta los markers iniciales una vez cargados los datos.
    const paint = () => {
      if (!this.map) return;
      for (const [uid, p] of Object.entries(this.posiciones())) this.upsertMarker(uid, p);
      this.fitToMarkers();
    };
    // Los datos pueden llegar antes o después del view init.
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
    const color = this.estadoMeta(this.estadoDe(uid)).color;
    const nombre = this.nombreDe(uid);
    const icon = L.divIcon({
      className: 'seg-marker',
      html: `<div class="seg-marker__pin" style="background:${color}"></div>`,
      iconSize: [22, 22], iconAnchor: [11, 22],
    });
    const existing = this.markers.get(uid);
    if (existing) {
      existing.setLatLng([p.lat, p.lng]);
      existing.setIcon(icon);
    } else {
      const m = L.marker([p.lat, p.lng], { icon }).addTo(this.map);
      m.bindTooltip(nombre, { direction: 'top', offset: [0, -18] });
      m.on('click', () => this.seleccionar(uid, false));
      this.markers.set(uid, m);
    }
  }

  private fitToMarkers() {
    if (!this.map || this.markers.size === 0) return;
    const group = L.featureGroup([...this.markers.values()]);
    this.map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 15 });
  }

  seleccionar(usuarioId: string, pan = true) {
    this.seleccionado.set(usuarioId);
    const p = this.posiciones()[usuarioId];
    if (pan && p && this.map && p.lat != null) {
      this.map.setView([p.lat, p.lng], 15, { animate: true });
      this.markers.get(usuarioId)?.openTooltip();
    }
  }

  ngOnDestroy() {
    if (this.channel) this.svc.removeChannel(this.channel);
    this.map?.remove();
    this.map = null;
  }
}
