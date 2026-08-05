// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.65.0';
export const APP_VERSION_TITULO: string | null = "Placas provisionales: vencimiento regulado de la placa (AG8b)";
export const APP_VERSION_CAMBIOS: { t: string; d: string }[] = [{"t":"mejora","d":"Placas provisionales (PP): ahora se registra la FECHA DE VENCIMIENTO que trae impresa la propia placa (plazo regulado de ~3 meses = límite legal para circular), en vez de calcularla por \"días prometidos\". El dealer y su fecha de entrega prometida quedan como seguimiento opcional (varían por caso). El aviso se genera 15 días antes de ese vencimiento y al cumplirse."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/628c20e";
