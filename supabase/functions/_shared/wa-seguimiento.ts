// _shared/wa-seguimiento.ts — DL4/F4 (ronda DL, 10-nov-2026) — lógica PURA
// (sin red/DB) de la escalera de recordatorios de hallazgos de WhatsApp.
// La edge wa-seguimiento solo orquesta I/O y llama a estas funciones — así se
// prueban con `deno test` sin mockear Supabase.
//
// República Dominicana es UTC-4 todo el año (no observa horario de verano) —
// por eso la conversión es una resta fija de 4 horas, sin tabla de reglas.

// deno-lint-ignore no-explicit-any
export type Any = any;

const RD_OFFSET_MS = 4 * 3600_000;

/** Fecha (YYYY-MM-DD) en hora de Santo Domingo para un instante dado. */
export function fechaRD(d: Date): string {
  return new Date(d.getTime() - RD_OFFSET_MS).toISOString().slice(0, 10);
}

/** Suma/resta días a una fecha ISO (YYYY-MM-DD), sin zona horaria (fecha pura). */
export function sumarDiasIso(fechaIso: string, dias: number): string {
  const [y, m, d] = fechaIso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function horasDesde(iso: string, ahoraMs: number = Date.now()): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (ahoraMs - t) / 3_600_000);
}

export type NivelRecordatorio = 0 | 1 | 2 | 3;

/**
 * DL-11 — escalera por antigüedad (días completos desde `seguimiento_desde`):
 * día 1 → nivel 1 · día 2 → nivel 2 · día 3, 6, 9, 12 → nivel 3 (también a
 * responsables/Tecnología) · día ≥14 → vencido, sin más recordatorios.
 * Entre umbrales (p.ej. día 4-5) → nivel 0 (ya se recordó ese umbral).
 */
export function nivelDeHoy(horasAbierto: number): { nivel: NivelRecordatorio; vencido: boolean } {
  const dias = Math.floor(horasAbierto / 24);
  if (dias >= 14) return { nivel: 0, vencido: true };
  if (dias === 3 || (dias > 3 && (dias - 3) % 3 === 0)) return { nivel: 3, vencido: false };
  if (dias === 2) return { nivel: 2, vencido: false };
  if (dias === 1) return { nivel: 1, vencido: false };
  return { nivel: 0, vencido: false };
}

/** DL-11 — fecha_mencionada: recordar la víspera y el mismo día, sin importar la antigüedad. */
export function debeRecordarPorFechaLimite(fechaMencionada: string | null, hoyRD: string): boolean {
  if (!fechaMencionada) return false;
  return fechaMencionada === hoyRD || fechaMencionada === sumarDiasIso(hoyRD, 1);
}

export interface HallazgoPendienteBase {
  id: string;
  responsable_id: string;
  grupo_jid: string;
  grupo_nombre: string;
  resumen: string;
  fecha_mencionada: string | null;
  seguimiento_desde: string;
}

export interface HallazgoAEvaluar extends HallazgoPendienteBase {
  nivel: NivelRecordatorio;
  vencido: boolean;
  porFechaLimite: boolean;
}

/** Evalúa un hallazgo abierto para "hoy" (hoyRD + ahoraMs ya resueltos por el llamador). */
export function evaluarHallazgo(h: HallazgoPendienteBase, hoyRD: string, ahoraMs: number): HallazgoAEvaluar {
  const horas = horasDesde(h.seguimiento_desde, ahoraMs);
  const { nivel, vencido } = nivelDeHoy(horas);
  const porFechaLimite = debeRecordarPorFechaLimite(h.fecha_mencionada, hoyRD);
  return { ...h, nivel: porFechaLimite && nivel === 0 ? 1 : nivel, vencido, porFechaLimite };
}

/** Solo los que de verdad tocan recordatorio hoy (nivel > 0; vencidos se marcan pero no recuerdan). */
export function filtrarParaRecordar(evaluados: HallazgoAEvaluar[]): HallazgoAEvaluar[] {
  return evaluados.filter((h) => h.nivel > 0);
}

/** Los que cumplieron 14 días (para marcar seguimiento='vencido', sin enviar nada). */
export function filtrarParaVencer(evaluados: HallazgoAEvaluar[]): HallazgoAEvaluar[] {
  return evaluados.filter((h) => h.vencido);
}

export interface ConsolidadoPersona {
  usuarioId: string;
  items: HallazgoAEvaluar[];
  nivelMax: NivelRecordatorio;
}

/** Un solo mensaje consolidado por persona (máx 1 recordatorio/persona/día). */
export function consolidarPorPersona(items: HallazgoAEvaluar[]): ConsolidadoPersona[] {
  const porPersona = new Map<string, HallazgoAEvaluar[]>();
  for (const h of items) {
    const lista = porPersona.get(h.responsable_id) ?? [];
    lista.push(h);
    porPersona.set(h.responsable_id, lista);
  }
  return [...porPersona.entries()].map(([usuarioId, lista]) => ({
    usuarioId,
    items: lista,
    nivelMax: lista.reduce((max, h) => (h.nivel > max ? h.nivel : max), 0 as NivelRecordatorio),
  }));
}

/** Nivel 3 escala, ADEMÁS, a los responsables del grupo/Tecnología — un solo
 *  correo "sin respuesta tras 72h" por destinatario de escalación. */
export function consolidarEscalacionNivel3(items: HallazgoAEvaluar[]): Map<string, HallazgoAEvaluar[]> {
  const soloNivel3 = items.filter((h) => h.nivel === 3);
  const porGrupo = new Map<string, HallazgoAEvaluar[]>();
  for (const h of soloNivel3) {
    const lista = porGrupo.get(h.grupo_jid) ?? [];
    lista.push(h);
    porGrupo.set(h.grupo_jid, lista);
  }
  return porGrupo;
}

/** DL-13 — canal WhatsApp: solo si escribió a Compa en las últimas 24h (sin
 *  plantilla aprobada, Meta no deja iniciar la conversación fuera de esa ventana). */
export function dentroDeVentanaWhatsapp(ultimoMensajeEn: string | null, ahoraMs: number = Date.now()): boolean {
  if (!ultimoMensajeEn) return false;
  return horasDesde(ultimoMensajeEn, ahoraMs) <= 24;
}

/** Clave única de dedupe (1 por persona/fecha-RD/canal); la unicidad la hace
 *  cumplir también la columna `dedupe_key` de sgc.wa_recordatorios. */
export function dedupeKey(usuarioId: string, hoyRD: string, canal: string): string {
  return `${usuarioId}|${hoyRD}|${canal}`;
}

// ── Texto del recordatorio (autocontenido — el destinatario no puede abrir
//    los hallazgos, BS2/regla de permisos: wa_hallazgos_sel exige el submódulo). ─
function lineaItem(h: HallazgoAEvaluar): string {
  const limite = h.fecha_mencionada ? ` (fecha mencionada: ${h.fecha_mencionada})` : "";
  return `• ${h.resumen} — grupo "${h.grupo_nombre}"${limite}`;
}

export function construirCorreoRecordatorio(items: HallazgoAEvaluar[]): { asunto: string; textoPlano: string } {
  const asunto = `Tienes ${items.length} pendiente${items.length === 1 ? "" : "s"} de tus grupos de WhatsApp`;
  const cuerpo = [
    "Compa detectó estos pendientes en tus grupos de WhatsApp:",
    "",
    ...items.map(lineaItem),
    "",
    "Si ya lo resolviste, escríbelo en el grupo y Compa lo detectará; también puedes preguntarle a Compa \"¿qué me falta de los grupos?\".",
    "",
    "Generado por IA, puede contener errores.",
  ].join("\n");
  return { asunto, textoPlano: cuerpo };
}

export function construirCorreoEscalacionNivel3(grupoNombre: string, items: HallazgoAEvaluar[]): { asunto: string; textoPlano: string } {
  const asunto = `Sin respuesta tras 72h — grupo "${grupoNombre}"`;
  const cuerpo = [
    `Estos pendientes del grupo "${grupoNombre}" llevan 72h o más sin cerrarse:`,
    "",
    ...items.map(lineaItem),
    "",
    "Generado por IA, puede contener errores.",
  ].join("\n");
  return { asunto, textoPlano: cuerpo };
}
