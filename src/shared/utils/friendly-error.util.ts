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
  { re: /infinite recursion|stack depth|deadlock|too many/i,
    mensaje: 'Ocurrió un problema procesando la solicitud. Ya lo estamos revisando.' },
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

/** Categoría para telemetría (report_app_error.error_type). */
export function errorType(raw: string): 'permission' | 'sync' | 'error' {
  if (/permission denied|not authorized|forbidden|rls|policy/i.test(raw)) return 'permission';
  if (/failed to fetch|network|timeout|upstream|50\d|econn/i.test(raw)) return 'sync';
  return 'error';
}
