// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.123.0';
export const APP_VERSION_TITULO: string | null = "Conteo físico de almacén: pon el stock real sin ensuciar el kardex";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Inventario","d":"En Inventario → Conteos y ajustes hay un nuevo «Conteo físico (stock real)»: eliges el almacén, cuentas físicamente y pones la existencia real. Al aplicar, el sistema cuadra el stock sin crear movimientos en el kardex (rebasa la apertura). Puedes guardar el borrador y retomarlo, hacer conteo ciego (sin ver la cantidad del sistema), y deshacer un conteo aplicado. Queda todo en la auditoría con su motivo."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/89eb607";
