// rrhh-leer-cv/lector.ts — DO-06 — lógica pura (testeable sin red): construir
// el contenido del mensaje a Claude y parsear/normalizar la respuesta.
// Modelado sobre leer-documento-flota/lector.ts, pero sin partir en tandas
// (un CV es 1-3 páginas, no hace falta) y usando llamarClaude()/extraerJson()
// de _shared/claude.ts en vez de una llamada fetch propia.
import { extraerJson, type BloqueContenido } from "../_shared/claude.ts";

export const MIMES_ACEPTADOS = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export const SYSTEM_RRHH_CV = `Eres un extractor de datos de hojas de vida / CVs para RRHH de una
constructora en República Dominicana. Recibes un PDF o una foto del CV de un candidato y devuelves
SOLO un objeto JSON válido, sin texto adicional, sin markdown. Formato EXACTO:
{
  "nombre": string|null,
  "telefono": string|null,
  "email": string|null,
  "experiencia_resumen": string|null,   // 2-4 líneas resumiendo su experiencia laboral
  "educacion": string|null,             // nivel/título/institución si se ve
  "cargos_previos": string[]|null       // lista corta de cargos/puestos anteriores, tal como aparecen
}
Reglas:
- Copia teléfono y email EXACTAMENTE como aparecen, no los inventes ni los completes.
- Si un campo no se ve o no aplica, null (o [] para cargos_previos si la lista está vacía).
- NO inventes datos que no estén en el documento. Si el documento no es un CV o es ilegible,
  devuelve todos los campos en null.`;

export interface RrhhCvExtraido {
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  experiencia_resumen: string | null;
  educacion: string | null;
  cargos_previos: string[] | null;
}

/** Construye los bloques de contenido para un único archivo (PDF o imagen). */
export function construirContenidoCv(archivo: { data: string; mime: string }): BloqueContenido[] {
  if (!archivo?.data || !archivo?.mime) throw new Error("Sin archivo para leer.");
  if (!MIMES_ACEPTADOS.has(archivo.mime)) {
    throw new Error("Formato no soportado — sube el CV en PDF o como foto (JPG/PNG/WEBP).");
  }
  const bloqueArchivo: BloqueContenido = archivo.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: archivo.data } }
    : { type: "image", source: { type: "base64", media_type: archivo.mime, data: archivo.data } };
  return [
    bloqueArchivo,
    { type: "text", text: "Lee este CV y devuelve SOLO el JSON con los campos pedidos." },
  ];
}

/** Parsea y normaliza la respuesta del modelo. Devuelve null si no es interpretable. */
export function parsearCv(texto: string): RrhhCvExtraido | null {
  // deno-lint-ignore no-explicit-any
  const obj = extraerJson<Record<string, any>>(texto);
  if (!obj || typeof obj !== "object") return null;
  return {
    nombre: typeof obj.nombre === "string" ? obj.nombre : null,
    telefono: typeof obj.telefono === "string" ? obj.telefono : null,
    email: typeof obj.email === "string" ? obj.email : null,
    experiencia_resumen: typeof obj.experiencia_resumen === "string" ? obj.experiencia_resumen : null,
    educacion: typeof obj.educacion === "string" ? obj.educacion : null,
    cargos_previos: Array.isArray(obj.cargos_previos) ? obj.cargos_previos.filter((c: unknown) => typeof c === "string") : null,
  };
}
