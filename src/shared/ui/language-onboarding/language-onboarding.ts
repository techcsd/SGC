import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { I18nService, IDIOMAS, Idioma } from '../../i18n/i18n.service';
import { I18N_COVERAGE, I18N_UMBRAL } from '../../i18n/i18n-coverage.generated';
import { PreferenciasService } from '../../services/preferencias.service';

/**
 * BS4 (#39) — diálogo de PRIMER INGRESO de idioma. Tras un login exitoso, si el
 * usuario nunca ha elegido idioma (`idioma_elegido_at` es null) muestra un modal
 * bloqueante (sin cancelar) con las 3 opciones. Preseleccionado = idioma del
 * navegador si ∈ {es,en,ht}. Al confirmar, sella `idioma_elegido_at` (vía
 * `set_mi_preferencia`) → nunca vuelve a salir, ni en otro dispositivo ni en la
 * app (misma columna canónica). Usuarios existentes lo ven UNA vez.
 */
@Component({
  selector: 'app-language-onboarding',
  imports: [],
  templateUrl: './language-onboarding.html',
  styleUrl: './language-onboarding.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageOnboarding implements OnInit {
  private i18n = inject(I18nService);
  private prefs = inject(PreferenciasService);

  idiomas = IDIOMAS;
  visible = signal(false);
  guardando = signal(false);
  elegido = signal<Idioma>('es');

  async ngOnInit() {
    try {
      const p = await this.prefs.cargar();
      if (p && !p.idioma_elegido_at) {
        const nav = this.i18n.idiomaNavegador();
        // BT2/regla 17 — no preseleccionar un idioma que no se ofrece ("próximamente").
        this.elegido.set(this.disponible(nav) ? nav : 'es');
        this.visible.set(true);
      }
    } catch {
      /* sin sesión / RPC ausente → no molestar */
    }
  }

  // BT2/regla 17 — misma honestidad que el selector (beta / próximamente).
  estado(code: Idioma): 'ok' | 'beta' | 'proximamente' {
    if (code === 'es') return 'ok';
    const cov = I18N_COVERAGE[code as 'en' | 'ht'] ?? 0;
    const umbral = I18N_UMBRAL[code as 'en' | 'ht'] ?? 95;
    if (cov >= umbral) return 'ok';
    return cov > 0 ? 'beta' : 'proximamente';
  }
  cobertura(code: Idioma): number { return I18N_COVERAGE[code as 'en' | 'ht'] ?? 0; }
  disponible(code: Idioma): boolean { return this.estado(code) !== 'proximamente'; }

  elegir(code: Idioma) {
    if (!this.disponible(code)) return;
    this.elegido.set(code);
  }

  async confirmar() {
    this.guardando.set(true);
    const code = this.elegido();
    try {
      // Sella idioma_elegido_at + escribe usuarios.idioma (canónico).
      await this.prefs.set('idioma', code);
      // Aplica el idioma en la UI al instante (carga catálogo si hace falta).
      await this.i18n.setIdioma(code);
      this.visible.set(false);
    } catch {
      // Si falla el guardado, no cerramos: el usuario reintenta.
    } finally {
      this.guardando.set(false);
    }
  }
}
