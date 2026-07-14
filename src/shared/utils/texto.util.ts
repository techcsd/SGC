/**
 * Homologación de texto (R18) — espeja `sgc.homologar_texto` del servidor.
 * Trim + colapsa espacios + primera letra de cada palabra en mayúscula,
 * conservando el resto tal cual (preserva acrónimos/medidas), con los
 * conectores españoles en minúscula (salvo la primera palabra).
 * El servidor es la fuente de verdad; esto es sólo feedback inmediato en el form.
 */
const CONECTORES = new Set([
  'y', 'e', 'o', 'u', 'de', 'del', 'la', 'las', 'el', 'los',
  'un', 'una', 'en', 'con', 'a', 'al', 'para', 'por',
]);

export function homologarTexto(input: string | null | undefined): string {
  const v = (input ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return '';
  return v
    .split(' ')
    .map((w, i) => {
      if (i > 0 && CONECTORES.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}
