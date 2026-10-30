// odoo-api/acciones-escritura.ts — CY24 Fase C: allowlist cerrada de acciones
// de ESCRITURA hacia Odoo. Separada de acciones.ts (que es solo lectura) a
// propósito: esta allowlist exige el módulo `compras` (no `inventario`),
// nunca usa caché, y cada acción es idempotente vía sgc.odoo_comandos_oc
// (D3). El edge SIEMPRE relee todo de la BD con service role antes de llamar
// a Odoo (D5): el cliente solo manda `orden_id`, nunca precio/proveedor/líneas.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ParamError } from "./acciones.ts";
import { cancelarOcMock, confirmarOcMock, type ResultadoPublicacionOc, publicarOcMock } from "../_shared/odoo-oc.ts";
import { OdooError } from "../_shared/odoo-client.ts";

export const ACCIONES_ESCRITURA = ["compras.crear", "compras.confirmar", "compras.cancelar"] as const;
export type AccionEscritura = typeof ACCIONES_ESCRITURA[number];

/** Adaptador hacia Odoo por acción. Hoy mocks (D-08); el swap por el cliente real es solo aquí. */
export type AdaptadorOc = (paraComando: Record<string, unknown>) => Promise<ResultadoPublicacionOc>;
export interface AdaptadoresOc { crear: AdaptadorOc; confirmar: AdaptadorOc; cancelar: AdaptadorOc }

export interface CtxEscritura {
  admin: SupabaseClient;
  usuarioId: string;
  /** Inyectable para tests / para el swap por el adaptador real. */
  adaptador?: Partial<AdaptadoresOc>;
}

// Fallas de infraestructura: no se sabe si Odoo llegó a procesar el comando.
const CODIGOS_INCIERTOS = new Set(["odoo_timeout", "odoo_no_disponible"]);

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
  estadoSyncExito: string,
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

  // HOY: mock (D-08). Cuando exista base de pruebas confirmada u orden puntual de
  // Xaviel, este es el ÚNICO punto que cambia (swap del adaptador por uno real).
  let r: ResultadoPublicacionOc;
  try {
    r = await publicar(p);
  } catch (e) {
    // Timeout / Odoo caído: el resultado es INCIERTO (Odoo pudo haber creado la OC).
    // Se deja constancia en el comando y en la OC, y se relanza SIN reintentar (D3 / #23).
    if (e instanceof OdooError && CODIGOS_INCIERTOS.has(e.codigo)) {
      const detalle = "Sin respuesta de Odoo: no se sabe si la acción se aplicó. Requiere conciliación.";
      const { error: errInc } = await admin.rpc("oc_comando_finalizar", {
        p_comando_id: ini.comando_id, p_estado: "incierto", p_resultado: null, p_error: detalle,
      });
      if (errInc) console.error("[odoo-api] oc_comando_finalizar(incierto):", errInc);
      await admin.rpc("registrar_publicacion_oc", { p_orden_id: orden_id, p_odoo_sync_estado: "incierto", p_odoo_sync_error: detalle });
    }
    throw e;
  }

  const { error: errFin } = await admin.rpc("oc_comando_finalizar", {
    p_comando_id: ini.comando_id, p_estado: r.estado, p_resultado: r.resultado ?? null, p_error: r.error ?? null,
  });
  if (errFin) console.error("[odoo-api] oc_comando_finalizar:", errFin);

  await admin.rpc("registrar_publicacion_oc", r.estado === "completado"
    ? {
      p_orden_id: orden_id, p_odoo_sync_estado: estadoSyncExito,
      p_odoo_state: (r.resultado?.estado_odoo as string) ?? null, p_odoo_nombre: (r.resultado?.nombre as string) ?? null,
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

export const DEFINICIONES_ESCRITURA: { [A in AccionEscritura]: DefEscritura<never> } = {
  "compras.crear": comprasCrear,
  "compras.confirmar": comprasConfirmar,
  "compras.cancelar": comprasCancelar,
} as unknown as { [A in AccionEscritura]: DefEscritura<never> };
