// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.222.5';
export const APP_VERSION_TITULO: string | null = "El almacén muestra el stock real de Odoo 19";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"arreglo","m":"Inventario","d":"Tras la actualización de Odoo a la versión 19, los almacenes y las requisiciones mostraban todo en 0: SGC solo conocía una parte de los productos de Odoo. Ahora cada sondeo importa los productos de Odoo con existencias (quedan en «Revisión» para clasificarlos) y su stock aparece en el almacén."},{"t":"mejora","m":"Inventario","d":"Odoo manda el inventario: los artículos nuevos de SGC ya no reciben la apertura automática de 1000 unidades por almacén."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/103d480";
