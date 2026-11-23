// DX10 — texto ACOTADO de un documento adjunto a un reporte, para que `resumir-reporte` lo pueda leer.
// PDF no pasa por aquí (Anthropic lo lee nativo como bloque `document`). Todo tope es duro: un reporte nunca
// debe disparar un prompt gigante. El contenido del adjunto es DATO, jamás instrucción.

export const MAX_CHARS_ADJUNTO = 4000;
export const MAX_FILAS_EXCEL = 40;

export type TipoAdjunto = "pdf" | "docx" | "xlsx" | "csv" | "txt" | "legacy" | "otro";

export function tipoDeAdjunto(nombre: string): TipoAdjunto {
  const ext = (/\.([A-Za-z0-9]+)$/.exec(nombre ?? "")?.[1] ?? "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv") return "csv";
  if (ext === "txt") return "txt";
  if (ext === "doc" || ext === "xls") return "legacy"; // binarios antiguos: se listan, no se leen
  return "otro";
}

export function acotar(texto: string, max = MAX_CHARS_ADJUNTO): string {
  const t = (texto ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
  return t.length > max ? t.slice(0, max) + `\n[… recortado a ${max} caracteres]` : t;
}

/** Texto plano del adjunto o `null` si no se puede/debe leer. Nunca lanza. */
export async function textoDeAdjunto(nombre: string, bytes: Uint8Array): Promise<string | null> {
  try {
    const tipo = tipoDeAdjunto(nombre);
    if (tipo === "csv" || tipo === "txt") return acotar(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    if (tipo === "xlsx") {
      const XLSX = await import("npm:xlsx@0.18.5");
      const wb = XLSX.read(bytes, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      return acotar(`[Hoja: ${wb.SheetNames[0]} — primeras ${MAX_FILAS_EXCEL} filas]\n` + filas.slice(0, MAX_FILAS_EXCEL).map((r) => r.join(" | ")).join("\n"));
    }
    if (tipo === "docx") {
      const mammoth = await import("npm:mammoth@1.12.0");
      const r = await (mammoth.default ?? mammoth).extractRawText({ buffer: bytes as unknown as Buffer });
      return acotar(r.value);
    }
    return null;
  } catch (_e) {
    return null;
  }
}
