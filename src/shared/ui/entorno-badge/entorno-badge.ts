import { Component, ChangeDetectionStrategy } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * BU1 F6 — cinta "DEV" fija (esquina superior) cuando el entorno NO es prod.
 * También antepone "[DEV]" al <title> y marca el favicon en naranja, para que
 * nadie confunda dev con producción. En prod no renderiza nada.
 */
@Component({
  selector: 'app-entorno-badge',
  templateUrl: './entorno-badge.html',
  styleUrl: './entorno-badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntornoBadge {
  protected readonly esDev = environment.entorno !== 'prod';
  protected readonly ref = (environment.supabaseUrl.match(/\/\/([a-z0-9]+)\./)?.[1] ?? '').slice(0, 8);

  constructor() {
    if (!this.esDev || typeof document === 'undefined') return;
    document.title = '[DEV] ' + document.title.replace(/^\[DEV\]\s*/, '');
    const link = document.querySelector("link[rel='icon']");
    if (link) {
      link.setAttribute(
        'href',
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%23ff8c00'/><text x='8' y='12.5' font-size='11' font-weight='bold' text-anchor='middle' fill='white' font-family='sans-serif'>D</text></svg>",
      );
    }
  }
}
