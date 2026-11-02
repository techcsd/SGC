// Compartido entre agente-escriba-solicitar y agente-escriba-estado -- debe vivir en
// _shared/ porque el deploy de edge functions (scripts/deploy-edge.mjs) solo bundlea
// la carpeta propia de cada funcion + _shared/, no carpetas de funciones hermanas.
export function slugDe(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toLowerCase();
}
