import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ImportarOdoo } from '../../../../shared/components/importar-odoo/importar-odoo';

import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
/** BT1/CC4 — "Importar datos" (Tecnología). Envuelve el asistente reutilizable
 *  sin entidad fija (elige entre proveedores/vehículos/artículos). El mismo
 *  componente se monta en Compras/Flota/Inventario con la entidad preseleccionada. */
@Component({
  selector: 'app-admin-importar',
  imports: [ImportarOdoo, TranslatePipe],
  templateUrl: './importar.html',
  styleUrl: './importar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminImportar {}
