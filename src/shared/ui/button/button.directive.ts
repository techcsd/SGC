import { Directive, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm';

/**
 * appButton — botón base del rediseño (BE3 / FASE 2).
 *
 * Es una DIRECTIVA de atributo, no un componente envoltorio, a propósito: se aplica
 * sobre el `<button>`/`<a>` nativo y así conserva `type="submit"`, `disabled`,
 * `routerLink`, foco y semántica de formulario — un `<app-button>` los rompería
 * (regla dura #7: mejor diseño a largo plazo). Los estilos viven en
 * `styles/_components.scss` (globales, porque una directiva no encapsula CSS).
 *
 *   <button appButton variant="primary">Guardar</button>
 *   <a appButton variant="ghost" routerLink="/x">Cancelar</a>
 */
@Directive({
  selector: 'button[appButton], a[appButton]',
  host: {
    '[class.ui-btn]': 'true',
    '[class.ui-btn--primary]': "variant() === 'primary'",
    '[class.ui-btn--secondary]': "variant() === 'secondary'",
    '[class.ui-btn--danger]': "variant() === 'danger'",
    '[class.ui-btn--ghost]': "variant() === 'ghost'",
    '[class.ui-btn--sm]': "size() === 'sm'",
  },
})
export class ButtonDirective {
  variant = input<ButtonVariant>('primary');
  size = input<ButtonSize>('md');
}
