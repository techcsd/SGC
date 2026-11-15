import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '../icon/icon';
import { I18nService, IDIOMAS, Idioma } from '../../i18n/i18n.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { I18N_COVERAGE, I18N_UMBRAL } from '../../i18n/i18n-coverage.generated';

const NOMBRE_IDIOMA: Record<Idioma, string> = { es: 'Español', en: 'Inglés', ht: 'Kreyòl ayisyen' };

/**
 * BS4 — selector de idioma reutilizable (lista con el nombre NATIVO de cada
 * idioma + bandera). Se usa en Configuración › Idioma y en el diálogo de primer
 * ingreso. Cambio inmediato (signals), sin recargar. La bandera es CONTENIDO
 * (no icono de botón) → emoji permitido por AW12; el check es SVG.
 */
@Component({
  selector: 'app-language-selector',
  imports: [Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './language-selector.html',
  styleUrl: './language-selector.scss',
})
export class LanguageSelector {
  private i18n = inject(I18nService);
  idiomas = IDIOMAS;
  actual = this.i18n.idioma;

  /** DP-12 — un idioma se OFRECE completo solo cuando el escáner mide 100% de
   *  TODAS las pantallas (`I18N_UMBRAL`, nunca se pone `ok` a mano — lo decide
   *  el número generado por `scripts/i18n-coverage.mjs`). `es` es el canónico.
   *  Por debajo del umbral se ofrece marcado *beta* (cobertura real en el
   *  tooltip); en 0% se muestra "próximamente" y NO se puede elegir. */
  estado(code: Idioma): 'ok' | 'beta' | 'proximamente' {
    if (code === 'es') return 'ok';
    const cov = I18N_COVERAGE[code as 'en' | 'ht'] ?? 0;
    const umbral = I18N_UMBRAL[code as 'en' | 'ht'] ?? 100;
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
    const nombre = this.i18n.t(NOMBRE_IDIOMA[code] ?? code);
    if (e === 'beta') return this.i18n.t('{nombre} cubre {cov}% de las pantallas; lo que falta se ve en español.', { nombre, cov: this.cobertura(code) });
    if (e === 'proximamente') return this.i18n.t('Próximamente: aún no está traducido.');
    return '';
  }

  elegir(code: Idioma): void {
    if (!this.disponible(code)) return;
    void this.i18n.setIdioma(code);
  }
}
