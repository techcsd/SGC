import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
  viewChild, ElementRef, OnDestroy, OnInit, effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  SeguimientoService, RecorridoDiario, RecorridoDisponible, RecorridoParada,
} from '../../../../shared/services/seguimiento.service';
import { GoogleMapsLoader } from '../../../../shared/context/google-maps-loader.service';
import { pinIcon } from '../../../../shared/context/google-maps-marker.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { todayIso, daysAgoIso, formatHoraTimestamp, formatFechaMedia } from '../../../../shared/utils/fecha.util';

/**
 * AT1 — Recorrido diario (tipo Google Maps Timeline): elegir chofer + fecha y ver
 * el recorrido de ese día dibujado en el mapa, aunque NO haya estado en una ruta
 * (el tracking corre durante toda la jornada, AF27). Se alimenta de las posiciones
 * crudas consolidadas por día (RPC recorrido_diario_de) — cumple la regla AT11:
 * la data de tracking enviada por la app ahora SÍ se puede visualizar.
 * Solo jefe de flota / admin / tecnología (gated por ruta + RPC).
 */
@Component({
  selector: 'app-recorrido-diario',
  imports: [FormsModule, DecimalPipe, RouterLink, Skeleton],
  templateUrl: './recorrido-diario.html',
  styleUrl: './recorrido-diario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecorridoDiarioPage implements OnInit, OnDestroy {
  private svc = inject(SeguimientoService);
  private loader = inject(GoogleMapsLoader);
  readonly hora = formatHoraTimestamp;
  readonly fechaMedia = formatFechaMedia;

  private mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: google.maps.Map | null = null;
  private lines: google.maps.Polyline[] = [];
  private endMarkers: google.maps.Marker[] = [];
  private paradaMarkers: google.maps.Marker[] = [];
  private mapReady = false;
  private mapInitStarted = false;

  // AU7 — paradas del día + su lugar (geocodificación inversa, lazy).
  paradas = signal<RecorridoParada[]>([]);
  lugares = signal<Record<number, string>>({});

  constructor() {
    // El <div #map> vive dentro de @if(loading()){…}@else{…}, así que NO existe
    // cuando corre ngAfterViewInit (loading aún true) — por eso el mapa nunca se
    // inicializaba y el recorrido no se pintaba (AU2/AU3). Inicializamos el mapa de
    // forma reactiva en cuanto el elemento entra al DOM, sin depender del ciclo de vida.
    effect(() => {
      const el = this.mapEl();
      if (el && !this.mapInitStarted && !this.mapError()) {
        this.mapInitStarted = true;
        void this.initMap(el.nativeElement);
      }
    });
  }

  private async initMap(host: HTMLDivElement) {
    try {
      await this.loader.load();
    } catch (e) {
      this.mapError.set((e as Error)?.message ?? 'Mapa no disponible.');
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
    // Si ya se eligió un recorrido antes de que el mapa cargara, dibújalo.
    const rec = this.recorrido();
    if (rec) this.dibujar(rec);
  }

  // Rango de disponibilidad consultado (últimos 30 días por defecto).
  desde = signal<string>(daysAgoIso(30));
  hasta = signal<string>(todayIso());

  disponibles = signal<RecorridoDisponible[]>([]);
  loading = signal(true);
  error = signal('');
  mapError = signal('');

  choferSel = signal<string | null>(null);
  fechaSel = signal<string>(todayIso());
  recorrido = signal<RecorridoDiario | null>(null);
  cargandoRec = signal(false);

  // Choferes únicos con al menos un día de recorrido en el rango.
  choferes = computed(() => {
    const map = new Map<string, { usuario_id: string; nombre: string; dias: number }>();
    for (const r of this.disponibles()) {
      const prev = map.get(r.usuario_id);
      if (prev) prev.dias += 1;
      else map.set(r.usuario_id, { usuario_id: r.usuario_id, nombre: r.nombre, dias: 1 });
    }
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  // Fechas con data para el chofer seleccionado (chips, tipo Timeline).
  fechasDeChofer = computed(() => {
    const uid = this.choferSel();
    if (!uid) return [] as RecorridoDisponible[];
    return this.disponibles()
      .filter((r) => r.usuario_id === uid)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  async ngOnInit() {
    try {
      this.disponibles.set(await this.svc.getRecorridosDisponibles(this.desde(), this.hasta()));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la disponibilidad.');
    } finally {
      this.loading.set(false);
    }
  }

  seleccionarChofer(uid: string) {
    this.choferSel.set(uid);
    // Si el chofer tiene días con data, salta al más reciente.
    const dias = this.fechasDeChofer();
    if (dias.length) this.verFecha(dias[0].fecha);
  }

  async verFecha(fecha: string) {
    const uid = this.choferSel();
    if (!uid) return;
    this.fechaSel.set(fecha);
    this.cargandoRec.set(true);
    this.error.set('');
    try {
      const rec = await this.svc.getRecorridoDiario(uid, fecha);
      this.recorrido.set(rec);
      this.paradas.set(rec?.paradas ?? []);
      this.lugares.set({});
      this.dibujar(rec);
      this.geocodificarParadas();
      if (!rec || rec.puntos === 0) {
        this.error.set('Este chofer no tiene recorrido registrado en esa fecha.');
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el recorrido.');
    } finally {
      this.cargandoRec.set(false);
    }
  }

  private dibujar(rec: RecorridoDiario | null) {
    this.limpiar();
    if (!this.mapReady || !this.map || !rec) return;
    // Preferimos los tramos (cortados por huecos de tiempo). Si por alguna razón no
    // vinieran tramos pero sí las coords crudas, dibujamos un solo trazo con ellas.
    const segmentos: [number, number][][] = rec.tramos?.length
      ? rec.tramos.map((t) => t.coords ?? [])
      : (rec.coords?.length ? [rec.coords] : []);
    if (!segmentos.length) return;
    const bounds = new google.maps.LatLngBounds();
    for (const coords of segmentos) {
      const path = coords.map(([lat, lng]) => ({ lat, lng }));
      if (path.length < 2) continue;
      this.lines.push(
        new google.maps.Polyline({
          path, map: this.map, strokeColor: '#2563eb', strokeWeight: 4, strokeOpacity: 0.85,
        }),
      );
      for (const p of path) bounds.extend(p);
    }
    // Marcadores de inicio (primer punto del día) y fin (último).
    const first = segmentos[0]?.[0];
    const lastSeg = segmentos[segmentos.length - 1];
    const last = lastSeg?.[lastSeg.length - 1];
    if (first) {
      this.endMarkers.push(new google.maps.Marker({
        position: { lat: first[0], lng: first[1] }, map: this.map,
        icon: pinIcon('#16a34a', 28), title: 'Inicio del día',
      }));
    }
    if (last) {
      this.endMarkers.push(new google.maps.Marker({
        position: { lat: last[0], lng: last[1] }, map: this.map,
        icon: pinIcon('#dc2626', 28), title: 'Último punto',
      }));
    }
    // AU7 — marcadores de paradas/visitas (numerados).
    const paradas = rec.paradas ?? [];
    paradas.forEach((p, i) => {
      this.paradaMarkers.push(new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map: this.map,
        label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
        icon: pinIcon('#f59e0b', 30), title: `Parada ${i + 1} · ${p.minutos} min`,
        zIndex: 999,
      }));
      bounds.extend({ lat: p.lat, lng: p.lng });
    });

    if (!bounds.isEmpty()) this.map.fitBounds(bounds, 60);
  }

  /** AU7 — resuelve el lugar de cada parada (edge reverse-geocode, best-effort). */
  private geocodificarParadas() {
    const paradas = this.paradas();
    paradas.forEach(async (p, i) => {
      const dir = await this.svc.reverseGeocode(p.lat, p.lng);
      if (dir) this.lugares.update((m) => ({ ...m, [i]: dir }));
    });
  }

  centrarParada(p: RecorridoParada) {
    if (this.map) {
      this.map.panTo({ lat: p.lat, lng: p.lng });
      this.map.setZoom(16);
    }
  }

  private limpiar() {
    for (const l of this.lines) l.setMap(null);
    for (const m of this.endMarkers) m.setMap(null);
    for (const m of this.paradaMarkers) m.setMap(null);
    this.lines = [];
    this.endMarkers = [];
    this.paradaMarkers = [];
  }

  ngOnDestroy() {
    this.limpiar();
  }
}
