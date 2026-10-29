import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TableroVivoService, TableroVivo } from '../../../shared/services/tablero-vivo.service';
import { UserService } from '../../core/services/user.service';
import { CountUpDirective } from '../../../shared/motion/count-up.directive';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

/**
 * DB1 (Ronda DB) — «Hoy, en vivo» en el Inicio (mockup DB1): KPIs con count-up,
 * flujo de pedidos por etapa con feed de eventos que entra deslizándose, y la
 * flota sobre un mapa esquemático SVG propio (sin proveedor externo). Datos por
 * `tablero_vivo_resumen()` + Realtime (re-pide con debounce 2 s); si Realtime no
 * conecta, polling 30 s. Se suscribe SOLO con la pestaña visible, y con
 * `reduced-motion` todo aparece sin animar (CJ4, nivel mediano).
 */
@Component({
  selector: 'app-tablero-vivo',
  templateUrl: './tablero-vivo.html',
  styleUrl: './tablero-vivo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, CountUpDirective, TranslatePipe],
})
export class TableroVivoComponent implements OnInit, OnDestroy {
  private service = inject(TableroVivoService);
  private user = inject(UserService);

  datos = signal<TableroVivo | null>(null);
  error = signal('');
  enVivo = signal(false); // Realtime conectado (si no: polling 30 s)

  private debounceId: ReturnType<typeof setTimeout> | null = null;
  private pollId: ReturnType<typeof setInterval> | null = null;
  private visHandler = () => this.onVisibilidad();

  /** DB-14 — visible para inventario/flota/proyectos/direccion o admin. */
  puedeVer = computed(() =>
    this.user.hasRole('admin') || this.user.hasModulo('inventario') || this.user.hasModulo('flota')
    || this.user.hasModulo('proyectos') || this.user.hasModulo('direccion'));

  readonly ETAPAS: { key: keyof TableroVivo['flujo']; label: string }[] = [
    { key: 'solicitada', label: 'Solicitada' },
    { key: 'aprobada', label: 'Aprobada' },
    { key: 'despachada', label: 'Despachada' },
    { key: 'en_ruta', label: 'En ruta' },
    { key: 'entregada', label: 'Entregada' },
  ];

  hayMovimiento = computed(() => {
    const d = this.datos();
    if (!d) return false;
    const k = d.kpis;
    return (k.requisiciones_hoy + k.conduces_hoy + k.entregas_hoy + k.echadas_hoy
      + k.vehiculos_en_uso + k.bitacoras_hoy) > 0 || d.flota.length > 0;
  });

  /** Posiciones normalizadas al lienzo SVG (mapa esquemático, sin proveedor). */
  flotaSvg = computed(() => {
    const flota = this.datos()?.flota ?? [];
    if (!flota.length) return [];
    const lats = flota.map((f) => f.lat);
    const lngs = flota.map((f) => f.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const spanLat = Math.max(maxLat - minLat, 0.01);
    const spanLng = Math.max(maxLng - minLng, 0.01);
    // margen del 12% para que ningún punto quede pegado al borde
    return flota.map((f) => ({
      ...f,
      x: 12 + ((f.lng - minLng) / spanLng) * 76,
      y: 12 + ((maxLat - f.lat) / spanLat) * 56,
      etiqueta: f.alias || f.placa || '—',
    }));
  });

  async ngOnInit() {
    if (!this.puedeVer()) return;
    await this.cargar();
    document.addEventListener('visibilitychange', this.visHandler);
    this.conectar();
  }

  ngOnDestroy() {
    document.removeEventListener('visibilitychange', this.visHandler);
    this.desconectar();
  }

  private conectar() {
    if (document.hidden) return;
    this.service.suscribir(
      () => this.recargarConDebounce(),
      (conectado) => {
        this.enVivo.set(conectado);
        // Realtime caído → polling 30 s (y se apaga si conecta).
        if (!conectado && !this.pollId) {
          this.pollId = setInterval(() => { if (!document.hidden) void this.cargar(); }, 30_000);
        } else if (conectado && this.pollId) {
          clearInterval(this.pollId);
          this.pollId = null;
        }
      },
    );
  }

  private desconectar() {
    void this.service.desuscribir();
    this.enVivo.set(false);
    if (this.debounceId) { clearTimeout(this.debounceId); this.debounceId = null; }
    if (this.pollId) { clearInterval(this.pollId); this.pollId = null; }
  }

  /** La pestaña oculta no mantiene canal ni polling (ahorro real de Realtime). */
  private onVisibilidad() {
    if (document.hidden) this.desconectar();
    else { void this.cargar(); this.conectar(); }
  }

  private recargarConDebounce() {
    if (this.debounceId) clearTimeout(this.debounceId);
    this.debounceId = setTimeout(() => void this.cargar(), 2000);
  }

  private async cargar() {
    try {
      this.datos.set(await this.service.resumen());
      this.error.set('');
    } catch (e: unknown) {
      // El tablero nunca rompe el Inicio: error corto y sin jerga (regla 16).
      if (!this.datos()) this.error.set(e instanceof Error ? 'No se pudo cargar el tablero en vivo.' : '');
    }
  }

  hora(at: string): string {
    try {
      return new Date(at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  iconoEvento(tipo: string): string {
    return {
      requisicion: 'M9 13h6m-6 4h4M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
      conduce: 'M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
      entrega: 'M20 6 9 17l-5-5',
      combustible: 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M5 21h10M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3',
      uso: 'M8 5v14l11-7z',
      bitacora: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z',
    }[tipo] ?? 'M12 8v4l3 3';
  }
}
