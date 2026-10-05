// CG3 — utilidades de cédula dominicana (JCE): formato en vivo 000-0000000-0,
// normalización a dígitos y validación del dígito verificador (algoritmo Luhn de la JCE).

/** Deja solo dígitos (forma canónica que guarda el servidor). */
export function normalizarCedula(valor: string | null | undefined): string {
  return String(valor ?? '').replace(/\D/g, '').slice(0, 11);
}

/** Formatea a 000-0000000-0 de forma progresiva (sirve mientras se escribe). */
export function formatearCedula(valor: string | null | undefined): string {
  const d = normalizarCedula(valor);
  if (d.length <= 3) return d;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
}

/**
 * Valida el dígito verificador de una cédula dominicana (11 dígitos).
 * Algoritmo JCE: pesos alternos 1,2 sobre los primeros 10 dígitos; si el producto
 * supera 9 se le resta 9; el verificador es (10 - (suma mod 10)) mod 10.
 */
export function cedulaValida(valor: string | null | undefined): boolean {
  const d = normalizarCedula(valor);
  if (!/^\d{11}$/.test(d)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    const peso = i % 2 === 0 ? 1 : 2;
    let prod = Number(d[i]) * peso;
    if (prod > 9) prod -= 9;
    suma += prod;
  }
  const verificador = (10 - (suma % 10)) % 10;
  return verificador === Number(d[10]);
}

/** Posición del cursor estable al reformatear (cuántos dígitos había antes del cursor). */
export function digitosAntesDe(valor: string, cursor: number): number {
  let n = 0;
  for (let i = 0; i < cursor && i < valor.length; i++) if (/\d/.test(valor[i])) n++;
  return n;
}

/** Dado un valor formateado y un número de dígitos objetivo, devuelve el índice de cursor. */
export function cursorTrasDigitos(formateado: string, digitos: number): number {
  if (digitos <= 0) return 0;
  let n = 0;
  for (let i = 0; i < formateado.length; i++) {
    if (/\d/.test(formateado[i])) {
      n++;
      if (n === digitos) return i + 1;
    }
  }
  return formateado.length;
}
