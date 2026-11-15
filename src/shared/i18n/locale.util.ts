import { Idioma } from './i18n.service';

/**
 * DP-11 — locale BCP-47 para `toLocale*String`/`Intl` según el idioma activo.
 * `ht` (Kreyòl ayisyen) NO tiene datos CLDR reales en ningún motor probado
 * (Node y los navegadores devuelven nombres de mes en FRANCÉS aunque acepten
 * el locale `ht` sin error) — por eso nunca se le pasa `'ht'` a `Intl`/
 * `DatePipe`. Para nombres de mes en Kreyòl se usa la tabla de abajo; el
 * resto del formato (números, separadores) usa `es-DO` (orden día/mes, como
 * el resto de la región).
 */
export function localeActual(idioma: Idioma): string {
  if (idioma === 'en') return 'en-US';
  return 'es-DO';
}

/** Meses en Kreyòl ayisyen (ortografía OFÒ), índice 0 = enero. */
export const MESES_HT = [
  'janvye', 'fevriye', 'mas', 'avril', 'me', 'jen',
  'jiyè', 'out', 'septanm', 'oktòb', 'novanm', 'desanm',
];

/** Abreviatura de 3 letras para patrones `MMM` (análogo a "ene"/"Jan"). */
export const MESES_HT_ABR = ['jan', 'fev', 'mas', 'avr', 'me', 'jen', 'jiy', 'out', 'sep', 'okt', 'nov', 'des'];

/** Días en Kreyòl ayisyen, índice 0 = domingo (igual que `Date#getDay()`). */
export const DIAS_HT = ['dimanch', 'lendi', 'madi', 'mèkredi', 'jedi', 'vandredi', 'samdi'];
