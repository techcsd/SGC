// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.114.0';
export const APP_VERSION_TITULO: string | null = "Conciliación de combustible: mapeo de tarjeta→vehículo (factura PDF)";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Flota","d":"En la factura PDF de combustible el consumo suele ir a nombre de una persona (ING. …), no de una placa. Ahora se asigna el vehículo de cada tarjeta una sola vez (el código de 4 dígitos es la llave) y se recuerda: las próximas facturas llegan ya resueltas para el cruce, en vez de caer en «solo informe»."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/8c7763f";
