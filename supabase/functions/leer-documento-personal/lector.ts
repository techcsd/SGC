// leer-documento-personal/lector.ts — DB5 — lógica pura (testeable sin red).
// deno-lint-ignore no-explicit-any
export type Any = any;

export const MIMES_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export const SYSTEM = `Eres un extractor de datos para registrar PERSONAL DE OBRA (construcción,
República Dominicana). Recibes DOS fotos: (1) el documento de identidad solo, y (2) la persona
sosteniendo el documento junto a su cara. Devuelves SOLO un objeto JSON válido, sin texto
adicional, sin markdown. Formato EXACTO:
{
  "nombre": string|null,
  "apellido": string|null,
  "tipo_documento": "cedula"|"pasaporte"|"carnet_electoral"|"otro"|null,
  "documento_numero": string|null,
  "nacionalidad": "dominicano"|"haitiano"|"venezolano"|"otro"|null,
  "fecha_nacimiento": "YYYY-MM-DD"|null,
  "sexo": "M"|"F"|null,
  "coincide_rostro": "si"|"no"|"dudoso",
  "confianza": { "<campo>": number }
}
Reglas:
- "nombre" = nombres de pila; "apellido" = apellidos (en la cédula dominicana vienen separados).
- "documento_numero": copia los dígitos TAL CUAL (con sus guiones si los trae). NO lo inventes.
- "nacionalidad": dedúcela del documento (cédula RD → dominicano; pasaporte haitiano → haitiano…).
- "coincide_rostro": compara la cara de la foto 2 con la foto del documento. "dudoso" si la foto
  es borrosa, la cara está parcialmente tapada o no puedes compararlas con seguridad.
- "fecha_nacimiento" y "sexo" solo si aparecen legibles en el documento; si no, null.
- Si un campo no se lee, null y sin entrada en confianza. NO inventes datos.`;

export function construirContenido(fotoDocumento: { data: string; mime: string }, fotoPersona: { data: string; mime: string }): Any[] {
  for (const f of [fotoDocumento, fotoPersona]) {
    if (!f?.data || !MIMES_IMAGEN.has(f?.mime)) throw new Error("Formato no soportado (usa fotos JPG/PNG/WEBP).");
  }
  return [
    { type: "text", text: "Foto 1 — el documento de identidad:" },
    { type: "image", source: { type: "base64", media_type: fotoDocumento.mime, data: fotoDocumento.data } },
    { type: "text", text: "Foto 2 — la persona sosteniendo el documento junto a su cara:" },
    { type: "image", source: { type: "base64", media_type: fotoPersona.mime, data: fotoPersona.data } },
    { type: "text", text: "Extrae los datos y devuelve SOLO el JSON." },
  ];
}

const TIPOS_DOC = new Set(["cedula", "pasaporte", "carnet_electoral", "otro"]);
const NACIONALIDADES = new Set(["dominicano", "haitiano", "venezolano", "otro"]);
const COINCIDE = new Set(["si", "no", "dudoso"]);

export function parsearLectura(texto: string): Any | null {
  let obj: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    obj = m ? JSON.parse(m[0]) : null;
  } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  return {
    nombre: typeof obj.nombre === "string" ? obj.nombre.trim() || null : null,
    apellido: typeof obj.apellido === "string" ? obj.apellido.trim() || null : null,
    tipo_documento: TIPOS_DOC.has(obj.tipo_documento) ? obj.tipo_documento : null,
    documento_numero: typeof obj.documento_numero === "string" ? obj.documento_numero.trim() || null : null,
    nacionalidad: NACIONALIDADES.has(obj.nacionalidad) ? obj.nacionalidad : null,
    fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(String(obj.fecha_nacimiento ?? "")) ? obj.fecha_nacimiento : null,
    sexo: obj.sexo === "M" || obj.sexo === "F" ? obj.sexo : null,
    coincide_rostro: COINCIDE.has(obj.coincide_rostro) ? obj.coincide_rostro : "dudoso",
    confianza: typeof obj.confianza === "object" && obj.confianza ? obj.confianza : {},
  };
}
