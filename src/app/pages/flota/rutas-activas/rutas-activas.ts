import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  SeguimientoService,
  ChoferEstadoRow,
  ChoferEstado,
  RutaActiva,
  UltimaPosicion,
} from '../../../../shared/services/seguimiento.service';
import { RutasService } from '../../../../shared/services/rutas.service';
import { Ruta } from '../../../../shared/models/ruta.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

type Tab = 'activas' | 'historico';

const ESTADO_META: Record<ChoferEstado, { label: string; badge: string }> = {
  disponible: { label: 'Disponible', badge: 'success' },
  en_ruta: { label: 'En ruta', badge: 'info' },
  descanso: { label: 'Descanso', badge: 'neutral' },
  almuerzo: { label: 'Almuerzo', badge: 'warning' },
  inactivo: { label: 'Inactivo', badge: 'neutral' },
  otros: { label: 'Otros', badge: 'neutral' },
};

/** AP6 — un chofer con su estado, su ruta activa (si la hay) y su última posición. */
interface ChoferRuta {
  usuario_id: string;
  conductor_id: string;
  nombre: string;
  estado: ChoferEstado;
  otros_texto: string | null;
  desde: string | null;
  ruta: RutaActiva | null;
  posicion: UltimaPosicion | null;
}

/**
 * AP6 — Submódulo "Rutas activas" (roles elevados): estado actual de cada chofer
 * + su ruta activa (origen→destino, paradas, inicio, duración, última posición)
 * y un histórico de todas las rutas con filtros. Reutiliza los RPCs de Seguimiento
 * (choferes_estado, rutas_activas_y_hoy, chofer_ultima_posicion) y de Rutas — sin
 * pipeline paralelo.
 */
@Component({
  selector: 'app-rutas-activas',
  imports: [RouterLink],
  templateUrl: './rutas-activas.html',
  styleUrl: './rutas-activas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RutasActivas implements OnInit, OnDestroy {
  private seguimiento = inject(SeguimientoService);
  private rutasService = inject(RutasService);
  formatFecha = formatFechaDisplay;
  readonly ESTADO_META = ESTADO_META;

  tab = signal<Tab>('activas');
  loading = signal(true);
  error = signal('');

  private estados = signal<ChoferEstadoRow[]>([]);
  private rutasActivas = signal<RutaActiva[]>([]);
  private posiciones = signal<UltimaPosicion[]>([]);
  historico = signal<Ruta[]>([]);

  // Reloj para "duración corriendo" y "hace X min" (no usar globals en template).
  private now = signal<number>(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  // Filtros del histórico
  fChofer = signal<string>('');
  fEstado = signal<string>('');
  fObra = signal<string>('');
  fDesde = signal<string>('');
  fHasta = signal<string>('');

  ngOnInit() {
    this.now.set(Date.now());
    this.timer = setInterval(() => this.now.set(Date.now()), 30_000);
    this.load();
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [estados, activas, posiciones, historico] = await Promise.all([
        this.seguimiento.getChoferesEstado(),
        this.seguimiento.getRutasActivas(),
        this.seguimiento.getPosiciones().catch(() => []),
        this.rutasService.getAll().catch(() => []),
      ]);
      this.estados.set(estados);
      this.rutasActivas.set(activas);
      this.posiciones.set(posiciones);
      this.historico.set(historico);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las rutas.');
    } finally {
      this.loading.set(false);
    }
  }

  private norm(s: string | null | undefined): string {
    return (s ?? '').trim().toLowerCase();
  }

  /** Choferes con su ruta activa (match por nombre) y última posición (por usuario). */
  choferes = computed<ChoferRuta[]>(() => {
    const activas = this.rutasActivas().filter((r) => r.seccion === 'activa');
    const posByUser = new Map(this.posiciones().map((p) => [p.usuario_id, p]));
    return this.estados()
      .map((e) => ({
        usuario_id: e.usuario_id,
        conductor_id: e.conductor_id,
        nombre: e.nombre,
        estado: e.estado,
        otros_texto: e.otros_texto,
        desde: e.desde,
        ruta: activas.find((r) => this.norm(r.conductor_nombre) === this.norm(e.nombre)) ?? null,
        posicion: posByUser.get(e.usuario_id) ?? null,
      }))
      // En ruta primero, luego disponibles, luego el resto.
      .sort((a, b) => {
        const rank = (c: ChoferRuta) => (c.ruta ? 0 : c.estado === 'disponible' ? 1 : 2);
        return rank(a) - rank(b) || a.nombre.localeCompare(b.nombre);
      });
  });

  enRutaCount = computed(() => this.choferes().filter((c) => c.ruta).length);

  // ── Histórico ────────────────────────────────────────────
  obras = computed(() => {
    const m = new Map<string, string>();
    for (const r of this.historico()) {
      if (r.destino_proyecto_id && r.destino_proyecto?.nombre) m.set(r.destino_proyecto_id, r.destino_proyecto.nombre);
    }
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  choferesHist = computed(() => {
    const s = new Set<string>();
    for (const r of this.historico()) if (r.conductor?.nombre) s.add(r.conductor.nombre);
    return [...s].sort((a, b) => a.localeCompare(b));
  });

  historicoFiltrado = computed(() => {
    const chofer = this.fChofer();
    const estado = this.fEstado();
    const obra = this.fObra();
    const desde = this.fDesde();
    const hasta = this.fHasta();
    return this.historico().filter((r) => {
      if (chofer && r.conductor?.nombre !== chofer) return false;
      if (estado && r.estado !== estado) return false;
      if (obra && r.destino_proyecto_id !== obra) return false;
      if (desde && r.fecha < desde) return false;
      if (hasta && r.fecha > hasta) return false;
      return true;
    });
  });

  hasHistFilters = computed(
    () => !!this.fChofer() || !!this.fEstado() || !!this.fObra() || !!this.fDesde() || !!this.fHasta(),
  );

  clearHistFilters() {
    this.fChofer.set('');
    this.fEstado.set('');
    this.fObra.set('');
    this.fDesde.set('');
    this.fHasta.set('');
  }

  setTab(t: Tab) { this.tab.set(t); }

  estadoLabel(e: ChoferEstado): string { return ESTADO_META[e]?.label ?? e; }
  estadoBadge(e: ChoferEstado): string { return ESTADO_META[e]?.badge ?? 'neutral'; }

  /** Duración legible entre un timestamp ISO y ahora (o entre dos ISOs). */
  duracion(desdeIso: string | null | undefined, hastaIso?: string | null): string {
    if (!desdeIso) return '—';
    const start = new Date(desdeIso).getTime();
    const end = hastaIso ? new Date(hastaIso).getTime() : this.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
    const min = Math.floor((end - start) / 60_000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h} h ${m} min`;
  }

  /** "hace X min" a partir de un timestamp de posición. */
  hace(iso: string | null | undefined): string {
    if (!iso) return 'sin señal';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return 'sin señal';
    const min = Math.floor((this.now() - t) / 60_000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    return `hace ${h} h`;
  }

  kmRuta(r: Ruta): number | null {
    return r.km_real ?? r.km_estimado ?? null;
  }
}
