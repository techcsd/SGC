import { Directive, ElementRef, inject, Input, AfterViewInit } from '@angular/core';
import { MOTION_IDS } from './catalogo-movimiento';
import { movimientoReducido } from './reduced-motion';

/**
 * CL2 — `appStagger`: entrada escalonada de los hijos directos (listas/tablas/tarjetas).
 * 30ms entre uno y otro, máx. 8 (los demás entran a la vez), SOLO la primera carga.
 * Solo `transform`/`opacity`. Con "reducidas" aparecen sin desplazamiento.
 *
 *   <tbody appStagger> … </tbody>   ·   <div class="cards" appStagger> … </div>
 */
@Directive({ selector: '[appStagger]' })
export class StaggerDirective implements AfterViewInit {
  /** Id del registro de movimiento (para el catálogo CL5). */
  readonly motionId = MOTION_IDS.baseStagger;
  /** Paso entre hijos (ms). */
  @Input() staggerStep = 30;
  /** Máximo de hijos con retraso creciente. */
  @Input() staggerMax = 8;

  private host = inject(ElementRef<HTMLElement>);

  ngAfterViewInit(): void {
    if (movimientoReducido()) return;
    const children = Array.from(this.host.nativeElement.children) as HTMLElement[];
    children.forEach((el, i) => {
      const delay = Math.min(i, this.staggerMax) * this.staggerStep;
      el.style.animation = `mv-stagger-in var(--motion-base, 220ms) var(--ease-out, ease) ${delay}ms both`;
    });
  }
}
