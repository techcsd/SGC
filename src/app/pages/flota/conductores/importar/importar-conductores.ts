import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportarOdoo } from '../../../../../shared/components/importar-odoo/importar-odoo';
import { TranslatePipe } from '../../../../../shared/i18n/translate.pipe';

/** Importar choferes desde una plantilla de Excel (descargable desde el paso 2),
 *  con fotos opcionales vía .zip emparejado por nombre de archivo. */
@Component({
  selector: 'app-flota-importar-conductores',
  imports: [ImportarOdoo, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header__left">
        <a routerLink="/flota/conductores" class="sgc-btn sgc-btn--ghost sgc-btn--sm">{{ '← Conductores' | t }}</a>
        <h1 class="page-title">{{ 'Importar choferes' | t }}</h1>
        <p class="page-subtitle">{{ 'Sube el archivo tal como sale de tu plantilla. Reimportar actualiza por cédula, no duplica.' | t }}</p>
      </div>
    </div>
    <app-importar-odoo entidad="conductores" />
  `,
})
export class FlotaImportarConductores {}
