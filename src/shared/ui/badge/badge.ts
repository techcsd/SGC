import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeVariant =
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'brand';

/**
 * app-badge — chip de estado del rediseño (BE3 / FASE 2).
 *
 * Reemplaza el "cada pantalla rueda su pill" (estudio §2.7, origen de los #ffb300 /
 * #ff5f00 sueltos). El color sale del par estado→`--{estado}` / `--{estado}-bg`.
 * Un icono SVG opcional se proyecta al frente (contenido = el texto).
 *
 *   <app-badge variant="success"><svg …></svg>Sin incidencias</app-badge>
 */
@Component({
  selector: 'app-badge',
  templateUrl: './badge.html',
  styleUrl: './badge.scss',
  host: { '[class]': "'b-' + variant()" },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Badge {
  variant = input<BadgeVariant>('neutral');
}
