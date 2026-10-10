import { Directive, ElementRef, inject, Input, OnChanges } from '@angular/core';
import { MOTION_IDS } from './catalogo-movimiento';
import { movimientoReducido } from './reduced-motion';

/**
 * CL2 — `appCountUp`: el número sube de 0 a su valor en 600ms (KPIs/dashboards).
 * Escribe el `textContent` del elemento. Con "reducidas" pone el valor final directo.
 *
 *   <span [appCountUp]="total()"></span>
 */
@Directive({ selector: '[appCountUp]' })
export class CountUpDirective implements OnChanges {
  readonly motionId = MOTION_IDS.baseCountUp;
  @Input('appCountUp') value = 0;
  /** Decimales a mostrar. */
  @Input() countUpDecimals = 0;
  @Input() countUpDurationMs = 600;

  private host = inject(ElementRef<HTMLElement>);
  private raf: number | null = null;

  ngOnChanges(): void {
    const target = Number(this.value) || 0;
    if (movimientoReducido() || this.countUpDurationMs <= 0) {
      this.render(target);
      return;
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / this.countUpDurationMs);
      // ease-out cuadrático
      const eased = 1 - (1 - t) * (1 - t);
      this.render(from + (target - from) * eased);
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private render(n: number): void {
    this.host.nativeElement.textContent = n.toLocaleString('es-DO', {
      minimumFractionDigits: this.countUpDecimals,
      maximumFractionDigits: this.countUpDecimals,
    });
  }
}
