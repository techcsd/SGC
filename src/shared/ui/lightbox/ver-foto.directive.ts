import { Directive, ElementRef, inject, input } from '@angular/core';
import { LightboxService } from './lightbox.service';

/**
 * CM5 — `appVerFoto`: sobre un avatar/imagen CON foto real, muestra cursor de lupa y
 * abre el Lightbox (nombre + descargar + Esc) al clic/Enter. Si no hay foto (iniciales),
 * no se aplica. Usa la MISMA URL que el usuario ya ve (no abre nada nuevo del bucket).
 *
 *   <img [src]="u.avatarUrl" appVerFoto [verFotoNombre]="u.nombre" />
 *   <img [src]="url" [appVerFoto]="urlGrande" [verFotoNombre]="nombre" />  (URL explícita)
 */
@Directive({
  selector: '[appVerFoto]',
  host: {
    '[style.cursor]': "'zoom-in'",
    '[attr.role]': "'button'",
    '[attr.tabindex]': '0',
    '[attr.aria-label]': "'Ver foto en grande'",
    '(click)': 'abrir($event)',
    '(keydown.enter)': 'abrir($event)',
    '(keydown.space)': 'abrir($event)',
  },
})
export class VerFotoDirective {
  /** URL explícita opcional; si se omite, usa el `src` del propio elemento. */
  appVerFoto = input<string>('');
  verFotoNombre = input<string>('');

  private host = inject(ElementRef<HTMLElement>);
  private lightbox = inject(LightboxService);

  abrir(ev: Event) {
    const el = this.host.nativeElement as HTMLImageElement;
    const src = this.appVerFoto() || el.getAttribute('src') || '';
    if (!src) return; // sin foto → no hace nada
    ev.preventDefault();
    ev.stopPropagation();
    this.lightbox.abrir(src, this.verFotoNombre());
  }
}
