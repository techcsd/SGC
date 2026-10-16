// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.192.0';
export const APP_VERSION_TITULO: string | null = "Importar choferes y vehículos desde Excel";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Flota","d":"Nueva forma de dar de alta choferes y vehículos en lote: descarga una plantilla de Excel, llénala y súbela para importarlos todos de una vez — incluyendo sus fotos (se suben junto con un archivo .zip)."},{"t":"arreglo","m":"Flota","d":"Al importar vehículos, una fila sin el año del vehículo hacía fallar esa fila; ahora se completa automáticamente con el año actual."},{"t":"arreglo","m":"Flota","d":"El asistente de «Importar vehículos desde Odoo» a veces no reconocía qué se iba a importar y mostraba el selector completo en vez de ir directo a vehículos."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/1537a51";
