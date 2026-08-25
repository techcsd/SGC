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

  // AX7 — mientras se edita, permitir el campo vacío (o entradas intermedias como
  // "." o "-") sin forzar el valor a min ni tocar el renglón. Solo emitimos cuando
  // hay un número válido; la normalización ocurre al salir del campo (onBlur).
  onInput(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const n = parseFloat(trimmed);
    if (isNaN(n)) return;
    this.valueChange.emit(this.clamp(n));
  }

  // AX7 — al salir del campo, si quedó vacío/incompleto vuelve a un valor válido
  // (el actual, o min) y re-sincroniza el DOM. Nunca elimina el renglón.
  onBlur(el: HTMLInputElement): void {
    const n = parseFloat(el.value);
    const normalized = isNaN(n) ? (this.value() ?? this.min()) : this.clamp(n);
    el.value = String(normalized);
    this.valueChange.emit(normalized);
  }

  // AX7 — seleccionar todo al enfocar: tocar un campo con "1" y teclear "25" da 25, no 125.
  onFocus(el: HTMLInputElement): void {
    el.select();
  }
}
