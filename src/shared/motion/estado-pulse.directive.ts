import { Directive, ElementRef, inject, Input, OnChanges } from '@angular/core';
import { MOTION_IDS } from './catalogo-movimiento';
import { movimientoReducido } from './reduced-motion';

/**
 * CL2 — `appEstadoPulse`: cuando el estado (el valor ligado) cambia, el chip late una
 * vez (escala corta). Para chips de estado en tablas, tarjetas y fichas. Con
 * "reducidas" cambia de color sin latido.
 *
 *   <span class="sgc-badge" [appEstadoPulse]="estado()">{{ estado() }}</span>
 */
@Directive({ selector: '[appEstadoPulse]' })
export class EstadoPulseDirective implements OnChanges {
  readonly motionId = MOTION_IDS.baseEstadoPulse;
  @Input('appEstadoPulse') estado: unknown;

  private host = inject(ElementRef<HTMLElement>);
  private primero = true;

  ngOnChanges(): void {
    // No late en la primera pintura (solo cuando CAMBIA de estado).
    if (this.primero) { this.primero = false; return; }
    if (movimientoReducido()) return;
    const el = this.host.nativeElement;
    el.classList.remove('mv-estado-pulse');
    // reflow para reiniciar la animación
    void el.offsetWidth;
    el.classList.add('mv-estado-pulse');
  }
}
