// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.167.1';
export const APP_VERSION_TITULO: string | null = "Arreglo: transferir un conduce con receptor designado";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"arreglo","m":"Transporte","d":"Ya se puede transferir un conduce que tiene a alguien designado para recibir en obra, mientras el material no haya salido o esté en ruta. Antes el sistema lo marcaba «pendiente de firma» antes de tiempo y bloqueaba la transferencia. El botón ahora se apaga con el motivo cuando de verdad no se puede (ya llegó a la obra), y el receptor solo puede firmar cuando el conduce realmente llega."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/7cf44f4";
