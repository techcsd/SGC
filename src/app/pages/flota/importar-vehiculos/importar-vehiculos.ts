import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportarOdoo } from '../../../../shared/components/importar-odoo/importar-odoo';

/** CC4 (#87) — Importar vehículos desde Odoo, dentro de Flota. */
@Component({
  selector: 'app-flota-importar-vehiculos',
  imports: [ImportarOdoo, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header__left">
        <a routerLink="/flota/vehiculos" class="sgc-btn sgc-btn--ghost sgc-btn--sm">← Vehículos</a>
        <h1 class="page-title">Importar vehículos desde Odoo</h1>
        <p class="page-subtitle">Sube el archivo tal como sale de Odoo (fleet.vehicle). Reimportar actualiza, no duplica.</p>
      </div>
    </div>
    <app-importar-odoo entidad="vehiculos" />
  `,
})
export class FlotaImportarVehiculos {}
