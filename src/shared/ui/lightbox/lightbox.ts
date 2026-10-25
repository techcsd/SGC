import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';

/**
 * W11 — lightbox/modal compartido para ver una imagen en grande DENTRO de la
 * página (nunca en otra pestaña). Cierra con ✕, tecla Esc o clic fuera.
 *
 * CX3.4/CX5 — galería: si se pasa `images` con más de una URL, se agregan
 * flechas (◀ ▶, click y teclado) y un contador ("2 / 5"); con 0 o 1 imagen se
 * comporta exactamente igual que antes (sin flechas, solo `src`).
 *
 * Uso (una sola imagen, como siempre):
 *   @if (fotoLightbox()) {
 *     <app-lightbox [src]="fotoLightbox()!" alt="Foto" (closed)="fotoLightbox.set(null)" />
 *   }
 *
 * Uso (galería):
 *   <app-lightbox [images]="fotos()" [startIndex]="i" alt="Foto del reporte" (closed)="cerrar()" />
 */
@Component({
  selector: 'app-lightbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lightbox.html',
  styleUrl: './lightbox.scss',
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class Lightbox {
  /** URL (ya firmada) de la imagen a mostrar — usada tal cual si no hay `images`. */
  src = input<string>('');
  alt = input<string>('Imagen');
  /** CM5 — título opcional (p. ej. el nombre de la persona). */
  title = input<string>('');
  /** CX3.4/CX5 — todas las URLs del mismo grupo (fotos de un reporte/requisición). */
  images = input<string[]>([]);
  /** Índice inicial dentro de `images()`. */
  startIndex = input<number>(0);
  /** Emite cuando el usuario cierra (✕, Esc o clic fuera). */
  closed = output<void>();

  private indice = signal(0);

  constructor() {
    effect(() => {
      const inicio = this.startIndex();
      untracked(() => this.indice.set(inicio));
    });
  }

  /** La lista de imágenes, solo si hay más de una (si no, es un visor simple). */
  galeria = computed(() => (this.images().length > 1 ? this.images() : null));

  /** La imagen que se muestra ahora mismo. */
  actual = computed(() => this.galeria()?.[this.indice()] ?? this.src());

  contador = computed(() => {
    const g = this.galeria();
    return g ? `${this.indice() + 1} / ${g.length}` : '';
  });

  siguiente() {
    const g = this.galeria();
    if (!g) return;
    this.indice.set((this.indice() + 1) % g.length);
  }

  anterior() {
    const g = this.galeria();
    if (!g) return;
    this.indice.set((this.indice() - 1 + g.length) % g.length);
  }

  onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.closed.emit(); return; }
    if (e.key === 'ArrowRight') this.siguiente();
    else if (e.key === 'ArrowLeft') this.anterior();
  }
}
