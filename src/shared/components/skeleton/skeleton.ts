import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Reusable shimmer skeleton shown while data loads, so a page never appears
 * blank or frozen. `variant` picks the shape; `rows` the count.
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
})
export class Skeleton {
  /** table = rows of bars · list = stacked cards · cards = responsive grid. */
  variant = input<'table' | 'list' | 'cards'>('table');
  rows = input(6);

  items = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}
