// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.107.1';
export const APP_VERSION_TITULO: string | null = "Tipos de aviso administrables + catálogo único de proveedores (transportistas)";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Administración","d":"La Matriz de notificaciones ahora permite habilitar o deshabilitar cada tipo de aviso (novedades, conduces, flota, etc.) sin tocar código. Las informativas el usuario también puede silenciarlas desde su perfil; las operativas solo se administran aquí."},{"t":"mejora","m":"Inventario","d":"Los proveedores de transporte pasaron al catálogo único de proveedores (con el tipo 'transportista'): crear, listar, ratificar y ver sus viajes ahora usan el mismo maestro que el resto de proveedores. Sin cambios en cómo se usa."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/01bf363";
