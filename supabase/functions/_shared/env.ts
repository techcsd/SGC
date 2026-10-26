// _shared/env.ts — CY21 punto 2. `Deno.env.get("X")!` oculta un `undefined` con
// una aserción de tipo: si falta el secret, el error real aparece mucho más
// tarde (una URL inválida, un 401 sin pista) en vez de fallar aquí mismo con
// un mensaje que dice exactamente qué falta.
export function envRequerido(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} (revisa los secrets de esta edge function).`);
  return valor;
}
