// _shared/wa-recap-contenido.ts — DL5/DL-20 — qué entra al recap y cómo se
// agrupa. Lógica PURA (sin red/DB) — la edge wa-recap solo trae filas y llama
// a estas funciones.
import type { SeccionPdf } from "./pdf-recap.ts";

export interface HallazgoRecap {
  id: string;
  tipo: string;
  resumen: string;
  detalle: string | null;
  fecha_mencionada: string | null;
  monto: number | null;
  moneda: string | null;
  confianza: number | null;
  estado: string;
  seguimiento: string;
  responsable_nombre: string | null;
  seguimiento_desde: string | null;
  recordatorios_enviados: number;
  creado_en: string;
}

const TIPOS_DECISION = new Set(["decision", "acuerdo", "cambio_de_plan"]);

export interface ContenidoRecapGrupo {
  decisiones: HallazgoRecap[];
  pendientes: HallazgoRecap[];
  fechasProximas: HallazgoRecap[];
  montos: HallazgoRecap[];
  porConfirmar: HallazgoRecap[];
  incidentes: HallazgoRecap[];
  /** Solo semanal: abiertos ya desde ANTES de esta ventana (venían de la semana pasada). */
  pendientesDeAntes: HallazgoRecap[];
  /** Solo semanal: cuántos se cerraron durante esta ventana. */
  resueltosEnVentana: number;
}

export function clasificarParaRecap(
  hallazgosVentana: HallazgoRecap[],
  abiertosActuales: HallazgoRecap[],
  cerradosEnVentana: HallazgoRecap[],
  ventana: { desde: Date; hasta: Date },
  periodo: "dia" | "semana",
): ContenidoRecapGrupo {
  const decisiones = hallazgosVentana.filter((h) => TIPOS_DECISION.has(h.tipo));
  const montos = hallazgosVentana.filter((h) => h.tipo === "monto");
  const incidentes = hallazgosVentana.filter((h) => h.tipo === "incidente");
  const porConfirmar = hallazgosVentana.filter((h) => (h.confianza ?? 1) < 0.7 && h.estado === "nuevo");

  const hoyIso = ventana.hasta.toISOString().slice(0, 10);
  const en7diasIso = new Date(ventana.hasta.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const fechasProximas = abiertosActuales.filter(
    (h) => !!h.fecha_mencionada && h.fecha_mencionada >= hoyIso && h.fecha_mencionada <= en7diasIso,
  );

  let pendientesDeAntes: HallazgoRecap[] = [];
  if (periodo === "semana") {
    pendientesDeAntes = abiertosActuales.filter(
      (h) => !!h.seguimiento_desde && new Date(h.seguimiento_desde) < ventana.desde,
    );
  }

  return {
    decisiones,
    pendientes: abiertosActuales,
    fechasProximas,
    montos,
    porConfirmar,
    incidentes,
    pendientesDeAntes,
    resueltosEnVentana: cerradosEnVentana.length,
  };
}

/** DL-19 — map-reduce: divide en lotes de tamaño fijo para no exceder el
 *  contexto del modelo en grupos muy activos (sin tope de 500 mensajes). */
export function loteMensajes<T>(mensajes: T[], tamanoLote = 150): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < mensajes.length; i += tamanoLote) lotes.push(mensajes.slice(i, i + tamanoLote));
  return lotes;
}

function lineaHallazgo(h: HallazgoRecap): string {
  const partes = [h.resumen];
  if (h.responsable_nombre) partes.push(`responsable: ${h.responsable_nombre}`);
  if (h.fecha_mencionada) partes.push(`fecha: ${h.fecha_mencionada}`);
  if (h.monto != null) partes.push(`${h.moneda ?? ""} ${h.monto}`.trim());
  return partes.join(" — ");
}

/** Secciones de tabla del PDF para UN grupo (DL-20). `resumenIa` es null si el
 *  presupuesto de tokens se agotó (DL-29) — el PDF sale solo con hallazgos. */
export function seccionesPdfGrupo(
  nombreGrupo: string, resumenIa: string | null, contenido: ContenidoRecapGrupo, periodo: "dia" | "semana",
): SeccionPdf[] {
  const secciones: SeccionPdf[] = [];
  secciones.push({
    titulo: `${nombreGrupo}`,
    cols: ["Resumen"],
    rows: [[resumenIa ?? "(sin resumen de IA — presupuesto diario agotado; abajo solo los hallazgos)"]],
  });
  if (contenido.decisiones.length) {
    secciones.push({ titulo: "Decisiones y acuerdos", cols: ["Detalle"], rows: contenido.decisiones.map((h) => [lineaHallazgo(h)]) });
  }
  if (contenido.pendientes.length) {
    secciones.push({
      titulo: "Pendientes abiertos", cols: ["Pendiente", "Responsable", "Seguimiento", "Recordatorios"],
      rows: contenido.pendientes.map((h) => [h.resumen, h.responsable_nombre ?? "(sin asignar)", h.seguimiento, String(h.recordatorios_enviados)]),
    });
  }
  if (contenido.fechasProximas.length) {
    secciones.push({ titulo: "Fechas próximas (≤7 días)", cols: ["Pendiente", "Fecha"], rows: contenido.fechasProximas.map((h) => [h.resumen, h.fecha_mencionada ?? ""]) });
  }
  if (contenido.montos.length) {
    secciones.push({ titulo: "Montos", cols: ["Detalle", "Monto"], rows: contenido.montos.map((h) => [h.resumen, `${h.moneda ?? ""} ${h.monto ?? ""}`.trim()]) });
  }
  if (contenido.porConfirmar.length) {
    secciones.push({ titulo: "Por confirmar (confianza baja)", cols: ["Detalle"], rows: contenido.porConfirmar.map((h) => [lineaHallazgo(h)]) });
  }
  if (contenido.incidentes.length) {
    secciones.push({ titulo: "Incidentes", cols: ["Detalle"], rows: contenido.incidentes.map((h) => [lineaHallazgo(h)]) });
  }
  if (periodo === "semana") {
    secciones.push({
      titulo: "Semana — cumplidos vs. abiertos", cols: ["Métrica", "Cantidad"],
      rows: [
        ["Cerrados esta semana", String(contenido.resueltosEnVentana)],
        ["Siguen abiertos", String(contenido.pendientes.length)],
        ["Abiertos ya desde antes", String(contenido.pendientesDeAntes.length)],
      ],
    });
  }
  return secciones;
}
