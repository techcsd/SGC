import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportarOdoo } from '../../../../shared/components/importar-odoo/importar-odoo';

/** CC4 (#87) — Importar artículos desde Odoo, dentro de Inventario. */
@Component({
  selector: 'app-inventario-importar-articulos',
  imports: [ImportarOdoo, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header__left">
        <a routerLink="/inventario/articulos" class="sgc-btn sgc-btn--ghost sgc-btn--sm">← Artículos</a>
        <h1 class="page-title">Importar artículos desde Odoo</h1>
        <p class="page-subtitle">Sube el archivo tal como sale de Odoo (product.template). Reimportar actualiza, no duplica.</p>
      </div>
    </div>
    <app-importar-odoo entidad="articulos" />
  `,
})
export class InventarioImportarArticulos {}
