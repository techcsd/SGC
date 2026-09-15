import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/**
 * BO10 — miniatura SVG de una figura de doblado de acero (recta, L, U, estribo,
 * gancho, Z). Inline `stroke="currentColor"` (regla AW12 — SVG, no emojis). Se dibuja
 * por `codigo`; las figuras que el catálogo agregue a futuro caen al ícono genérico.
 */
@Component({
  selector: 'app-cartilla-figura-icono',
  imports: [],
  template: `<svg viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" [attr.width]="size()" [attr.height]="size() * 0.6"
      role="img" [attr.aria-label]="codigo()">
      @switch (codigo()) {
        @case ('recta') { <path d="M4 12 H36" /> }
        @case ('l') { <path d="M6 4 V20 H34" /> }
        @case ('u') { <path d="M8 4 V20 H32 V4" /> }
        @case ('estribo') { <rect x="6" y="5" width="28" height="14" rx="1" /> }
        @case ('gancho') { <path d="M8 20 V8 a5 5 0 0 1 10 0" /> }
        @case ('z') { <path d="M6 5 H26 L14 19 H34" /> }
        @default { <path d="M4 12 H36" /> }
      }
    </svg>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartillaFiguraIcono {
  codigo = input<string | null>(null);
  size = input<number>(28);
}
