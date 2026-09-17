import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '../icon/icon';
import { I18nService, IDIOMAS, Idioma } from '../../i18n/i18n.service';

/**
 * BS4 — selector de idioma reutilizable (lista con el nombre NATIVO de cada
 * idioma + bandera). Se usa en Configuración › Idioma y en el diálogo de primer
 * ingreso. Cambio inmediato (signals), sin recargar. La bandera es CONTENIDO
 * (no icono de botón) → emoji permitido por AW12; el check es SVG.
 */
@Component({
  selector: 'app-language-selector',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './language-selector.html',
  styleUrl: './language-selector.scss',
})
export class LanguageSelector {
  private i18n = inject(I18nService);
  idiomas = IDIOMAS;
  actual = this.i18n.idioma;

  elegir(code: Idioma): void {
    void this.i18n.setIdioma(code);
  }
}
