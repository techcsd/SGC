import { ChangeDetectionStrategy, Component, computed, effect, input, model } from '@angular/core';

/**
 * Paginador reutilizable del sistema de diseño.
 *
 * Uso:
 *   <app-paginator [total]="filtered().length" [pageSize]="PAGE_SIZE" [(page)]="page" />
 *
 * Sin dependencias: solo signals + CSS vars. La página se expone como `model`
 * para two-way binding; también emite `pageChange` para quienes solo escuchen.
 */
@Component({
  selector: 'app-paginator',
  templateUrl: './paginator.html',
  styleUrl: './paginator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Paginator {
  /** Total de elementos (sin paginar). */
  total = input.required<number>();
  /** Cantidad de elementos por página. */
  pageSize = input.required<number>();
  /** Página actual (1-based). Two-way: [(page)]. */
  page = model<number>(1);

  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  /** Índice del primer elemento mostrado (1-based). */
  desde = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1));
  /** Índice del último elemento mostrado. */
  hasta = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  constructor() {
    // Red de seguridad: si el total se encoge (borrados, filtros) y la página
    // actual queda fuera de rango, la reencuadra para no dejar una página vacía.
    effect(() => {
      const max = this.totalPages();
      if (this.page() > max) this.page.set(max);
    });
  }

  prev() {
    if (this.page() > 1) this.page.set(this.page() - 1);
  }

  next() {
    if (this.page() < this.totalPages()) this.page.set(this.page() + 1);
  }
}
