// EA3 -- logica pura del Ingeniero (cola + despacho). Sin red ni DB: se testea con `deno test`.
// Las edges agente-ingeniero-cola y agente-ingeniero-despachar solo cablean I/O alrededor de esto.

export type Clasificacion = "bug" | "sugerencia" | "crash" | "barrido";
export type Severidad = "baja" | "media" | "alta" | "critica";
export type Repo = "sgc" | "csd-app";

export interface IngConfig {
  agentes_auto_prod: boolean;
  agentes_pausa_total: boolean;
  max_prod_por_dia: number;
  max_archivos: number;
  max_lineas: number;
  presupuesto_ia_dia_usd: number;
  max_intentos: number;
  max_pr_barrido: number;
}

export const CONFIG_DEFECTO: IngConfig = {
  agentes_auto_prod: true,
  agentes_pausa_total: false,
  max_prod_por_dia: 3,
  max_archivos: 8,
  max_lineas: 300,
  presupuesto_ia_dia_usd: 10,
  max_intentos: 3,
  max_pr_barrido: 2,
};

/** Mezcla lo leido de sgc.ing_config_leer() con los defaults (tipos defensivos). */
export function normalizarConfig(raw: unknown): IngConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof IngConfig): number => {
    const v = Number(r[k]);
    return Number.isFinite(v) ? v : (CONFIG_DEFECTO[k] as number);
  };
  const bool = (k: keyof IngConfig): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : (CONFIG_DEFECTO[k] as boolean));
  return {
    agentes_auto_prod: bool("agentes_auto_prod"),
    agentes_pausa_total: bool("agentes_pausa_total"),
    max_prod_por_dia: num("max_prod_por_dia"),
    max_archivos: num("max_archivos"),
    max_lineas: num("max_lineas"),
    presupuesto_ia_dia_usd: num("presupuesto_ia_dia_usd"),
    max_intentos: num("max_intentos"),
    max_pr_barrido: num("max_pr_barrido"),
  };
}

// -- Saneado (espejo de sgc.ing_sanear_texto) ---------------------------------
export function sanearTexto(t: string | null | undefined, max = 4000): string {
  return (t ?? "")
    // deno-lint-ignore no-control-regex
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replaceAll("<<<", "<<")
    .replaceAll(">>>", ">>")
    .slice(0, max);
}

// -- Clasificacion -------------------------------------------------------------
const PISTAS_ERROR = /\b(error|falla|fallo|fall[oó]|no funciona|no carga|no abre|no deja|no puedo|se cae|se traba|se congela|bloquea|pantalla en blanco|no guarda|no aparece|crash|cierra sola|permission denied|undefined|null)\b/i;
const PISTAS_FUNCION_NUEVA = /\b(agregar|a[nñ]adir|quisiera|me gustar[ií]a|ser[ií]a bueno|ser[ií]a [uú]til|sugiero|sugerencia|nueva funci[oó]n|nuevo m[oó]dulo|podr[ií]a tener|que tenga|ojal[aá]|mejorar el dise[nñ]o)\b/i;

export interface ReporteLite { tipo: string; asunto: string; descripcion: string }

/** bug | sugerencia | null (null = no es accionable por el Ingeniero, p. ej. un comentario). */
export function clasificarReporte(r: ReporteLite): "bug" | "sugerencia" | null {
  const texto = `${r.asunto} ${r.descripcion}`;
  const error = PISTAS_ERROR.test(texto);
  const nueva = PISTAS_FUNCION_NUEVA.test(texto);
  if (r.tipo === "sugerencia") return "sugerencia";
  if (r.tipo === "bug") return nueva && !error ? "sugerencia" : "bug";
  // 'comentario': solo si claramente reporta una falla
  return error && !nueva ? "bug" : null;
}

export interface ErrorGrupo {
  source: string; // 'app' | 'web'
  error_type: string;
  message: string;
  ocurrencias: number;
  dispositivos: number;
  platform?: string | null;
}

export function clasificarError(g: Pick<ErrorGrupo, "error_type" | "source">): "crash" | "bug" {
  return g.error_type === "crash" ? "crash" : "bug";
}

/** Los crashes/errores nativos van al repo de la app; web y reportes de usuario a SGC. */
export function repoParaError(g: Pick<ErrorGrupo, "source" | "platform" | "error_type">): Repo {
  if (g.source === "web") return "sgc";
  const p = (g.platform ?? "").toLowerCase();
  return p === "android" || p === "ios" || g.error_type === "crash" ? "csd-app" : "sgc";
}

export function severidadError(ocurrencias: number, dispositivos: number, tipo: string): Severidad {
  if (tipo === "crash" && (ocurrencias >= 10 || dispositivos >= 3)) return "critica";
  if (ocurrencias >= 20 || dispositivos >= 5) return "alta";
  if (ocurrencias >= 5 || dispositivos >= 2 || tipo === "crash") return "media";
  return "baja";
}

export function severidadReporte(r: ReporteLite): Severidad {
  return /\b(no puedo (entrar|iniciar)|pierdo|se perdi[oó]|datos (borrados|perdidos)|urgente|bloquea todo)\b/i.test(`${r.asunto} ${r.descripcion}`)
    ? "alta"
    : "media";
}

// -- Deduplicacion -------------------------------------------------------------
/** Normaliza un mensaje de error: minusculas, sin uuids/hex/numeros/rutas variables. */
export function normalizarFirma(message: string): string {
  return (message ?? "")
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/0x[0-9a-f]+/g, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Hash FNV-1a 32 bits, estable, en base36. No es criptografico: solo clave de dedupe. */
export function hashCorto(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function origenParaError(g: Pick<ErrorGrupo, "source" | "error_type">): "crash_app" | "error_web" {
  return g.source === "web" ? "error_web" : "crash_app";
}

export function refError(g: Pick<ErrorGrupo, "source" | "error_type" | "message">): string {
  return `${g.source}:${g.error_type}:${hashCorto(normalizarFirma(g.message))}`;
}

export interface CandidatoTarea {
  origen: "reporte_usuario" | "crash_app" | "error_web" | "barrido";
  origen_ref: string;
  clasificacion: Clasificacion;
  titulo: string;
  texto_origen: string;
  severidad: Severidad;
  repo: Repo;
  reporte_id?: string | null;
  modulo?: string | null;
}

/** Quita lo que ya existe (por origen+ref) y colapsa duplicados dentro del mismo lote (queda el mas severo). */
export function deduplicar(candidatos: CandidatoTarea[], existentes: ReadonlySet<string>): CandidatoTarea[] {
  const orden: Record<Severidad, number> = { baja: 0, media: 1, alta: 2, critica: 3 };
  const porClave = new Map<string, CandidatoTarea>();
  for (const c of candidatos) {
    const k = `${c.origen}|${c.origen_ref}`;
    if (existentes.has(k)) continue;
    const previo = porClave.get(k);
    if (!previo || orden[c.severidad] > orden[previo.severidad]) porClave.set(k, c);
  }
  return [...porClave.values()];
}

/** Estado inicial: sugerencias y funciones nuevas NO se programan solas -> 'propuesta'. */
export function estadoInicial(clasificacion: Clasificacion): "nueva" | "propuesta" {
  return clasificacion === "sugerencia" ? "propuesta" : "nueva";
}

// -- Barrido -------------------------------------------------------------------
/** Modulos de SGC, los mas conectados del grafo primero (la rotacion los recorre en orden). */
export const MODULOS_BARRIDO: readonly string[] = [
  "inventario", "conduces", "bitacora", "solicitudes", "flota", "compras", "documentos", "proyectos",
  "rrhh", "tareas", "mensajeria", "legal", "reuniones", "notas", "dashboard", "tecnologia", "administracion", "configuracion",
];

/** Semana ISO-ish estable (dias desde 2026-01-05, un lunes, / 7). */
function indiceSemana(fecha: Date): number {
  const base = Date.UTC(2026, 0, 5);
  const d = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return Math.floor((d - base) / (7 * 86_400_000));
}

/**
 * Rota los modulos: 2 corridas por semana (martes y viernes) x `cuantos` modulos distintos por corrida.
 * Deterministico para una fecha dada; nunca repite modulo dentro de la misma corrida.
 */
export function modulosDelBarrido(fecha: Date, cuantos: number, modulos: readonly string[] = MODULOS_BARRIDO): string[] {
  const n = modulos.length;
  const q = Math.max(0, Math.min(cuantos, n));
  const corrida = indiceSemana(fecha) * 2 + (fecha.getUTCDay() >= 5 || fecha.getUTCDay() === 0 ? 1 : 0);
  const inicio = ((corrida * q) % n + n) % n;
  return Array.from({ length: q }, (_, i) => modulos[(inicio + i) % n]);
}

export function refBarrido(fechaIsoDia: string, modulo: string): string {
  return `barrido:${fechaIsoDia}:${modulo}`;
}

// -- Candidatos desde las fuentes ------------------------------------------------
export interface ReporteFila extends ReporteLite { id: string; created_at: string }
export const UMBRAL_ERROR_NO_CRASH = 3;

export function candidatosDeReportes(filas: ReporteFila[]): CandidatoTarea[] {
  const out: CandidatoTarea[] = [];
  for (const r of filas) {
    // los reportes que abrio el propio Vigia ya se cubren via el grupo de errores
    if (r.asunto.startsWith("Error repetido detectado por Vig")) continue;
    const clasificacion = clasificarReporte(r);
    if (!clasificacion) continue;
    out.push({
      origen: "reporte_usuario",
      origen_ref: r.id,
      clasificacion,
      titulo: sanearTexto(r.asunto, 200) || "Reporte sin asunto",
      texto_origen: sanearTexto(`${r.asunto}

${r.descripcion}`),
      severidad: severidadReporte(r),
      repo: "sgc",
      reporte_id: r.id,
    });
  }
  return out;
}

export interface ErrorFila { source: string; error_type: string; message: string; stack?: string | null; platform?: string | null; device_model?: string | null }

/** Agrupa filas crudas por firma normalizada y devuelve un candidato por grupo que pase el umbral. */
export function candidatosDeErrores(filas: ErrorFila[]): CandidatoTarea[] {
  const grupos = new Map<string, { g: ErrorGrupo; stack: string; dispositivos: Set<string> }>();
  for (const f of filas) {
    const ref = refError(f);
    let e = grupos.get(ref);
    if (!e) {
      e = { g: { source: f.source, error_type: f.error_type, message: f.message, ocurrencias: 0, dispositivos: 0, platform: f.platform ?? null }, stack: f.stack ?? "", dispositivos: new Set() };
      grupos.set(ref, e);
    }
    e.g.ocurrencias++;
    e.dispositivos.add(f.device_model ?? "?");
    if (!e.stack && f.stack) e.stack = f.stack;
  }
  const out: CandidatoTarea[] = [];
  for (const [ref, e] of grupos) {
    e.g.dispositivos = e.dispositivos.size;
    if (e.g.error_type !== "crash" && e.g.ocurrencias < UMBRAL_ERROR_NO_CRASH) continue;
    out.push({
      origen: origenParaError(e.g),
      origen_ref: ref,
      clasificacion: clasificarError(e.g),
      titulo: sanearTexto(`${e.g.error_type}: ${e.g.message}`, 200),
      texto_origen: sanearTexto(`${e.g.message}

${e.stack.slice(0, 1500)}

ocurrencias=${e.g.ocurrencias} dispositivos=${e.g.dispositivos}`),
      severidad: severidadError(e.g.ocurrencias, e.g.dispositivos, e.g.error_type),
      repo: repoParaError(e.g),
    });
  }
  return out;
}

export function candidatosDeBarrido(fecha: Date, cfg: IngConfig): CandidatoTarea[] {
  const dia = fecha.toISOString().slice(0, 10);
  return modulosDelBarrido(fecha, cfg.max_pr_barrido).map((modulo) => ({
    origen: "barrido" as const,
    origen_ref: refBarrido(dia, modulo),
    clasificacion: "barrido" as const,
    titulo: `Barrido de codigo: modulo ${modulo}`,
    texto_origen: `Revisar el modulo ${modulo} buscando bugs o mejoras pequenas, solo con prueba y dentro de los topes (${cfg.max_archivos} archivos, ${cfg.max_lineas} lineas).`,
    severidad: "baja" as const,
    repo: "sgc" as const,
    modulo,
  }));
}

// -- Despacho ------------------------------------------------------------------
export interface TareaDespacho {
  id: string;
  estado: string;
  severidad: Severidad;
  repo: Repo;
  creada_en: string;
  despachada_en: string | null;
  despachos: number;
}
export interface EstadoDia { prod_hoy: number; costo_hoy_usd: number }

export const MAX_DESPACHOS_POR_TAREA = 3;
export const REDESPACHO_MIN_HORAS = 2;
export const MAX_EN_VUELO = 2;

export type MotivoNoDespacho = "pausa_total" | "tope_prod_diario" | "presupuesto_agotado" | null;

/** Frenos globales. null = se puede despachar. */
export function frenoGlobal(cfg: IngConfig, dia: EstadoDia): MotivoNoDespacho {
  if (cfg.agentes_pausa_total) return "pausa_total";
  if (dia.prod_hoy >= cfg.max_prod_por_dia) return "tope_prod_diario";
  if (dia.costo_hoy_usd >= cfg.presupuesto_ia_dia_usd) return "presupuesto_agotado";
  return null;
}

export function tareaDespachable(t: TareaDespacho, ahoraMs: number): boolean {
  if (t.estado !== "nueva") return false;
  if (t.despachos >= MAX_DESPACHOS_POR_TAREA) return false;
  if (t.despachada_en && ahoraMs - Date.parse(t.despachada_en) < REDESPACHO_MIN_HORAS * 3_600_000) return false;
  return true;
}

/**
 * Elige que tareas despachar en esta corrida: por severidad y luego antiguedad, sin pasar de
 * MAX_EN_VUELO tareas trabajandose a la vez ni de los cupos de prod que quedan hoy.
 */
export function seleccionarDespachos(
  tareas: TareaDespacho[],
  enVuelo: number,
  cfg: IngConfig,
  dia: EstadoDia,
  ahoraMs: number,
): { elegidas: TareaDespacho[]; freno: MotivoNoDespacho } {
  const freno = frenoGlobal(cfg, dia);
  if (freno) return { elegidas: [], freno };
  const peso: Record<Severidad, number> = { baja: 0, media: 1, alta: 2, critica: 3 };
  const cupos = Math.max(0, Math.min(MAX_EN_VUELO - enVuelo, cfg.max_prod_por_dia - dia.prod_hoy - enVuelo));
  const elegidas = tareas
    .filter((t) => tareaDespachable(t, ahoraMs))
    .sort((a, b) => peso[b.severidad] - peso[a.severidad] || Date.parse(a.creada_en) - Date.parse(b.creada_en))
    .slice(0, cupos);
  return { elegidas, freno: null };
}

/** Cuerpo de repository_dispatch. El client_payload lleva SOLO tarea_id y repo: nunca texto de usuario. */
export function payloadDispatch(t: Pick<TareaDespacho, "id" | "repo">): { event_type: string; client_payload: { tarea_id: string; repo: Repo } } {
  return { event_type: "agente-ingeniero", client_payload: { tarea_id: t.id, repo: t.repo } };
}

export function repoGithub(repo: Repo, env: { sgc?: string; csdApp?: string } = {}): string {
  return repo === "csd-app" ? (env.csdApp ?? "techcsd/csd-app") : (env.sgc ?? "techcsd/SGC");
}

// -- Informe diario (Cronista) -------------------------------------------------
export interface TareaInforme {
  titulo: string;
  estado: string;
  repo: string;
  pr_url: string | null;
  costo_ia: number;
  motivo: string | null;
  zona_roja: boolean;
  prod_en: string | null;
  cerrada_en: string | null;
  updated_at: string;
}

/**
 * Seccion "Cambios del Ingeniero" del informe diario, determinista, sin IA.
 * Devuelve las lineas markdown y si hubo actividad (decide la notificacion a Xaviel).
 */
export function seccionIngeniero(tareas: TareaInforme[]): { lineas: string[]; hayActividad: boolean } {
  const lineas: string[] = ["## Cambios del Ingeniero", ""];
  if (!tareas.length) {
    lineas.push("Sin actividad del Ingeniero hoy.");
    return { lineas, hayActividad: false };
  }
  const grupo = (estado: string) => tareas.filter((t) => t.estado === estado);
  const linea = (t: TareaInforme) => `- ${t.titulo} (${t.repo})${t.pr_url ? ` - ${t.pr_url}` : ""}${t.motivo ? ` - ${t.motivo}` : ""}`;
  const bloque = (titulo: string, lista: TareaInforme[]) => {
    lineas.push(`**${titulo}:** ${lista.length}.`);
    for (const t of lista) lineas.push(linea(t));
    lineas.push("");
  };
  bloque("Llegaron a produccion", grupo("en_prod"));
  bloque("Quedaron en dev (probar y/o esperando tu OK)", grupo("en_dev"));
  bloque("Se revirtieron", grupo("revertida"));
  bloque("Necesitan a una persona", grupo("necesita_humano"));
  const zona = tareas.filter((t) => t.zona_roja && t.estado !== "en_prod" && t.estado !== "rechazada");
  if (zona.length) bloque("Zona roja esperando tu OK", zona);
  bloque("Propuestas (plan para ti, sin codigo)", grupo("propuesta"));
  const costo = tareas.reduce((s, t) => s + (Number(t.costo_ia) || 0), 0);
  lineas.push(`**Costo de IA de estas tareas:** $${costo.toFixed(2)}.`);
  return { lineas, hayActividad: true };
}
