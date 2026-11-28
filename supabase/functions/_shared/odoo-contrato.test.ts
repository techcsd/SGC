// EB22 -- test de contrato OPCIONAL contra el Odoo real (solo lectura: fields_get). En CI normal se omite.
// Uso: ODOO_CONTRACT_TEST=1 ODOO_URL=... ODOO_DB=... ODOO_USER=... ODOO_API_KEY=... deno test -A odoo-contrato.test.ts
import { assert } from "jsr:@std/assert@1";
import { CAMPOS_ESCRITOS_19 } from "./odoo-contrato-19.ts";

const activo = Deno.env.get("ODOO_CONTRACT_TEST") === "1";

Deno.test({ name: "contrato Odoo 19: los campos que SGC escribe existen (fields_get)", ignore: !activo, async fn() {
  const url = Deno.env.get("ODOO_URL")!.replace(/\/$/, ""), db = Deno.env.get("ODOO_DB")!;
  const rpc = async (service: string, method: string, args: unknown[]) => {
    const r = await fetch(`${url}/jsonrpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: 1 }) });
    const j = await r.json(); if (j.error) throw new Error(j.error.data?.message ?? "rpc"); return j.result;
  };
  const uid = await rpc("common", "authenticate", [db, Deno.env.get("ODOO_USER"), Deno.env.get("ODOO_API_KEY"), {}]);
  const faltan: string[] = [];
  for (const [model, campos] of Object.entries(CAMPOS_ESCRITOS_19)) {
    const f = await rpc("object", "execute_kw", [db, uid, Deno.env.get("ODOO_API_KEY"), model, "fields_get", [], { attributes: ["type"] }]);
    for (const c of campos) if (!(c in f)) faltan.push(`${model}.${c}`);
  }
  assert(faltan.length === 0, `Campos que Odoo no tiene: ${faltan.join(", ")}`);
} });
