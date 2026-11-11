// _shared/claude-skill-escaneo.ts — DM1 (ronda DM, PROMPT 140 F1). Reglas de
// validación de una skill (DM-05/06, §2.1 del CONTEXTO de la ronda — releídas
// de la doc vigente de Claude en F0): nombre/descripción de SKILL.md, tamaño,
// secretos y código ejecutable. Compartido por claude-skill-validar y por
// quien construya/publique una skill (mismo criterio en un solo lugar).

export const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const EXTENSIONES_EJECUTABLES = [".py", ".sh", ".js", ".ts", ".rb", ".pl"];

const PATRONES_SECRETO: { nombre: string; re: RegExp }[] = [
  { nombre: "clave de API de Anthropic", re: /sk-ant-[a-zA-Z0-9-_]{10,}/ },
  { nombre: "service_role key de Supabase", re: /service_role/i },
  { nombre: "JWT", re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { nombre: "clave privada", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { nombre: "cédula dominicana", re: /\b\d{3}-\d{7}-\d{1}\b/ },
];

export interface ResultadoEscaneo {
  ok: boolean;
  errores: string[];
  avisos: string[];
  tieneCodigoEjecutable: boolean;
  nombreDetectado: string | null;
  descripcionDetectada: string | null;
}

/** Frontmatter YAML sencillo (name/description) — no se trae un parser YAML completo
 *  por 2 campos planos; si alguien usa YAML más complejo, se avisa, no se rompe. */
function leerFrontmatter(contenido: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contenido.trim());
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const linea of m[1].split("\n")) {
    const mm = /^(\w+):\s*(.*)$/.exec(linea.trim());
    if (!mm) continue;
    const [, clave, valor] = mm;
    if (clave === "name") out.name = valor.trim();
    if (clave === "description") out.description = valor.trim();
  }
  return out;
}

export function escanearSkillMd(contenido: string, nombreArchivo: string, esZip: boolean): ResultadoEscaneo {
  const errores: string[] = [];
  const avisos: string[] = [];

  const fm = leerFrontmatter(contenido);
  if (esZip && !fm.name) errores.push("El SKILL.md no trae un frontmatter con `name` válido.");
  if (fm.name) {
    if (!/^[a-z0-9-]{1,64}$/.test(fm.name)) errores.push('El `name` debe ser minúsculas y guiones, máximo 64 caracteres.');
    if (/claude|anthropic/i.test(fm.name)) errores.push('El `name` no puede incluir "claude" ni "anthropic".');
  }
  if (fm.description) {
    if (fm.description.length > 1024) errores.push("La `description` supera los 1024 caracteres.");
    if (/[<>]/.test(fm.description)) errores.push("La `description` no puede incluir `<` ni `>`.");
  } else if (esZip) {
    avisos.push("No se encontró `description` en el frontmatter — agrégala para que la biblioteca la muestre.");
  }

  for (const p of PATRONES_SECRETO) {
    if (p.re.test(contenido)) errores.push(`Se detectó un posible ${p.nombre} dentro del archivo — quítalo antes de guardar.`);
  }

  return {
    ok: errores.length === 0,
    errores,
    avisos,
    tieneCodigoEjecutable: EXTENSIONES_EJECUTABLES.some((ext) => nombreArchivo.toLowerCase().endsWith(ext)),
    nombreDetectado: fm.name ?? null,
    descripcionDetectada: fm.description ?? null,
  };
}

export function combinarResultados(resultados: ResultadoEscaneo[]): ResultadoEscaneo {
  return {
    ok: resultados.every((r) => r.ok),
    errores: resultados.flatMap((r) => r.errores),
    avisos: resultados.flatMap((r) => r.avisos),
    tieneCodigoEjecutable: resultados.some((r) => r.tieneCodigoEjecutable),
    nombreDetectado: resultados.find((r) => r.nombreDetectado)?.nombreDetectado ?? null,
    descripcionDetectada: resultados.find((r) => r.descripcionDetectada)?.descripcionDetectada ?? null,
  };
}
