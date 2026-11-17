// _shared/odoo-adjuntos.ts -- DS-28 (ADR 19): PDF firmado del conduce como adjunto del picking de Odoo (`ir.attachment`).
// Idempotente por nombre: si el picking ya tiene un adjunto con ese nombre no se crea otro. APAGADO: solo lo llama el worker
// cuando la fase `expansion` esta encendida. La escritura pasa por la politica del cliente (host de escritura incluido).
import type { LlamadorOdoo } from "./odoo-traslados.ts";

export interface AdjuntoPdf { nombre: string; base64: string }

/** `CND-XXXXXXXX-B.pdf`: un nombre estable por conduce y paso para poder detectar el duplicado. */
export const nombreAdjuntoConduce = (folio: string, paso: "A" | "B"): string => `${folio}-${paso}.pdf`;

/** Crea el adjunto en el picking si aun no existe. Devuelve el id (existente o nuevo). */
export async function adjuntarPdfAPicking(c: LlamadorOdoo, pickingId: number, a: AdjuntoPdf): Promise<{ id: number; creado: boolean }> {
  if (!a.base64 || a.base64.length < 8) throw new Error("El PDF del conduce está vacío.");
  if (!/^[\w .\-]+\.pdf$/i.test(a.nombre)) throw new Error("Nombre de adjunto inválido.");
  const previos = await c.call("ir.attachment", "search_read", [[["res_model", "=", "stock.picking"], ["res_id", "=", pickingId], ["name", "=", a.nombre]]], { fields: ["id"], limit: 1 });
  if (Array.isArray(previos) && previos.length) return { id: previos[0].id, creado: false };
  const id = await c.call("ir.attachment", "create", [{ name: a.nombre, datas: a.base64, res_model: "stock.picking", res_id: pickingId, mimetype: "application/pdf", type: "binary" }]);
  return { id: Array.isArray(id) ? id[0] : id, creado: true };
}
