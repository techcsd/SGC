// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.128.1';
export const APP_VERSION_TITULO: string | null = "Arreglos de auditoría: reportes de error que se perdían y compresión de fotos de personal";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"arreglo","m":"Tecnología","d":"Los reportes de error de tipo seguimiento, inicio de sesión, GPS y voz ya no se pierden en silencio: antes chocaban con una validación de la base de datos y no quedaban registrados, así que el panel de reportes nunca los mostraba. Ahora entran y se pueden triar como el resto."},{"t":"mejora","m":"Proyectos","d":"Las fotos de personal de obra ahora se comprimen antes de subir (como el resto de las fotos del sistema), para que carguen más rápido y pesen menos."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/ed4b2ef";
