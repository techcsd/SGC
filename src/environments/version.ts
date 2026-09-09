// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.126.0';
export const APP_VERSION_TITULO: string | null = "El empaque (atado/paquete) viaja al despacho y se ve en el conduce";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"mejora","m":"Inventario","d":"Cuando una requisición se pide por empaque (ej. «2 atados»), esa forma ahora se conserva al aprobarla/despacharla y se muestra en el detalle de la salida como «240 unidad · 2 atado». La cantidad sigue SIEMPRE en unidad base, así que el stock, el kardex y los costos no cambian — es solo trazabilidad. El conduce de la app también recibe el dato del empaque por renglón (para mostrarlo en su próxima versión)."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/8000163";
