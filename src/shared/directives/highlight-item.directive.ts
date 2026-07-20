import { Directive, ElementRef, inject, input, AfterViewInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * Q2 — Resaltado de ítem señalado por una notificación.
 *
 * Patrón genérico: las notificaciones apuntan a `/ruta?item={id}`. Cada fila de
 * la lista destino declara `[appHighlightItem]="registro.id"`; la directiva lee
 * `item` de la ruta y, si coincide, hace scroll al registro y le aplica una
 * clase de resaltado temporal (`item-highlight`, definida global en styles.scss).
 *
 * Uso:
 *   <tr [appHighlightItem]="s.id"> … </tr>
 */
@Directive({
  selector: '[appHighlightItem]',
})
export class HighlightItemDirective implements AfterViewInit {
  appHighlightItem = input.required<string | null | undefined>();

  private el = inject(ElementRef<HTMLElement>);
  private route = inject(ActivatedRoute);

  ngAfterViewInit(): void {
    const target = this.route.snapshot.queryParamMap.get('item');
    if (!target || target !== this.appHighlightItem()) return;

    // Espera un frame a que la lista termine de pintar antes de hacer scroll.
    setTimeout(() => {
      const node = this.el.nativeElement;
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.classList.add('item-highlight');
      setTimeout(() => node.classList.remove('item-highlight'), 3000);
    }, 150);
  }
}
