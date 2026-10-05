import { Directive, ElementRef, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import { formatearCedula, normalizarCedula, digitosAntesDe, cursorTrasDigitos } from '../utils/cedula.util';

/**
 * CG3 — máscara de cédula dominicana en vivo: al teclear y al pegar formatea a
 * `000-0000000-0` con el cursor estable. Escribe el valor FORMATEADO en el control
 * (el servidor normaliza a dígitos con normalizarCedula / sgc.normalizar_cedula).
 * Uso: `<input appCedula formControlName="cedula">`. Para pasaporte/extranjera NO se
 * aplica (el campo no lleva la directiva cuando el tipo de documento lo permite).
 */
@Directive({
  selector: 'input[appCedula]',
  standalone: true,
  host: { '(input)': 'onInput()', '(blur)': 'onInput()' },
})
export class CedulaMask {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private control = inject(NgControl, { optional: true });

  onInput() {
    const input = this.el.nativeElement;
    const prev = input.value;
    const cursor = input.selectionStart ?? prev.length;
    const digitosPrevios = digitosAntesDe(prev, cursor);

    const formatted = formatearCedula(prev);
    input.value = formatted;
    this.control?.control?.setValue(formatted, { emitEvent: false });

    // Reposiciona el cursor tras la misma cantidad de dígitos (estable al insertar guiones).
    const pos = cursorTrasDigitos(formatted, Math.min(digitosPrevios, normalizarCedula(formatted).length));
    try { input.setSelectionRange(pos, pos); } catch { /* algunos inputs no lo soportan */ }
  }
}
