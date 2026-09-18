import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '../icon/icon';
import { I18nService, IDIOMAS, Idioma } from '../../i18n/i18n.service';
import { I18N_COVERAGE, I18N_UMBRAL } from '../../i18n/i18n-coverage.generated';

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

  /** BT2/regla 17 — un idioma se OFRECE completo solo cuando cubre el alcance
   *  (≥95% en, ≥90% ht). `es` es el canónico. `en` por debajo del umbral se ofrece
   *  marcado *beta* (con la cobertura real en el tooltip). `ht` sin catálogo se
   *  muestra "próximamente" y NO se puede elegir — nunca se ofrece a medias. */
  estado(code: Idioma): 'ok' | 'beta' | 'proximamente' {
    if (code === 'es') return 'ok';
    const cov = I18N_COVERAGE[code as 'en' | 'ht'] ?? 0;
    const umbral = I18N_UMBRAL[code as 'en' | 'ht'] ?? 95;
    if (cov >= umbral) return 'ok';
    if (cov > 0) return 'beta';
    return 'proximamente';
  }
  cobertura(code: Idioma): number {
    return I18N_COVERAGE[code as 'en' | 'ht'] ?? 0;
  }
  disponible(code: Idioma): boolean {
    return this.estado(code) !== 'proximamente';
  }
  tooltip(code: Idioma): string {
    const e = this.estado(code);
    if (e === 'beta') return `Inglés cubre ${this.cobertura(code)}% de las pantallas; lo que falta se ve en español.`;
    if (e === 'proximamente') return 'Próximamente: aún no está traducido.';
    return '';
  }

  elegir(code: Idioma): void {
    if (!this.disponible(code)) return;
    void this.i18n.setIdioma(code);
  }
}
