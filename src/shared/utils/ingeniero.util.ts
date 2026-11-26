// EA3 -- utilidades puras de "Cambios del Ingeniero" (sin Angular, testeables con vitest).

export type IngTareaEstado =
  | 'nueva' | 'analizando' | 'plan_listo' | 'en_codigo' | 'en_revision' | 'en_dev' | 'en_prod'
  | 'rechazada' | 'necesita_humano' | 'revertida' | 'propuesta';

export type IngBadge = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export const ING_ESTADO_LABEL: Record<IngTareaEstado, string> = {
  nueva: 'Nueva',
  analizando: 'Analizando',
  plan_listo: 'Plan listo',
  en_codigo: 'Escribiendo código',
  en_revision: 'En revisión',
  en_dev: 'En dev',
  en_prod: 'En producción',
  rechazada: 'Rechazada',
  necesita_humano: 'Necesita una persona',
  revertida: 'Revertida',
  propuesta: 'Propuesta (plan)',
};

const BADGE: Record<IngTareaEstado, IngBadge> = {
  nueva: 'neutral', analizando: 'info', plan_listo: 'info', en_codigo: 'info', en_revision: 'info',
  en_dev: 'warning', en_prod: 'success', rechazada: 'neutral', necesita_humano: 'danger',
  revertida: 'danger', propuesta: 'neutral',
};

export function badgeEstado(estado: string): IngBadge {
  return BADGE[estado as IngTareaEstado] ?? 'neutral';
}

/** Estados en los que el agente sigue trabajando (cuentan para el contador de la oficina). */
export const ING_ESTADOS_ACTIVOS: readonly IngTareaEstado[] = ['nueva', 'analizando', 'plan_listo', 'en_codigo', 'en_revision'];

export interface IngVeredicto { veredicto?: string; resumen?: string; motivos?: string[] }

export type VeredictoBadge = { clave: 'G1' | 'G2'; texto: string; badge: IngBadge };

/** G1 = reglas/seguridad, G2 = negocio/pruebas. Sin dato = "Pendiente". */
export function resumirVeredictos(v: unknown): VeredictoBadge[] {
  const obj = (v && typeof v === 'object' ? v : {}) as Record<string, IngVeredicto | undefined>;
  return (['G1', 'G2'] as const).map((clave) => {
    const x = obj[clave];
    const ver = (x?.veredicto ?? '').toLowerCase();
    if (!x || !ver) return { clave, texto: 'Pendiente', badge: 'neutral' as IngBadge };
    if (['aprueba', 'aprobado', 'ok', 'pass'].includes(ver)) return { clave, texto: 'Aprobó', badge: 'success' as IngBadge };
    if (['rechaza', 'rechazado', 'fail'].includes(ver)) return { clave, texto: 'Rechazó', badge: 'danger' as IngBadge };
    return { clave, texto: x.veredicto ?? 'Pendiente', badge: 'warning' as IngBadge };
  });
}

/** Lista de archivos tocados (el runner guarda strings o { ruta }). */
export function listaArchivos(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a
    .map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' && 'ruta' in x ? String((x as { ruta: unknown }).ruta) : '')))
    .filter((s) => s.length > 0);
}

export const ING_CONFIG_LIMITES: Record<string, { min: number; max: number; entero: boolean }> = {
  max_prod_por_dia: { min: 0, max: 50, entero: true },
  max_archivos: { min: 1, max: 50, entero: true },
  max_lineas: { min: 1, max: 2000, entero: true },
  presupuesto_ia_dia_usd: { min: 0, max: 500, entero: false },
  max_intentos: { min: 1, max: 5, entero: true },
  max_pr_barrido: { min: 0, max: 5, entero: true },
};

/** Espejo del chequeo de sgc.ing_config_guardar. Devuelve el número válido o null. */
export function validarConfigNumero(clave: string, valor: unknown): number | null {
  const lim = ING_CONFIG_LIMITES[clave];
  if (!lim) return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).trim().replace(',', '.'));
  if (!Number.isFinite(n) || String(valor).trim() === '') return null;
  if (n < lim.min || n > lim.max) return null;
  if (lim.entero && !Number.isInteger(n)) return null;
  return n;
}

export interface IngConfigUI {
  agentes_auto_prod: boolean;
  agentes_pausa_total: boolean;
  max_prod_por_dia: number;
  max_archivos: number;
  max_lineas: number;
  presupuesto_ia_dia_usd: number;
  max_intentos: number;
  max_pr_barrido: number;
}

export const ING_CONFIG_DEFECTO: IngConfigUI = {
  agentes_auto_prod: true, agentes_pausa_total: false, max_prod_por_dia: 3, max_archivos: 8,
  max_lineas: 300, presupuesto_ia_dia_usd: 10, max_intentos: 3, max_pr_barrido: 2,
};

/** Filas de agente_ingeniero_config -> objeto tipado con defaults. */
export function configDesdeFilas(filas: { clave: string; valor: unknown }[] | null | undefined): IngConfigUI {
  const out: IngConfigUI = { ...ING_CONFIG_DEFECTO };
  for (const f of filas ?? []) {
    if (!(f.clave in out)) continue;
    const k = f.clave as keyof IngConfigUI;
    if (typeof out[k] === 'boolean' && typeof f.valor === 'boolean') (out[k] as boolean) = f.valor;
    else if (typeof out[k] === 'number' && typeof f.valor === 'number') (out[k] as number) = f.valor;
  }
  return out;
}

export function porcentajePresupuesto(costo: number, tope: number): number {
  if (!(tope > 0)) return 0;
  return Math.min(100, Math.round((costo / tope) * 100));
}

export const ING_ORIGEN_LABEL: Record<string, string> = {
  reporte_usuario: 'Reporte de usuario',
  crash_app: 'Crash de la app',
  error_web: 'Error web',
  barrido: 'Barrido de código',
};
