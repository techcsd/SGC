// CF7 — números y fechas a letras (español dominicano), para los contratos de Sonia.
// Ej: 20000 → "veinte mil"; con moneda → "veinte mil pesos dominicanos".
//     fecha → "a los dos (2) días del mes de octubre del año dos mil veintiséis".

const UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DIEZ_A_QUINCE = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince'];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function decenaALetras(n: number): string {
  if (n < 10) return UNIDADES[n];
  if (n <= 15) return DIEZ_A_QUINCE[n - 10];
  if (n === 16) return 'dieciséis';
  if (n < 20) return 'dieci' + UNIDADES[n - 10];
  if (n < 30) {
    if (n === 20) return 'veinte';
    const esp: Record<number, string> = { 22: 'veintidós', 23: 'veintitrés', 26: 'veintiséis' };
    return esp[n] ?? 'veinti' + UNIDADES[n - 20];
  }
  const d = Math.floor(n / 10);
  const u = n % 10;
  return DECENAS[d] + (u ? ' y ' + UNIDADES[u] : '');
}

function centenaALetras(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const pref = c ? CENTENAS[c] : '';
  return (pref + (pref && resto ? ' ' : '') + (resto ? decenaALetras(resto) : '')).trim();
}

/** Entero < 1.000.000.000 a letras. */
function enteroALetras(n: number): string {
  if (n === 0) return 'cero';
  if (n < 0) return 'menos ' + enteroALetras(-n);
  let out = '';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  if (millones) out += (millones === 1 ? 'un millón' : enteroALetras(millones) + ' millones') + ' ';
  if (miles) out += (miles === 1 ? 'mil' : centenaALetras(miles) + ' mil') + ' ';
  if (resto) out += centenaALetras(resto);
  return out.trim().replace(/\buno mil\b/, 'un mil').replace(/\bveintiuno mil\b/, 'veintiún mil');
}

/** 20000 → "veinte mil". Con `moneda` → "... pesos dominicanos" (+ centavos si hay). */
export function numeroALetras(valor: number | string, moneda = false): string {
  const num = typeof valor === 'string' ? Number(valor.replace(/,/g, '')) : valor;
  if (!Number.isFinite(num)) return '';
  const entero = Math.floor(Math.abs(num));
  const centavos = Math.round((Math.abs(num) - entero) * 100);
  let letras = enteroALetras(entero);
  if (num < 0) letras = 'menos ' + letras;
  if (!moneda) return letras;
  let out = `${letras} ${entero === 1 ? 'peso dominicano' : 'pesos dominicanos'}`;
  if (centavos) out += ` con ${enteroALetras(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  return out;
}

/** Fecha ISO (YYYY-MM-DD) → "a los dos (2) días del mes de octubre del año dos mil veintiséis". */
export function fechaEnLetras(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const anio = Number(m[1]), mes = Number(m[2]) - 1, dia = Number(m[3]);
  const diaTxt = enteroALetras(dia);
  const preposicion = dia === 1 ? 'al' : 'a los';
  return `${preposicion} ${diaTxt} (${dia}) ${dia === 1 ? 'día' : 'días'} del mes de ${MESES[mes]} del año ${enteroALetras(anio)}`;
}
