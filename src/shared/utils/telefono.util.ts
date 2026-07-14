/**
 * U5 — formateo de teléfono RD para mostrar/editar: dígitos → `(809) 555-1234`.
 * Se GUARDA normalizado (solo dígitos, vía sgc.normalizar_telefono en BD); esto
 * es solo presentación/entrada.
 */
export function formatearTelefono(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '').slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Solo dígitos (para guardar). */
export function soloDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '').slice(0, 10);
}
