import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * W11 — lightbox/modal compartido para ver una imagen en grande DENTRO de la
 * página (nunca en otra pestaña). Cierra con ✕, tecla Esc o clic fuera.
 *
 * Uso:
 *   @if (fotoLightbox()) {
 *     <app-lightbox [src]="fotoLightbox()!" alt="Foto" (closed)="fotoLightbox.set(null)" />
 *   }
 */
@Component({
  selector: 'app-lightbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lightbox.html',
  styleUrl: './lightbox.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class Lightbox {
  /** URL (ya firmada) de la imagen a mostrar. */
  src = input.required<string>();
  alt = input<string>('Imagen');
  /** Emite cuando el usuario cierra (✕, Esc o clic fuera). */
  closed = output<void>();
}
