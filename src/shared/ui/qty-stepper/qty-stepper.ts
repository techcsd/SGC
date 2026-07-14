import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Selector de cantidad con botones − / + además del input numérico (R17).
 * Presentacional: recibe `value` y emite `valueChange` con el nuevo número.
 */
@Component({
  selector: 'app-qty-stepper',
  templateUrl: './qty-stepper.html',
  styleUrl: './qty-stepper.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QtyStepper {
  value = input<number | null>(null);
  min = input(0);
  step = input(1);
  disabled = input(false);
  ariaLabel = input('Cantidad');
  valueChange = output<number>();

  private clamp(n: number): number {
    const min = this.min();
    return n < min ? min : n;
  }

  dec(): void {
    if (this.disabled()) return;
    const current = this.value() ?? this.min();
    this.valueChange.emit(this.clamp(+(current - this.step()).toFixed(4)));
  }

  inc(): void {
    if (this.disabled()) return;
    const current = this.value() ?? this.min();
    this.valueChange.emit(this.clamp(+(current + this.step()).toFixed(4)));
  }

  onInput(raw: string): void {
    const n = parseFloat(raw);
    this.valueChange.emit(isNaN(n) ? this.min() : this.clamp(n));
  }
}
