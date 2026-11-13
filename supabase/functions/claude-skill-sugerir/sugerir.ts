// claude-skill-sugerir/sugerir.ts — DO-10(e) — lógica pura (testeable sin red):
// construir el prompt y parsear la respuesta del modelo.
import { extraerJson } from "../_shared/claude.ts";

export const SYSTEM_SUGERIR_SKILL = `Eres un asistente que ayuda a un empleado de una constructora
dominicana a redactar una "skill" (atajo) para Claude. Recibes qué hace la skill, cuándo se usa, el
rol de quien la crea, y una lista de skills que esa persona YA puede ver (para que no te repitas y
mantengas el mismo tono). Devuelve SOLO un objeto JSON válido, sin texto adicional, sin markdown:
{ "pasos": string, "ejemplo": string }
Reglas:
- "pasos": una lista corta y concreta de pasos (numerados o con guiones, texto plano) de cómo Claude
  debe ejecutar la tarea.
- "ejemplo": un ejemplo breve de petición de la persona y, si aplica, de cómo luciría la respuesta.
- Español dominicano de oficina/obra, directo, sin relleno.
- Es un BORRADOR — la persona lo va a revisar y editar antes de guardar, no hace falta que sea perfecto.`;

export interface SugerirInput {
  queHace: string;
  cuandoUsarla: string;
  roles: string[];
  skillsVisibles: { nombre: string; descripcion: string }[];
}

export function construirPromptSugerir(input: SugerirInput): string {
  const roles = input.roles.length ? input.roles.join(', ') : 'sin rol específico';
  const lista = input.skillsVisibles.length
    ? input.skillsVisibles.slice(0, 15).map((s) => `- ${s.nombre}: ${s.descripcion}`).join('\n')
    : '(ninguna todavía)';
  return `Rol de quien crea la skill: ${roles}
Qué hace la skill nueva: ${input.queHace || '(no especificado)'}
Cuándo se usa: ${input.cuandoUsarla || '(no especificado)'}

Skills que esta persona ya puede ver (para contexto de tono, NO las repitas):
${lista}

Devuelve el JSON con "pasos" y "ejemplo".`;
}

export interface SugerenciaSkill { pasos: string; ejemplo: string }

export function parsearSugerencia(texto: string): SugerenciaSkill | null {
  // deno-lint-ignore no-explicit-any
  const obj = extraerJson<Record<string, any>>(texto);
  if (!obj || typeof obj !== "object") return null;
  const pasos = typeof obj.pasos === "string" ? obj.pasos : null;
  const ejemplo = typeof obj.ejemplo === "string" ? obj.ejemplo : null;
  if (pasos === null && ejemplo === null) return null;
  return { pasos: pasos ?? "", ejemplo: ejemplo ?? "" };
}
