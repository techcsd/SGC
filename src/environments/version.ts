// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.34.1';
export const APP_VERSION_TITULO: string | null = "Monitoreo de Infraestructura: alertas por correo (canal principal)";
export const APP_VERSION_CAMBIOS: { t: string; d: string }[] = [{"t":"mejora","d":"Las alertas del monitoreo ahora llegan por correo como canal principal (más cómodo que un bot), enviadas desde el dominio del sistema — independiente del dominio vigilado, así siguen saliendo aunque el dominio de la empresa se caiga."},{"t":"mejora","d":"Telegram queda como canal opcional adicional; ya no es necesario para recibir las alertas."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/623fdce";
