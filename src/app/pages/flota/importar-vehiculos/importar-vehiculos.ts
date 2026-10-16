import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportarOdoo } from '../../../../shared/components/importar-odoo/importar-odoo';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/** CC4 (#87) — Importar vehículos: plantilla propia SGC (con fotos por .zip) u Odoo. */
@Component({
  selector: 'app-flota-importar-vehiculos',
  imports: [ImportarOdoo, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header__left">
        <a routerLink="/flota/vehiculos" class="sgc-btn sgc-btn--ghost sgc-btn--sm">{{ '← Vehículos' | t }}</a>
        <h1 class="page-title">{{ 'Importar vehículos' | t }}</h1>
        <p class="page-subtitle">{{ 'Descarga la plantilla, llénala y súbela — o sube un archivo exportado de Odoo. Reimportar actualiza, no duplica.' | t }}</p>
      </div>
    </div>
    <app-importar-odoo entidad="vehiculos" />
  `,
})
export class FlotaImportarVehiculos {}
