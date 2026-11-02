// Extraído de index.ts para poder testearlo sin levantar Deno.serve.
const LIMITE_DETALLE = 2000;

export function sanearEvidencia(texto: string): string {
  if (!texto) return "";
  let limpio = texto
    .replace(/\b\d{3}-\d{7}-\d{1}\b/g, "[cédula omitida]")
    .replace(/\b\d{10,11}\b/g, "[número omitido]")
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[teléfono omitido]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo omitido]");
  if (limpio.length > LIMITE_DETALLE) limpio = limpio.slice(0, LIMITE_DETALLE) + "\n[...recortado]";
  return limpio;
}

export function slugDe(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toLowerCase();
}
