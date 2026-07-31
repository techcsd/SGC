// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.53.2';
export const APP_VERSION_TITULO: string | null = "Arreglo: la sesión ya no se cierra sola al refrescar la página";
export const APP_VERSION_CAMBIOS: { t: string; d: string }[] = [{"t":"arreglo","d":"Se corrigió un fallo introducido en 1.53.1 por el que, al refrescar la página, a veces la sesión se cerraba sola y te devolvía al inicio de sesión. Ahora la sesión se revalida de forma segura y solo se cierra cuando de verdad expiró."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/de14edc";
