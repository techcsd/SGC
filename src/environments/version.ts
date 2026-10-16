// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.190.1';
export const APP_VERSION_TITULO: string | null = "Reabrir una orden marcada recibida sin recepción real";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"arreglo","m":"Compras","d":"Una orden que se marcó «Recibida» sin que en realidad se hubiera registrado ninguna entrada quedaba bloqueada para siempre (no volvía a aparecer en Inventario › Entradas). Ahora, si le falta algún renglón por recibir de verdad, aparece el botón «Reabrir recepción» para destrabarla."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/04e0f39";
