import { Directive, ElementRef, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import { formatearTelefono } from '../utils/telefono.util';

/**
 * U5 — máscara de teléfono RD en vivo: al teclear formatea a `(809) 555-1234`.
 * Uso: `<input appTelefono formControlName="telefono">`. Funciona con Reactive
 * Forms (escribe el valor formateado en el control). El display es formateado;
 * la BD normaliza a dígitos con sgc.normalizar_telefono.
 */
@Directive({
  selector: 'input[appTelefono]',
  standalone: true,
  host: { '(input)': 'onInput()', '(blur)': 'onInput()' },
})
export class TelefonoMask {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private control = inject(NgControl, { optional: true });

  onInput() {
    const formatted = formatearTelefono(this.el.nativeElement.value);
    this.el.nativeElement.value = formatted;
    this.control?.control?.setValue(formatted, { emitEvent: false });
  }
}
