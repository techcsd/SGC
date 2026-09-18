// AD1 — Los errores crudos de BD/red (PostgREST/Postgres) NO deben llegar a la
// UI. Este helper traduce el mensaje técnico a algo amable en español y marca
// si era "técnico" (para reportarlo a telemetría). Es una función pura: no
// depende de Angular ni de Supabase, así se puede usar en cualquier capa.

export interface FriendlyError {
  /** Mensaje apto para mostrar al usuario (español, sin jerga). */
  mensaje: string;
  /** true si el original era un error técnico crudo (se debe reportar). */
  technical: boolean;
  /** Texto crudo original (para telemetría). */
  raw: string;
}

/** Extrae un string de mensaje de cualquier forma de error. */
export function errorMessage(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  const e = error as { message?: unknown; error_description?: unknown; error?: unknown; details?: unknown };
  if (typeof e.message === 'string') return e.message;
  if (typeof e.error_description === 'string') return e.error_description;
  if (typeof e.error === 'string') return e.error;
  if (typeof e.details === 'string') return e.details;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Cada regla: patrón crudo -> mensaje amable. Orden = prioridad.
const REGLAS: { re: RegExp; mensaje: string }[] = [
  { re: /permission denied|not authorized|forbidden|rls|row-level security|policy/i,
    mensaje: 'No tienes permiso para esta acción. Si crees que deberías, avisa a Administración.' },
  { re: /jwt|token|session.*(expired|invalid)|invalid.*session|refresh_token|not authenticated|401/i,
    mensaje: 'Tu sesión expiró o no es válida. Vuelve a iniciar sesión.' },
  { re: /failed to fetch|networkerror|network request failed|fetch failed|econn|timeout|timed out|503|502|504|upstream/i,
    mensaje: 'Problema de conexión. Revisa tu internet e inténtalo de nuevo.' },
  { re: /duplicate key|already exists|unique constraint|23505/i,
    mensaje: 'Ese registro ya existe.' },
  { re: /foreign key|violates foreign key|23503|still referenced/i,
    mensaje: 'No se puede completar: el registro está vinculado a otros datos.' },
  { re: /not-null|null value in column|violates not-null|23502/i,
    mensaje: 'Faltan datos obligatorios.' },
  { re: /check constraint|violates check|23514/i,
    mensaje: 'Alguno de los datos no es válido.' },
  // BG5/varchar — texto más largo que el máximo de la columna (SQLSTATE 22001).
  { re: /value too long|right truncation|22001/i,
    mensaje: 'Uno de los textos es demasiado largo. Acórtalo e inténtalo de nuevo.' },
  { re: /infinite recursion|stack depth|deadlock|too many/i,
    mensaje: 'Ocurrió un problema procesando la solicitud. Ya lo estamos revisando.' },
  // BB5 — embed ambiguo de PostgREST (más de una relación entre dos tablas). El
  // check `check-ambiguous-embeds.mjs` lo previene en build; esta regla es la red
  // de seguridad en runtime para que nunca llegue el texto en inglés al usuario.
  { re: /could not embed|more than one relationship|pgrst2\d{2}|embedding/i,
    mensaje: 'No pudimos cargar esta información. Ya fue reportado y lo estamos revisando.' },
  { re: /does not exist|undefined (column|table|function)|42\d{3}|relation .* does not exist/i,
    mensaje: 'Ocurrió un error inesperado. Ya lo estamos revisando.' },
];

// Señales de que un string es un error técnico crudo (aunque no matchee arriba).
const TECNICO = /(permission denied|violates|constraint|jwt|recursion|relation |column |function |schema |postgres|pgrst|sql|null value|does not exist|failed to fetch|networkerror|\b4\d{2}\b|\b5\d{2}\b|error:)/i;

/**
 * Traduce un error crudo a un mensaje amable. Si el texto ya parece un mensaje
 * amable (no técnico), lo deja pasar tal cual.
 */
export function humanizeError(error: unknown): FriendlyError {
  const raw = errorMessage(error).trim();
  if (!raw) return { mensaje: 'Ocurrió un error inesperado.', technical: true, raw };

  for (const r of REGLAS) {
    if (r.re.test(raw)) return { mensaje: r.mensaje, technical: true, raw };
  }
  if (TECNICO.test(raw)) {
    return { mensaje: 'Ocurrió un error inesperado. Ya lo estamos revisando.', technical: true, raw };
  }
  // Mensaje ya amable (lanzado a propósito por la app): pásalo tal cual.
  return { mensaje: raw, technical: false, raw };
}

// BS2 — presentación de un error al usuario según su ROL. El usuario ve un
// mensaje humano; el detalle técnico (SQLSTATE + crudo) queda para el
// desarrollador. Función pura: el REPORTE a telemetría y el gate de rol lo hace
// quien la usa (el componente `error-state` o `ToastService`), no esta util.
export interface PresentacionError {
  /** Mensaje apto para el usuario, según su rol. */
  mensajeUsuario: string;
  /** Detalle técnico (SQLSTATE + mensaje crudo + sugerencia) — SOLO desarrollador. */
  detalleTecnico: string;
  /** Código SQLSTATE si se pudo extraer (42501, 23505, PGRST…), o null. */
  sqlstate: string | null;
  /** true si el fallo es de acceso/permiso (42501/RLS) → el rol no alcanza. */
  esAccesoDenegado: boolean;
  /** Texto crudo original (para el reporte a telemetría). */
  raw: string;
}

/** Extrae el SQLSTATE de un error de PostgREST/Postgres (campo `code` o del texto). */
function extraerSqlstate(error: unknown, raw: string): string | null {
  const e = (error ?? {}) as { code?: unknown };
  if (typeof e.code === 'string' && e.code.trim()) return e.code.trim();
  // SQLSTATE = 5 caracteres [0-9A-Z]; o un código PostgREST tipo PGRST123.
  const m = raw.match(/\bPGRST\d{3}\b/) ?? raw.match(/\b(\d{2}[0-9A-Z]{3})\b/);
  return m ? m[0] : null;
}

/**
 * BS2 — traduce un error crudo a una presentación por rol. `pantalla` nombra la
 * vista para el mensaje humano; `accion` (opcional) reemplaza el verbo "cargar".
 * Devuelve el objeto estructurado; NO reporta ni consulta el rol (eso lo hace el
 * llamador, típicamente el componente `app-error-state`).
 */
export function presentarError(
  error: unknown,
  ctx: { pantalla: string; accion?: string },
): PresentacionError {
  const raw = errorMessage(error).trim();
  const sqlstate = extraerSqlstate(error, raw);
  const esAccesoDenegado =
    sqlstate === '42501' ||
    /permission denied|not authorized|forbidden|row-level security|violates row-level|\brls\b|policy/i.test(raw);

  const mensajeUsuario = esAccesoDenegado
    ? 'Tu rol no tiene acceso a esta información.'
    : ctx.accion
      ? `No pudimos ${ctx.accion}. Ya se reportó a Tecnología.`
      : `No pudimos cargar ${ctx.pantalla}. Ya se reportó a Tecnología.`;

  const sugerencia = esAccesoDenegado
    ? 'Revisa los módulos/RLS del rol en Administración › Roles.'
    : 'Revisa el detalle en Tecnología › Reportes de error.';
  const detalleTecnico = `[${sqlstate ?? '—'}] ${raw || '(sin mensaje)'}\n${sugerencia}`;

  return { mensajeUsuario, detalleTecnico, sqlstate, esAccesoDenegado, raw };
}

// BT7 — clasificación NEGOCIO vs SISTEMA (regla 9 + 16). El SQLSTATE es el contrato:
//  · 22023 / P0001 con detail.campo  → NEGOCIO (dato a corregir): "Revisar dato: <campo>".
//    El servidor lo emite con `sgc.error_campo(campo,motivo,mensaje)` → mensaje ya humano.
//  · 23xxx (FK/unique/not-null/check), 42xxx (grant/objeto), 57xxx (timeouts/admin) → SISTEMA:
//    "Con problema al enviar. Ya se reportó." + report_app_error (lo hace el llamador).
// Espejo del contrato del outbox de la app (csd-app outbox-categoria.ts) — ver PARIDAD.md.
export interface ErrorClasificado {
  clase: 'negocio' | 'sistema';
  /** Mensaje humano para el usuario. */
  mensaje: string;
  /** Campo a corregir (solo negocio con detail.campo), o null. */
  campo: string | null;
  sqlstate: string | null;
  raw: string;
}

function extraerCampo(error: unknown, raw: string): string | null {
  const e = (error ?? {}) as { hint?: unknown; details?: unknown; detail?: unknown };
  if (typeof e.hint === 'string' && e.hint.trim() && !/\s/.test(e.hint.trim())) return e.hint.trim();
  const det = (typeof e.details === 'string' ? e.details : typeof e.detail === 'string' ? e.detail : '') || raw;
  const m = det.match(/"?campo"?\s*[:=]\s*"?([a-z_]+)"?/i);
  return m ? m[1] : null;
}

export function clasificarError(error: unknown): ErrorClasificado {
  const raw = errorMessage(error).trim();
  const sqlstate = extraerSqlstate(error, raw);
  const campo = extraerCampo(error, raw);
  // Negocio: 22023 (error_campo) o P0001 (raise) que trae un campo a corregir.
  const esNegocio =
    (sqlstate === '22023' || sqlstate === 'P0001') && !!campo;
  if (esNegocio) {
    // El mensaje del servidor ya es humano; anteponer "Revisar dato" solo si no lo trae.
    const h = humanizeError(error);
    return { clase: 'negocio', mensaje: h.mensaje, campo, sqlstate, raw };
  }
  // Sistema: cualquier SQLSTATE de infra (23/42/57/53/08) o texto técnico.
  const esSistema =
    (sqlstate && /^(0[8A]|22|23|42|53|57|58|xx)/i.test(sqlstate) && sqlstate !== '22023') ||
    /violates|insert or update on table|foreign key|constraint|permission denied|does not exist|failed to fetch|network/i.test(raw);
  return {
    clase: esSistema ? 'sistema' : 'negocio',
    mensaje: esSistema ? 'Con problema al enviar. Ya se reportó a Tecnología.' : humanizeError(error).mensaje,
    campo,
    sqlstate,
    raw,
  };
}

/** Categoría para telemetría (report_app_error.error_type). BI4 — homologada con la
 *  whitelist del servidor (crash/error/camera/sync/permission/other/tracking/login/gps/voice)
 *  para que el panel agrupe por causa y no todo caiga en 'error'/'other'. */
export function errorType(
  raw: string,
): 'permission' | 'sync' | 'error' | 'crash' | 'camera' | 'login' | 'gps' | 'tracking' | 'voice' | 'other' {
  const s = raw || '';
  if (/permission denied|not authorized|forbidden|rls|row-level security|policy/i.test(s)) return 'permission';
  if (/sign\s?in|log\s?in|login|credenc|invalid.*(password|pin)|auth\b/i.test(s)) return 'login';
  if (/geolocation|gps|obtain location|position (unavailable|error)/i.test(s)) return 'gps';
  if (/watchdog|watcher|registrar_posiciones|tracking/i.test(s)) return 'tracking';
  if (/camera|cámara|getusermedia|captur/i.test(s)) return 'camera';
  if (/audio|voz|miceph|microfono|micrófono|nota_voz/i.test(s)) return 'voice';
  if (/failed to fetch|network|timeout|upstream|50\d|econn|sync|lote/i.test(s)) return 'sync';
  if (/uncaught|unhandled|cannot read|is not a function|null is not an object|maximum call stack/i.test(s)) return 'crash';
  if (s.trim() === '') return 'other';
  return 'error';
}
