// Recuperación automática ante "chunk viejo tras un deploy".
//
// En una SPA con archivos hasheados (outputHashing: all), cuando sale un deploy
// nuevo los chunks cambian de nombre. Un usuario con la pestaña abierta desde
// ANTES del deploy sigue con el bundle viejo en memoria; al navegar a una ruta
// lazy, su `main` intenta importar un chunk que ya no existe. Vercel responde el
// index.html (text/html) para ese .js faltante → el import falla con
// "disallowed MIME type" / "error loading dynamically imported module" y la
// pantalla queda rota (le pasó a Xaviel al entrar a /auth).
//
// La cura estándar: detectar ese fallo y recargar UNA vez para traer el
// index.html fresco (que apunta a los chunks nuevos). El index se sirve con
// `must-revalidate`, así que la recarga siempre obtiene la versión vigente.

/** Mensajes de fallo de carga de módulo/chunk en los distintos navegadores. */
const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk [\d]+ failed|error loading dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed|disallowed MIME type|Loading module from|error loading dynamically imported/i;

/** ¿Este error es un fallo de carga de un chunk/módulo dinámico (no un bug de lógica)? */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') return CHUNK_ERROR_RE.test(error);
  const e = error as { message?: unknown; name?: unknown; cause?: { message?: unknown } };
  const parts = [
    typeof e.name === 'string' ? e.name : '',
    typeof e.message === 'string' ? e.message : '',
    typeof e.cause?.message === 'string' ? e.cause.message : '',
  ].join(' ');
  return CHUNK_ERROR_RE.test(parts);
}

const RELOAD_MARK = 'sgc:chunk-reload-at';
// Ventana anti-bucle: si ya recargamos hace poco y VUELVE a fallar, no seguimos
// recargando en loop (evita un ciclo infinito si el fallo no fuera por versión).
const LOOP_WINDOW_MS = 20_000;

/**
 * Recarga la página una sola vez para adoptar la versión nueva. Protegida contra
 * bucles: si ya se recargó hace < 20 s, no vuelve a hacerlo. Devuelve true si
 * disparó la recarga.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_MARK) ?? '0');
    if (Date.now() - last < LOOP_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
  } catch {
    // sessionStorage bloqueado (modo privado estricto): recargamos igual una vez.
  }
  location.reload();
  return true;
}
