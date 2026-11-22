// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.218.7';
export const APP_VERSION_TITULO: string | null = "Aviso a Tecnología cuando Odoo deja de responder";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Tecnología","d":"Si el sondeo de Odoo falla 6 veces seguidas (30 min), Tecnología recibe una alerta con el motivo, máximo una cada 6 horas. Antes una caída de Odoo quedaba en silencio."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/0c913f4";
