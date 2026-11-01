// odoo-api/acciones-escritura.ts — CY24 Fase C: allowlist cerrada de acciones
// de ESCRITURA hacia Odoo. Separada de acciones.ts (que es solo lectura) a
// propósito: esta allowlist exige el módulo `compras` (no `inventario`),
// nunca usa caché, y cada acción es idempotente vía sgc.odoo_comandos_oc
// (D3). El edge SIEMPRE relee todo de la BD con service role antes de llamar
// a Odoo (D5): el cliente solo manda `orden_id`, nunca precio/proveedor/líneas.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ParamError } from "./acciones.ts";
import {
  type AdaptadorOc, type AdaptadoresOc, cancelarOcMock, confirmarOcMock, publicarOcMock, refrescarOcMock,
  type ResultadoPublicacionOc,
} from "../_shared/odoo-oc.ts";
import { OdooError } from "../_shared/odoo-client.ts";

export const ACCIONES_ESCRITURA = ["compras.crear", "compras.confirmar", "compras.cancelar", "compras.refrescar"] as const;
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

/** Estado de sincronización de SGC según el `state` de la OC en Odoo (null = estado desconocido). */
export function estadoSyncDesdeOdoo(state: unknown): string | null {
  switch (state) {
    case "draft": case "sent": return "publicada";
    case "to approve": return "por_aprobar"; // confirmada, pendiente de aprobación en Odoo (SGC no aprueba)
    case "purchase": case "done": return "confirmada";
    case "cancel": return "cancelada";
    default: return null;
  }
}

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
 * comando, llama al adaptador (mock hoy, D-08) y cierra el comando +
 * registra el resultado en la OC. Revision fija en 1 -- v1 no soporta
 * reintentar una MISMA acción con datos distintos (eso sería una revisión
 * nueva, fuera de alcance de esta fase).
 */
async function ejecutarComando(
  { admin, usuarioId }: CtxEscritura,
  accion: AccionEscritura extends `compras.${infer A}` ? A : never,
  orden_id: string,
  paraComando: (admin: SupabaseClient, orden_id: string) => Promise<RpcResult>,
  publicar: (p: Record<string, unknown>) => Promise<ResultadoPublicacionOc>,
  estadoSyncPorDefecto: string,
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
      await admin.rpc("registrar_publicacion_oc", { p_orden_id: orden_id, p_odoo_sync_estado: "error", p_odoo_sync_error: detalle });
    }
    throw e;
  }

  const { error: errFin } = await admin.rpc("oc_comando_finalizar", {
    p_comando_id: ini.comando_id, p_estado: r.estado, p_resultado: r.resultado ?? null, p_error: r.error ?? null,
  });
  if (errFin) console.error("[odoo-api] oc_comando_finalizar:", errFin);

  await admin.rpc("registrar_publicacion_oc", r.estado === "completado"
    ? {
      p_orden_id: orden_id, p_odoo_sync_estado: estadoSyncDesdeOdoo(r.resultado?.estado_odoo) ?? estadoSyncPorDefecto,
      p_odoo_state: (r.resultado?.estado_odoo as string) ?? null, p_odoo_nombre: (r.resultado?.nombre as string) ?? null,
      p_odoo_total: typeof r.resultado?.total === "number" ? r.resultado.total : null, // informativo: lo arma Odoo
      // La identidad (instancia+odoo_id) solo importa al CREAR -- registrar_publicacion_oc
      // la fija una sola vez; en confirmar/cancelar ya existe y coalesce la deja intacta.
      p_odoo_instancia_id: accion === "crear" ? instanciaId : null,
      p_odoo_id: accion === "crear" ? (r.resultado?.odoo_id as number) ?? null : null,
    }
    : { p_orden_id: orden_id, p_odoo_sync_estado: "error", p_odoo_sync_error: r.error ?? "No se pudo completar la acción en Odoo." });

  if (r.estado !== "completado") throw new ParamError(r.error ?? "No se pudo completar la acción en Odoo.");
  return { ...r.resultado, repetido: false };
}

const comprasCrear: DefEscritura<{ orden_id: string }> = {
  normalizar: normalizarOrdenId,
  ejecutar: (ctx, { orden_id }) =>
    ejecutarComando(ctx, "crear", orden_id, (a, id) => a.rpc("oc_para_publicar", { p_orden_id: id }), ctx.adaptador?.crear ?? publicarOcMock, "publicada"),
};

const comprasConfirmar: DefEscritura<{ orden_id: string }> = {
  normalizar: normalizarOrdenId,
  ejecutar: (ctx, { orden_id }) =>
    ejecutarComando(ctx, "confirmar", orden_id, (a, id) => a.rpc("oc_para_comando", { p_orden_id: id, p_accion: "confirmar" }), ctx.adaptador?.confirmar ?? confirmarOcMock, "confirmada"),
};

const comprasCancelar: DefEscritura<{ orden_id: string }> = {
  normalizar: normalizarOrdenId,
  ejecutar: (ctx, { orden_id }) =>
    ejecutarComando(ctx, "cancelar", orden_id, (a, id) => a.rpc("oc_para_comando", { p_orden_id: id, p_accion: "cancelar" }), ctx.adaptador?.cancelar ?? cancelarOcMock, "cancelada"),
};

/**
 * Refresco (botón "Actualizar"): lee la OC en Odoo y registra el estado visto. Sin registro de
 * comando (es lectura; repetirlo es inocuo). Resuelve `por_aprobar` cuando Odoo aprueba.
 */
const comprasRefrescar: DefEscritura<{ orden_id: string }> = {
  normalizar: normalizarOrdenId,
  async ejecutar({ admin, adaptador }, { orden_id }) {
    const { data: fila, error: errFila } = await admin.from("ordenes_compra")
      .select("odoo_id, odoo_sync_estado").eq("id", orden_id).maybeSingle();
    if (errFila) throw new ParamError(errFila.message);
    if (!fila) throw new ParamError("Orden de compra no encontrada.");
    if (!fila.odoo_id) throw new ParamError("Esta orden todavía no se ha publicado en Odoo.");

    const r = await (adaptador?.refrescar ?? refrescarOcMock)({ orden_id, odoo_id: fila.odoo_id, odoo_sync_estado_actual: fila.odoo_sync_estado });
    if (r.estado !== "completado") throw new ParamError(r.error ?? "No se pudo leer la orden en Odoo.");

    const sync = estadoSyncDesdeOdoo(r.resultado?.estado_odoo);
    if (sync) {
      const { error: errReg } = await admin.rpc("registrar_publicacion_oc", {
        p_orden_id: orden_id, p_odoo_sync_estado: sync,
        p_odoo_state: (r.resultado?.estado_odoo as string) ?? null, p_odoo_nombre: (r.resultado?.nombre as string) ?? null,
        p_odoo_total: typeof r.resultado?.total === "number" ? r.resultado.total : null,
      });
      if (errReg) throw new ParamError(errReg.message);
    }
    return { ...r.resultado, repetido: false };
  },
};

export const DEFINICIONES_ESCRITURA: { [A in AccionEscritura]: DefEscritura<never> } = {
  "compras.crear": comprasCrear,
  "compras.confirmar": comprasConfirmar,
  "compras.cancelar": comprasCancelar,
  "compras.refrescar": comprasRefrescar,
} as unknown as { [A in AccionEscritura]: DefEscritura<never> };
