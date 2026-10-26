// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.202.1';
export const APP_VERSION_TITULO: string | null = "Combustible: corregido el rechazo de recibos retroactivos";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"arreglo","m":"Flota","d":"Registrar una echada de combustible con fecha pasada podía rechazarse por error (\"la lectura no puede ser menor a la lectura actual del vehículo\") aunque el kilometraje fuera correcto para esa fecha. Ahora se valida contra el kilometraje que tenía el vehículo en esa fecha, no contra el actual."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/e126ae5";
