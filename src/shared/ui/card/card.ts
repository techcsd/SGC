import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * app-card — tarjeta base del rediseño moderno-sobrio (BE3 / FASE 2).
 *
 * Mata el sprawl de "cada pantalla inventa su tarjeta" (estudio §2.7): una sola
 * superficie con `--surface` / `--border` / `--radius-lg` / `--shadow-sm`, tokens
 * semánticos → themea claro y oscuro sin tocar nada.
 *
 * Uso:
 *   <app-card heading="Actividad reciente">
 *     <a actions href="…">Ver todo →</a>
 *     …cuerpo…
 *   </app-card>
 *
 *   <app-card [flush]="true">…tabla a sangre…</app-card>  // sin padding en el cuerpo
 */
@Component({
  selector: 'app-card',
  templateUrl: './card.html',
  styleUrl: './card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Card {
  /** Título opcional; si viene, dibuja la barra de encabezado. */
  heading = input<string>('');
  /** Cuerpo sin padding (para tablas / listas a sangre). */
  flush = input(false);
}
