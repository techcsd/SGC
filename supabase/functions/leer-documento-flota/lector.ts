// leer-documento-flota/lector.ts — DB3 — lógica pura (testeable sin red):
// construir el contenido del mensaje y parsear la respuesta del modelo.

// deno-lint-ignore no-explicit-any
export type Any = any;

export const MIMES_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
export const MAX_IMAGENES = 20;

export const TIPOS_PAGINA = ["seguro", "matricula", "marbete_dgii", "licencia", "otro", "reverso"] as const;

export const SYSTEM = `Eres un extractor de datos de documentos de VEHÍCULOS de República Dominicana
(marbetes/certificados de seguro, matrículas, marbetes de la DGII, licencias). Recibes un PDF
multipágina o una serie de fotos y devuelves SOLO un objeto JSON válido, sin texto adicional,
sin markdown. Formato EXACTO:
{
  "paginas": [
    {
      "pagina": number,            // 1-based, en el orden recibido
      "tipo": "seguro"|"matricula"|"marbete_dgii"|"licencia"|"otro"|"reverso",
      "campos": {
        "poliza": string|null,            // número de póliza (seguro)
        "aseguradora": string|null,       // p. ej. "SURA"
        "vigencia_desde": "YYYY-MM-DD"|null,
        "vigencia_hasta": "YYYY-MM-DD"|null,
        "placa": string|null,             // en los seguros SURA aparece como "Registro"
        "chasis": string|null,            // VIN
        "marca": string|null,
        "modelo": string|null,
        "anio": number|null,
        "numero_matricula": string|null,  // solo matrícula
        "marbete_numero": string|null     // solo marbete DGII
      },
      "confianza": { "<campo>": number }  // 0..1 solo de los campos que SÍ leíste
    }
  ]
}
Reglas:
- Una página que solo trae instrucciones ("en caso de accidente…", teléfonos, pasos) es el
  REVERSO de un documento: tipo "reverso", campos en null.
- En los certificados de seguro dominicanos, "Registro" es la PLACA del vehículo.
- Copia la placa EXACTAMENTE como se lee, carácter por carácter — NO la "corrijas" ni la
  completes aunque parezca un error; el sistema la valida contra la flota real.
- Fechas con hora ("28/10/2026 03:10 PM") → solo la fecha, formato YYYY-MM-DD.
- Si un campo no se ve o no aplica, null y sin entrada en confianza.
- NO inventes datos. Si una página es ilegible, tipo "otro" con campos null.`;

/** Construye los bloques de contenido (1 PDF nativo o hasta 20 imágenes numeradas). */
export function construirContenido(archivos: { data: string; mime: string }[]): Any[] {
  if (!archivos.length) throw new Error("Sin archivos para leer.");
  const esPdf = archivos[0].mime === "application/pdf";
  if (esPdf) {
    if (archivos.length > 1) throw new Error("Un solo PDF por lectura (o hasta 20 fotos).");
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: archivos[0].data } },
      { type: "text", text: "Lee TODAS las páginas de este PDF de documentos de vehículos y devuelve SOLO el JSON con el array `paginas` (una entrada por página del PDF, en orden)." },
    ];
  }
  if (archivos.length > MAX_IMAGENES) throw new Error(`Máximo ${MAX_IMAGENES} fotos por lectura.`);
  const bad = archivos.find((a) => !MIMES_IMAGEN.has(a.mime));
  if (bad) throw new Error("Formato no soportado (usa un PDF o fotos JPG/PNG/WEBP).");
  const content: Any[] = [];
  archivos.forEach((a, i) => {
    content.push({ type: "text", text: `Página ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: a.mime, data: a.data } });
  });
  content.push({ type: "text", text: "Lee estas fotos de documentos de vehículos y devuelve SOLO el JSON con el array `paginas` (una entrada por foto, en el orden numerado)." });
  return content;
}

/** Parsea y normaliza la respuesta del modelo. Devuelve null si no es interpretable. */
export function parsearPaginas(texto: string): Any[] | null {
  let obj: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    obj = m ? JSON.parse(m[0]) : null;
  } catch { return null; }
  const paginas = obj?.paginas;
  if (!Array.isArray(paginas)) return null;
  return paginas.map((p: Any, i: number) => ({
    pagina: Number.isFinite(Number(p?.pagina)) ? Number(p.pagina) : i + 1,
    tipo: TIPOS_PAGINA.includes(p?.tipo) ? p.tipo : "otro",
    campos: typeof p?.campos === "object" && p.campos ? p.campos : {},
    confianza: typeof p?.confianza === "object" && p.confianza ? p.confianza : {},
  }));
}
