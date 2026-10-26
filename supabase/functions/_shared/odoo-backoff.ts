// _shared/odoo-backoff.ts — CY23: reintento con backoff exponencial + jitter,
// SOLO para lecturas idempotentes (todo lo que hoy expone odoo-api). Nunca
// reintentar una escritura a ciegas (regla de la casa) — este helper ni
// siquiera sabe hacer una escritura, es responsabilidad del llamador no
// envolver una con esto.
import { OdooError } from "./odoo-client.ts";

// Solo se reintentan fallas de infraestructura transitorias. odoo_auth/
// odoo_config/odoo_error (de negocio) NO se reintentan — reintentar no los
// arregla y solo demora el error real.
const CODIGOS_REINTENTABLES = new Set(["odoo_timeout", "odoo_no_disponible"]);

export interface OpcionesBackoff {
  intentos?: number; // total de intentos, incluido el primero
  baseMs?: number;
  azar?: () => number; // inyectable para tests determinísticos
  dormir?: (ms: number) => Promise<void>;
}

export async function conReintentoLectura<T>(fn: () => Promise<T>, opts: OpcionesBackoff = {}): Promise<T> {
  const intentos = Math.max(1, opts.intentos ?? 3);
  const baseMs = opts.baseMs ?? 200;
  const azar = opts.azar ?? Math.random;
  const dormir = opts.dormir ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let ultimoError: unknown;
  for (let intento = 0; intento < intentos; intento++) {
    try {
      return await fn();
    } catch (e) {
      ultimoError = e;
      const reintentable = e instanceof OdooError && CODIGOS_REINTENTABLES.has(e.codigo);
      if (!reintentable || intento === intentos - 1) throw e;
      const expo = baseMs * 2 ** intento;
      const jitter = azar() * expo * 0.5;
      await dormir(expo + jitter);
    }
  }
  throw ultimoError;
}
