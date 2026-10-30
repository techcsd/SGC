// odoo-api/acciones-escritura.ts — CY24 Fase C: allowlist cerrada de acciones
// de ESCRITURA hacia Odoo. Separada de acciones.ts (que es solo lectura) a
// propósito: esta allowlist exige el módulo `compras` (no `inventario`),
// nunca usa caché, y cada acción es idempotente vía sgc.odoo_comandos_oc
// (D3). El edge SIEMPRE relee todo de la BD con service role antes de llamar
// a Odoo (D5): el cliente solo manda `orden_id`, nunca precio/proveedor/líneas.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ParamError } from "./acciones.ts";
import { publicarOcMock } from "../_shared/odoo-oc.ts";

export const ACCIONES_ESCRITURA = ["compras.crear"] as const;
export type AccionEscritura = typeof ACCIONES_ESCRITURA[number];

export interface CtxEscritura {
  admin: SupabaseClient;
  usuarioId: string;
}

interface DefEscritura<P> {
  normalizar(p: Record<string, unknown>): P;
  ejecutar(ctx: CtxEscritura, p: P): Promise<unknown>;
}

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const comprasCrear: DefEscritura<{ orden_id: string }> = {
  normalizar(p) {
    if (typeof p.orden_id !== "string" || !RX_UUID.test(p.orden_id)) {
      throw new ParamError("orden_id es obligatorio y debe ser un UUID válido.");
    }
    return { orden_id: p.orden_id };
  },
  async ejecutar({ admin, usuarioId }, { orden_id }) {
    // D5 -- releer todo con service role; oc_para_publicar valida D-16/E9/E10/criterio 6.
    const { data: paraPublicar, error: errValidar } = await admin.rpc("oc_para_publicar", { p_orden_id: orden_id });
    if (errValidar) throw new ParamError(errValidar.message);
    const p = paraPublicar as Record<string, unknown>;
    const instanciaId = p.odoo_instancia_id as string;
    const revision = 1; // CY24 Fase C v1 -- sin reediciones post-publicación todavía.

    // D3 -- abre el comando; si ya hay uno completado para la misma clave, devuelve
    // su resultado sin volver a tocar Odoo (idempotencia real de un reintento del cliente).
    const { data: inicio, error: errInicio } = await admin.rpc("oc_comando_registrar_inicio", {
      p_odoo_instancia_id: instanciaId, p_orden_id: orden_id, p_accion: "crear", p_revision: revision,
      p_creado_por: usuarioId,
    });
    if (errInicio) throw new ParamError(errInicio.message);
    const ini = inicio as { ya_completado: boolean; resultado?: Record<string, unknown>; comando_id: string };
    if (ini.ya_completado) return { ...ini.resultado, repetido: true };

    // HOY: mock (D-08). Cuando exista base de pruebas confirmada u orden puntual de
    // Xaviel, este es el ÚNICO bloque que cambia (swap por una llamada real a Odoo).
    const r = await publicarOcMock(p);

    const { error: errFin } = await admin.rpc("oc_comando_finalizar", {
      p_comando_id: ini.comando_id, p_estado: r.estado, p_resultado: r.resultado ?? null, p_error: r.error ?? null,
    });
    if (errFin) console.error("[odoo-api] oc_comando_finalizar:", errFin);

    await admin.rpc("registrar_publicacion_oc", r.estado === "completado"
      ? {
        p_orden_id: orden_id, p_odoo_sync_estado: "publicada",
        p_odoo_nombre: (r.resultado?.nombre as string) ?? null, p_odoo_state: (r.resultado?.estado_odoo as string) ?? null,
      }
      : { p_orden_id: orden_id, p_odoo_sync_estado: "error", p_odoo_sync_error: r.error ?? "No se pudo publicar en Odoo." });

    if (r.estado !== "completado") throw new ParamError(r.error ?? "No se pudo publicar la orden de compra en Odoo.");
    return { ...r.resultado, repetido: false };
  },
};

export const DEFINICIONES_ESCRITURA: { [A in AccionEscritura]: DefEscritura<never> } = {
  "compras.crear": comprasCrear,
} as unknown as { [A in AccionEscritura]: DefEscritura<never> };
