// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.121.0';
export const APP_VERSION_TITULO: string | null = "Matriz de notificaciones única: canales por tipo y correo incluido";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"mejora","m":"Administración","d":"Se retiró la pantalla vieja de «Notificaciones» (switchboard aparte): sus 7 eventos se absorbieron en la Matriz de notificaciones. Ahora, por cada tipo de aviso, controlas si está encendido y por qué canales sale (campana, push, correo) en un solo lugar."},{"t":"mejora","m":"Notificaciones","d":"Los correos de informe (incentivo semanal, actividad diaria, resumen de operaciones) ahora respetan la matriz: se pueden apagar por tipo, por rol o por persona, igual que el resto de los avisos."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/c9345c4";
