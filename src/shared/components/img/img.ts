import { Component, ChangeDetectionStrategy, input, signal, computed } from '@angular/core';

/**
 * P3 — Imagen con placeholder + fade-in. Reserva el espacio (aspect-ratio o
 * alto fijo), muestra un shimmer hasta el evento `load`, hace fade-in al cargar
 * y usa loading="lazy" + decoding="async". Ante error muestra un ícono neutro.
 *
 * Uso:
 *   <app-img [src]="url" alt="Foto" ratio="4/3" />
 *   <app-img [src]="url" alt="Foto" [height]="72" fit="contain" />
 */
@Component({
  selector: 'app-img',
  templateUrl: './img.html',
  styleUrl: './img.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-img-host' },
})
export class Img {
  /** URL de la imagen (o null: muestra placeholder sin intentar cargar). */
  src = input<string | null | undefined>(null);
  alt = input<string>('');
  /** aspect-ratio CSS, ej. '16/9', '4/3', '1'. */
  ratio = input<string | null>(null);
  /** Alto fijo en px (alternativa a ratio). */
  height = input<number | null>(null);
  /** object-fit de la imagen. */
  fit = input<'cover' | 'contain'>('cover');
  /** Bordes redondeados. */
  rounded = input<boolean>(true);
  /** Emoji/placeholder cuando no hay imagen o falla. */
  fallback = input<string>('🖼️');

  loaded = signal(false);
  errored = signal(false);

  boxStyle = computed(() => {
    const s: Record<string, string> = {};
    if (this.height() != null) s['height'] = `${this.height()}px`;
    else if (this.ratio()) s['aspect-ratio'] = this.ratio()!;
    return s;
  });

  onLoad() {
    this.loaded.set(true);
  }
  onError() {
    this.errored.set(true);
    this.loaded.set(true);
  }
}
