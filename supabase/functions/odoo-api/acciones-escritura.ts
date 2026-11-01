// odoo-api/acciones-escritura.ts — CY24 Fase C: allowlist cerrada de acciones
// de ESCRITURA hacia Odoo. Separada de acciones.ts (que es solo lectura) a
// propósito: esta allowlist exige el módulo `compras` (no `inventario`),
// nunca usa caché, y cada acción es idempotente vía sgc.odoo_comandos_oc
// (D3). El edge SIEMPRE relee todo de la BD con service role antes de llamar
// a Odoo (D5): el cliente solo manda `orden_id`, nunca precio/proveedor/líneas.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ParamError } from "./acciones.ts";
import {
  type AdaptadorOc, type AdaptadoresOc, cancelarOcMock, confirmarOcMock, publicarOcMock,
  type ResultadoPublicacionOc,
} from "../_shared/odoo-oc.ts";
import { OdooError } from "../_shared/odoo-client.ts";

export const ACCIONES_ESCRITURA = ["compras.crear", "compras.confirmar", "compras.cancelar"] as const;
export type AccionEscritura = typeof ACCIONES_ESCRITURA[number];

/** Adaptador hacia Odoo por acción: mock o real, elegido en index.ts (seleccionarAdaptadoresOc). */
export type { AdaptadorOc, AdaptadoresOc };

export interface CtxEscritura {
  admin: SupabaseClient;
  usuarioId: string;
  /** Inyectable para tests / para el swap por el adaptador real. */
  adaptador?: Partial<AdaptadoresOc>;
}

/** Fallas de transporte: el usuario puede reintentar la misma acción (es idempotente). */
export const CODIGOS_REINTENTABLES = new Set(["odoo_timeout", "odoo_no_disponible"]);
export const MENSAJE_REINTENTAR = "Odoo no respondió; puedes reintentar.";

interface DefEscritura<P> {
  normalizar(p: Record<string, unknown>): P;
  ejecutar(ctx: CtxEscritura, p: P): Promise<unknown>;
}

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizarOrdenId = (p: Record<string, unknown>): { orden_id: string } => {
  if (typeof p.orden_id !== "string" || !RX_UUID.test(p.orden_id)) {
    throw new ParamError("orden_id es obligatorio y debe ser un UUID válido.");
  }
  return { orden_id: p.orden_id };
};

type RpcResult = { data: unknown; error: { message: string } | null };

/**
 * Flujo compartido por crear/confirmar/cancelar (D3 idempotencia + D5 "el
 * edge relee todo"): valida con la RPC `paraComando` correspondiente, abre un
 * comando, llama al adaptador (mock hoy, D-08) y cierra el comando. SGC NO
 * espeja el estado de la OC en Odoo (ni errores): solo guarda el vínculo
 * (instancia + odoo_id) al crear; el estado se lee de Odoo en vivo y los
 * errores se devuelven al usuario. Revision fija en 1 -- v1 no soporta
 * reintentar una MISMA acción con datos distintos (eso sería una revisión
 * nueva, fuera de alcance de esta fase).
 */
async function ejecutarComando(
  { admin, usuarioId }: CtxEscritura,
  accion: AccionEscritura extends `compras.${infer A}` ? A : never,
  orden_id: string,
  paraComando: (admin: SupabaseClient, orden_id: string) => Promise<RpcResult>,
  publicar: (p: Record<string, unknown>) => Promise<ResultadoPublicacionOc>,
): Promise<unknown> {
  const { data: p0, error: errValidar } = await paraComando(admin, orden_id);
  if (errValidar) throw new ParamError(errValidar.message);
  const p = p0 as Record<string, unknown>;
  const instanciaId = p.odoo_instancia_id as string;
  const revision = 1;

  const { data: inicio, error: errInicio } = await admin.rpc("oc_comando_registrar_inicio", {
    p_odoo_instancia_id: instanciaId, p_orden_id: orden_id, p_accion: accion, p_revision: revision,
    p_creado_por: usuarioId,
  });
  if (errInicio) throw new ParamError(errInicio.message);
  const ini = inicio as { ya_completado: boolean; resultado?: Record<string, unknown>; comando_id: string };
  if (ini.ya_completado) return { ...ini.resultado, repetido: true };

  // Mock o real (D-08): el adaptador se elige en index.ts. NUNCA se reintenta aquí: si Odoo no
  // respondió, el comando queda en 'error' y el usuario reintenta la misma acción (idempotente).
  let r: ResultadoPublicacionOc;
  try {
    r = await publicar(p);
  } catch (e) {
    if (e instanceof OdooError) {
      const detalle = CODIGOS_REINTENTABLES.has(e.codigo) ? MENSAJE_REINTENTAR : "No se pudo completar la acción en Odoo.";
      const { error: errErr } = await admin.rpc("oc_comando_finalizar", {
        p_comando_id: ini.comando_id, p_estado: "error", p_resultado: null, p_error: detalle,
      });
      if (errErr) console.error("[odoo-api] oc_comando_finalizar(error):", errErr);
    }
    throw e;
  }

  // Solo al CREAR se guarda el vínculo (vincular_oc_odoo lo fija una única vez, también si ya_existia).
  // Va ANTES de cerrar el comando: si falla, el comando queda en 'error' y el reintento (idempotente) vuelve a vincular.
  // Confirmar/cancelar no escriben nada en la OC.
  let error = r.estado === "completado" ? null : (r.error ?? "No se pudo completar la acción en Odoo.");
  if (!error && accion === "crear") {
    const { error: errVin } = await admin.rpc("vincular_oc_odoo", {
      p_orden_id: orden_id, p_odoo_instancia_id: instanciaId, p_odoo_id: r.resultado?.odoo_id,
    });
    if (errVin) error = errVin.message;
  }

  const { error: errFin } = await admin.rpc("oc_comando_finalizar", {
    p_comando_id: ini.comando_id, p_estado: error ? "error" : "completado",
    p_resultado: error ? null : (r.resultado ?? null), p_error: error,
  });
  if (errFin) console.error("[odoo-api] oc_comando_finalizar:", errFin);

  // El error NO se guarda en la OC: se devuelve al usuario (el handler lo traduce).
  if (error) throw new ParamError(error);
  return { ...r.resultado, repetido: false };
}

const comprasCrear: DefEscritura<{ orden_id: string }> = {
  normalizar: normalizarOrdenId,
  ejecutar: (ctx, { orden_id }) =>
    ejecutarComando(ctx, "crear", orden_id, (a, id) => a.rpc("oc_para_publicar", { p_orden_id: id }), ctx.adaptador?.crear ?? publicarOcMock),
};

const comprasConfirmar: DefEscritura<{ orden_id: string }> = {
  normalizar: normalizarOrdenId,
  ejecutar: (ctx, { orden_id }) =>
    ejecutarComando(ctx, "confirmar", orden_id, (a, id) => a.rpc("oc_para_comando", { p_orden_id: id, p_accion: "confirmar" }), ctx.adaptador?.confirmar ?? confirmarOcMock),
};

const comprasCancelar: DefEscritura<{ orden_id: string }> = {
  normalizar: normalizarOrdenId,
  ejecutar: (ctx, { orden_id }) =>
    ejecutarComando(ctx, "cancelar", orden_id, (a, id) => a.rpc("oc_para_comando", { p_orden_id: id, p_accion: "cancelar" }), ctx.adaptador?.cancelar ?? cancelarOcMock),
};

export const DEFINICIONES_ESCRITURA: { [A in AccionEscritura]: DefEscritura<never> } = {
  "compras.crear": comprasCrear,
  "compras.confirmar": comprasConfirmar,
  "compras.cancelar": comprasCancelar,
} as unknown as { [A in AccionEscritura]: DefEscritura<never> };
