import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICON_PATHS, IconName } from './icons';

/**
 * app-icon — el set de iconos SVG único del rediseño (BE4). Reemplaza el emoji
 * como icono (regla AW12) y mata el sprawl de SVG inline copiado por template.
 *
 *   <app-icon name="truck" />
 *   <app-icon name="alert-triangle" [size]="16" />
 *   <app-icon name="user" ariaLabel="Conductor" />   <!-- si es informativo -->
 *
 * Por defecto es decorativo (aria-hidden). Los paths viven en `icons.ts`; son
 * markup estático de confianza, por eso se inyecta con bypass del sanitizer.
 */
@Component({
  selector: 'app-icon',
  templateUrl: './icon.html',
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  private sanitizer = inject(DomSanitizer);

  name = input.required<IconName>();
  size = input(20);
  /** Si se da, el icono es informativo (role=img + aria-label); si no, decorativo. */
  ariaLabel = input<string>('');

  protected svg = computed<SafeHtml>(() => {
    const s = this.size();
    const body = ICON_PATHS[this.name()] ?? '';
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" ` +
        `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
        `stroke-linejoin="round">${body}</svg>`,
    );
  });
}
