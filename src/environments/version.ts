// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.53.3';
export const APP_VERSION_TITULO: string | null = "Adopta las actualizaciones sin pantallas en blanco";
export const APP_VERSION_CAMBIOS: { t: string; d: string }[] = [{"t":"arreglo","d":"Si tenías la página abierta desde antes de una actualización, al navegar (por ejemplo a Iniciar sesión) podía fallar la carga de un módulo (\"disallowed MIME type\" / \"error loading dynamically imported module\") y quedar la pantalla rota. Ahora la app detecta ese caso y se recarga sola una vez para tomar la versión nueva."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/f2475fe";
