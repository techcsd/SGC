import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { todayIso, daysAgoIso, formatFechaDisplay } from '../../utils/fecha.util';

export interface RangoFecha {
  desde: string | null; // YYYY-MM-DD
  hasta: string | null; // YYYY-MM-DD
}

interface Preset {
  label: string;
  dias: number; // días hacia atrás (incluye hoy); 0 = hoy
}

/**
 * R12 — Filtro de fechas unificado con presets.
 * Botón "Filtrar por fecha" → popover con presets (Hoy, 7, 15 días, 1, 3, 6, 12
 * meses) + rango personalizado inicio–fin. El rango activo se muestra como chip
 * removible. Emite `{desde, hasta}` (YYYY-MM-DD o null). Reemplaza los pares
 * nativos Desde/Hasta.
 */
@Component({
  selector: 'app-date-range-filter',
  imports: [],
  templateUrl: './date-range-filter.html',
  styleUrl: './date-range-filter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateRangeFilter {
  /** Rango controlado por el padre (para reflejar estado inicial / limpieza). */
  desde = input<string | null>(null);
  hasta = input<string | null>(null);

  rangeChange = output<RangoFecha>();

  readonly today = todayIso();
  readonly PRESETS: Preset[] = [
    { label: 'Hoy', dias: 0 },
    { label: '7 días', dias: 6 },
    { label: '15 días', dias: 14 },
    { label: '1 mes', dias: 29 },
    { label: '3 meses', dias: 89 },
    { label: '6 meses', dias: 179 },
    { label: '12 meses', dias: 364 },
  ];

  private host = inject(ElementRef<HTMLElement>);

  open = signal(false);
  // T10 — cuando el botón está pegado al borde derecho (ej. Combustible) el
  // popover anclado a la izquierda se sale de la pantalla; en ese caso lo
  // anclamos a la derecha. Se recalcula al abrir.
  alignRight = signal(false);
  // Borrador del rango custom mientras el popover está abierto.
  draftDesde = signal<string | null>(null);
  draftHasta = signal<string | null>(null);

  activo = computed(() => !!(this.desde() || this.hasta()));

  chipLabel = computed(() => {
    const d = this.desde();
    const h = this.hasta();
    if (d && h) return `${formatFechaDisplay(d)} – ${formatFechaDisplay(h)}`;
    if (d) return `Desde ${formatFechaDisplay(d)}`;
    if (h) return `Hasta ${formatFechaDisplay(h)}`;
    return 'Filtrar por fecha';
  });

  toggle() {
    this.draftDesde.set(this.desde());
    this.draftHasta.set(this.hasta());
    const willOpen = !this.open();
    if (willOpen) {
      const POP_WIDTH = 280;
      const rect = (this.host.nativeElement as HTMLElement).getBoundingClientRect();
      // Si el popover anclado a la izquierda se saldría por la derecha, lo
      // anclamos a la derecha del contenedor.
      this.alignRight.set(rect.left + POP_WIDTH > window.innerWidth - 8);
    }
    this.open.set(willOpen);
  }

  aplicarPreset(p: Preset) {
    const desde = p.dias === 0 ? this.today : daysAgoIso(p.dias);
    this.rangeChange.emit({ desde, hasta: this.today });
    this.open.set(false);
  }

  aplicarCustom() {
    this.rangeChange.emit({ desde: this.draftDesde() || null, hasta: this.draftHasta() || null });
    this.open.set(false);
  }

  limpiar() {
    this.draftDesde.set(null);
    this.draftHasta.set(null);
    this.rangeChange.emit({ desde: null, hasta: null });
    this.open.set(false);
  }
}
