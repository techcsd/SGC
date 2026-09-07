// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.
export const APP_VERSION = '1.118.0';
export const APP_VERSION_TITULO: string | null = "Desempeño: agregar a cualquier persona y marcar quién es chofer";
export const APP_VERSION_CAMBIOS: { t: string; d: string; m?: string }[] = [{"t":"nuevo","m":"Incentivos","d":"El padrón del Desempeño ahora se maneja por persona: puedes agregar a cualquier usuario (no solo choferes con el rol) y marcar quién cuenta como «chofer» para el incentivo. Marcar chofer no otorga el rol, solo lo declara aquí. Quien agregues empieza a puntuar desde la semana en curso; no se recalculan semanas ya pagadas."},{"t":"mejora","m":"Incentivos","d":"El motor de puntaje, el listado, el correo y el PDF ahora se poblan desde este padrón en vez del rol; el conjunto que ya puntuaba no cambió al migrar."}];
export const APP_VERSION_URL: string | null = "https://github.com/techcsd/SGC/commit/b90334e";
