// CZ9 — Generador de claves del Vault. 100% en el navegador (o la app) con
// `crypto.getRandomValues`, muestreo SIN sesgo (rechazo, no módulo directo) y
// SIN dependencias nuevas. DZ-13.

/** Rechazo de muestreo: evita el sesgo de módulo al mapear un byte a [0, max). */
function indiceSinSesgo(max: number): number {
  if (max <= 0 || max > 256) throw new Error('max debe estar entre 1 y 256');
  const limite = 256 - (256 % max);
  let b: number;
  do {
    b = crypto.getRandomValues(new Uint8Array(1))[0];
  } while (b >= limite);
  return b % max;
}

function elegir<T>(pool: readonly T[]): T {
  return pool[indiceSinSesgo(pool.length)];
}

// Evita 0/O, l/1/I — confundibles al teclear a mano.
const AMBIGUOS = new Set(['0', 'O', 'o', 'l', '1', 'I']);
const MAYUS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).filter((c) => !AMBIGUOS.has(c));
const MINUS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)).filter((c) => !AMBIGUOS.has(c));
const NUMEROS = Array.from({ length: 10 }, (_, i) => String(i)).filter((c) => !AMBIGUOS.has(c));
const SIMBOLOS = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '=', '+', '[', ']', '{', '}', ';', ':', ',', '.', '?'];

export interface OpcionesPassword {
  largo: number; // 8-64, defecto 20
  mayusculas: boolean;
  minusculas: boolean;
  numeros: boolean;
  simbolos: boolean;
}

export interface SecretoGenerado {
  valor: string;
  bitsEntropia: number;
}

/** Contraseña: largo 8-64 (defecto 20), clases seleccionables, sin ambiguos. */
export function generarPassword(opts: Partial<OpcionesPassword> = {}): SecretoGenerado {
  const o: OpcionesPassword = {
    largo: Math.min(64, Math.max(8, opts.largo ?? 20)),
    mayusculas: opts.mayusculas ?? true,
    minusculas: opts.minusculas ?? true,
    numeros: opts.numeros ?? true,
    simbolos: opts.simbolos ?? true,
  };
  let pool: string[] = [];
  if (o.mayusculas) pool = pool.concat(MAYUS);
  if (o.minusculas) pool = pool.concat(MINUS);
  if (o.numeros) pool = pool.concat(NUMEROS);
  if (o.simbolos) pool = pool.concat(SIMBOLOS);
  if (!pool.length) pool = MINUS.concat(NUMEROS);
  const valor = Array.from({ length: o.largo }, () => elegir(pool)).join('');
  return { valor, bitsEntropia: Math.round(o.largo * Math.log2(pool.length)) };
}

// Lista corta de palabras en español, simples y sin acentos (fáciles de
// escribir/leer en voz alta) — DZ-13, "5 palabras de una lista embebida".
const PALABRAS = [
  'arbol', 'barco', 'casa', 'dado', 'elefante', 'fuego', 'gato', 'hilo', 'isla', 'jardin',
  'kilo', 'luna', 'mapa', 'nube', 'ola', 'perro', 'queso', 'rio', 'sol', 'torre',
  'uva', 'valle', 'wifi', 'xilofono', 'yate', 'zorro', 'abeja', 'buho', 'cielo', 'disco',
  'estrella', 'flor', 'globo', 'hueso', 'iman', 'jaula', 'kiwi', 'lago', 'montana', 'nido',
  'oro', 'puente', 'quimica', 'raiz', 'semilla', 'tigre', 'universo', 'vela', 'ventana', 'yeso',
  'zapato', 'anillo', 'brisa', 'cometa', 'diamante', 'espejo', 'fruta', 'guitarra', 'hoja', 'invierno',
  'jirafa', 'koala', 'libro', 'madera', 'niebla', 'oceano', 'pintura', 'quieto', 'rayo', 'sombra',
  'tunel', 'union', 'volcan', 'yunque', 'zafiro', 'abanico', 'balcon', 'cascada', 'delfin', 'enano',
  'faro', 'girasol', 'horizonte', 'iglesia', 'jazmin', 'kayak', 'linterna', 'mariposa', 'nieve', 'ombligo',
  'papel', 'quinoa', 'relampago', 'selva', 'trueno', 'uniforme', 'viento', 'wombat', 'xenon', 'yoga',
];

/** Frase de 5 palabras separadas por guion. */
export function generarPassphrase(numPalabras = 5): SecretoGenerado {
  const n = Math.min(10, Math.max(3, numPalabras));
  const valor = Array.from({ length: n }, () => elegir(PALABRAS)).join('-');
  return { valor, bitsEntropia: Math.round(n * Math.log2(PALABRAS.length)) };
}

/** Llave API: hex o base64url, 32 bytes (256 bits) por defecto. */
export function generarLlaveApi(formato: 'hex' | 'base64url' = 'hex', bytes = 32): SecretoGenerado {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  const valor =
    formato === 'hex'
      ? Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
      : btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { valor, bitsEntropia: bytes * 8 };
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Semilla 2FA (TOTP): base32, 20 bytes (160 bits) — formato estándar de los apps autenticadores. */
export function generarSemilla2fa(bytes = 20): SecretoGenerado {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let valor = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    valor += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return { valor, bitsEntropia: bytes * 8 };
}

/** Texto descriptivo de fortaleza por bits de entropía (sin jerga, BS2/regla 16). */
export function etiquetaFortaleza(bits: number): 'débil' | 'aceptable' | 'fuerte' | 'muy fuerte' {
  if (bits < 40) return 'débil';
  if (bits < 60) return 'aceptable';
  if (bits < 90) return 'fuerte';
  return 'muy fuerte';
}
