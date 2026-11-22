// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.220.0';
export const APP_VERSION_TITULO: string | null = "Los conduces siguen saliendo si Odoo se cae un rato";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Inventario","d":"Si Odoo no responde, el conduce se puede emitir igual: se valida con el último stock conocido de SGC (solo si el último sondeo bueno de Odoo tiene menos de 2 h), con un aviso en pantalla. Nunca se salta la validación cuando Odoo sí responde y no hay stock."},{"t":"nuevo","m":"Tecnología","d":"Cada conduce emitido en modo degradado queda registrado y Tecnología recibe un aviso (máximo uno por hora). Se apaga con el parámetro odoo_conduce_degradado_auto."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/96ea155";
