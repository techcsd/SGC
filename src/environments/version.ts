// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.117.0';
export const APP_VERSION_TITULO: string | null = "Panel de notificaciones: apagar avisos por rol y por persona";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Administración","d":"En la Matriz de notificaciones ahora puedes apagar (o volver a encender) un tipo de aviso para un rol o para una persona concreta, con buscador de usuario. Gana la regla más específica: usuario sobre rol sobre global, y afecta tanto al push como a la campanita/bandeja."},{"t":"mejora","m":"Notificaciones","d":"La lista de avisos que cada usuario puede silenciar en su perfil ahora sale del catálogo real del sistema (incluye chat, notas compartidas y demás), en vez de una lista fija que se quedaba corta."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/a5d7988";
