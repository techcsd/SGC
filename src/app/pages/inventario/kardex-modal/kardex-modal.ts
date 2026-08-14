import { Component, ChangeDetectionStrategy, inject, input, output, signal, computed, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import {
  InventarioAlmacenService,
  Kardex,
  KardexMovimiento,
} from '../../../../shared/services/inventario-almacen.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/**
 * AP3 — Kardex por artículo×almacén (el sketch de Xaviel manda): tabla de
 * movimientos (Mov|Origen|Destino|Fecha|Entrega|Recibe|Transporte|Conduce +
 * cantidad + saldo), filtros (tipo/transportista/quien entrega/rango de fechas),
 * y un timeline del stock. Cada fila con conduce enlaza a su detalle (fotos/firmas).
 */
@Component({
  selector: 'app-kardex-modal',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './kardex-modal.html',
  styleUrl: './kardex-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KardexModal {
  private service = inject(InventarioAlmacenService);
  formatFecha = formatFechaDisplay;

  articuloId = input.required<string>();
  bodegaId = input.required<string>();
  articuloNombre = input<string>('');
  bodegaNombre = input<string>('');

  close = output<void>();

  loading = signal(true);
  error = signal('');
  data = signal<Kardex | null>(null);

  // Filtros (client-side sobre los movimientos; la serie del timeline no se filtra).
  fTipo = signal<string>('');
  fTransportista = signal<string>('');
  fEntrega = signal<string>('');
  fDesde = signal<string>('');
  fHasta = signal<string>('');

  constructor() {
    effect(() => {
      const art = this.articuloId();
      const bod = this.bodegaId();
      if (art && bod) this.load(art, bod);
    });
  }

  private async load(art: string, bod: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.service.getKardex(art, bod));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el kardex.');
    } finally {
      this.loading.set(false);
    }
  }

  movimientos = computed(() => this.data()?.movimientos ?? []);

  transportistas = computed(() => {
    const s = new Set<string>();
    for (const m of this.movimientos()) if (m.transporte_nombre) s.add(m.transporte_nombre);
    return [...s].sort((a, b) => a.localeCompare(b));
  });

  entregadores = computed(() => {
    const s = new Set<string>();
    for (const m of this.movimientos()) if (m.entrega_nombre) s.add(m.entrega_nombre);
    return [...s].sort((a, b) => a.localeCompare(b));
  });

  filtrados = computed<KardexMovimiento[]>(() => {
    const tipo = this.fTipo();
    const trans = this.fTransportista();
    const entrega = this.fEntrega();
    const desde = this.fDesde();
    const hasta = this.fHasta();
    return this.movimientos().filter((m) => {
      if (tipo && m.mov !== tipo) return false;
      if (trans && m.transporte_nombre !== trans) return false;
      if (entrega && m.entrega_nombre !== entrega) return false;
      if (desde && m.fecha < desde) return false;
      if (hasta && m.fecha > hasta) return false;
      return true;
    });
  });

  hasFilters = computed(
    () => !!this.fTipo() || !!this.fTransportista() || !!this.fEntrega() || !!this.fDesde() || !!this.fHasta(),
  );

  clearFilters() {
    this.fTipo.set('');
    this.fTransportista.set('');
    this.fEntrega.set('');
    this.fDesde.set('');
    this.fHasta.set('');
  }

  movLabel(m: KardexMovimiento): string {
    return m.mov === 'entrada' ? 'Entrada' : m.mov === 'salida' ? 'Salida' : 'Ajuste';
  }

  // ── Timeline (SVG sparkline de la serie: apertura + Σ movimientos) ──────────
  readonly VW = 640;
  readonly VH = 120;
  readonly PAD = 8;

  /** Puntos [x,y] escalados de la serie del stock en el tiempo. */
  timeline = computed<{ points: string; base: string; min: number; max: number } | null>(() => {
    const d = this.data();
    if (!d) return null;
    const serie = d.serie ?? [];
    // El primer punto de la curva es la apertura (base), antes del primer movimiento.
    const ys = [d.apertura, ...serie.map((p) => p.saldo)];
    if (ys.length < 1) return null;
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min || 1;
    const n = ys.length;
    const w = this.VW - this.PAD * 2;
    const h = this.VH - this.PAD * 2;
    const toXY = (v: number, i: number) => {
      const x = this.PAD + (n === 1 ? w / 2 : (i / (n - 1)) * w);
      const y = this.PAD + h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    const points = ys.map((v, i) => toXY(v, i)).join(' ');
    // Línea base de la apertura (referencia horizontal).
    const yBase = this.PAD + h - ((d.apertura - min) / span) * h;
    const base = `${this.PAD},${yBase.toFixed(1)} ${this.PAD + w},${yBase.toFixed(1)}`;
    return { points, base, min, max };
  });
}
