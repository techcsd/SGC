import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportarOdoo } from '../../../../shared/components/importar-odoo/importar-odoo';

/** CC4 (#87) — Importar proveedores desde Odoo, dentro de Compras (para Raykler). */
@Component({
  selector: 'app-compras-importar-proveedores',
  imports: [ImportarOdoo, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header__left">
        <a routerLink="/compras/proveedores" class="sgc-btn sgc-btn--ghost sgc-btn--sm">← Proveedores</a>
        <h1 class="page-title">Importar proveedores desde Odoo</h1>
        <p class="page-subtitle">Sube el archivo tal como sale de Odoo (res.partner). Reimportar actualiza, no duplica.</p>
      </div>
    </div>
    <app-importar-odoo entidad="proveedores" />
  `,
})
export class ComprasImportarProveedores {}
