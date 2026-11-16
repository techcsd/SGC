// _shared/odoo-evento.ts -- DS-16..DS-22: piezas comunes de los publicadores del circuito 2 (entradas, retiros, conduces externos, conteos).
// Cada publicador es una funcion pura sobre dependencias inyectadas (BD de SGC + Odoo) para probarla sin red ni BD.
import { OdooError } from "./odoo-client.ts";
import { MAX_INTENTOS, type ResultadoEvento } from "./odoo-salidas.ts";
import { TrasladoError } from "./odoo-traslados.ts";

export type { ResultadoEvento };
export type EstadoSync = "pendiente" | "sincronizado" | "incierto" | "error";
export interface MarcaSync { picking?: number; estado: EstadoSync; error?: string }
export type Marcar = (id: string, m: MarcaSync) => Promise<void>;

const espera = (intentos: number) => Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, intentos - 1));

/** Resultado de exito. `aviso` queda visible en el documento (AT11) sin ser un error. */
export async function exito(marcar: Marcar, id: string, picking: number | undefined, resultado: Record<string, unknown>, aviso?: string): Promise<ResultadoEvento> {
  await marcar(id, { picking, estado: "sincronizado", error: aviso });
  return { estado: "completado", resultado };
}

/** El documento no debe publicarse (todavia o nunca): no es un error, pero queda explicado para quien lo mire. */
export async function omitido(marcar: Marcar, id: string, motivo: string, texto: string, estado: EstadoSync | null = "pendiente"): Promise<ResultadoEvento> {
  if (estado) await marcar(id, { estado, error: texto });
  return { estado: "completado", resultado: { omitido: motivo } };
}

/**
 * Clasifica un fallo: transporte (OdooError sin fault) = incierto/reintento (todo es idempotente);
 * cualquier otro = error visible con mensaje por rol (BS2). Nunca se reintenta una escritura sin idempotencia.
 */
export async function clasificarFallo(e: unknown, id: string, intentos: number, marcar: Marcar, picking?: number): Promise<ResultadoEvento> {
  if (e instanceof OdooError) {
    if (intentos >= MAX_INTENTOS) {
      await marcar(id, { picking, estado: "incierto", error: "Odoo no respondió tras varios intentos." });
      return { estado: "incierto", error: e.message };
    }
    await marcar(id, { picking, estado: "pendiente", error: "Reintentando conexión con Odoo." });
    return { estado: "reintento", error: e.message, reintentarEnMs: espera(intentos) };
  }
  const msg = e instanceof TrasladoError ? e.message : "No se pudo sincronizar el documento con Odoo.";
  await marcar(id, { picking, estado: "error", error: msg });
  return { estado: "error", error: e instanceof TrasladoError && e.causa ? `${msg} [${e.codigo}: ${e.causa}]`.slice(0, 500) : msg };
}
