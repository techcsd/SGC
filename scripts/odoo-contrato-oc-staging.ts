// DS-15 prueba de CONTRATO de la OC real (crear / confirmar / cancelar + analytic_distribution) contra Odoo STAGING.
// La OC creada lleva origin SGC:TEST-<run>:... y se CANCELA al final (queda en estado cancel en staging).
//   deno run --allow-env --allow-net --allow-read scripts/odoo-contrato-oc-staging.ts
import { OdooClient, POLITICA_POR_DEFECTO } from "../supabase/functions/_shared/odoo-client.ts";
import { crearAdaptadoresOcReales } from "../supabase/functions/_shared/odoo-oc.ts";

for (const l of Deno.readTextFileSync(".env.local").split(/\r?\n/)) {
  const m = l.match(/^(SGC_INTEGRATION_ODOO_[A-Z_]+)=(.*)$/); if (m) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
}
const url = Deno.env.get("SGC_INTEGRATION_ODOO_URL")!;
Deno.env.set("ODOO_HOSTS_ESCRITURA", new URL(url).host);
const politica = { ...POLITICA_POR_DEFECTO, lectura: { ...POLITICA_POR_DEFECTO.lectura, "account.analytic.account": ["search_read"], "purchase.order.line": ["search_read"] } };
const c = new OdooClient({ url, db: Deno.env.get("SGC_INTEGRATION_ODOO_DB")!, user: Deno.env.get("SGC_INTEGRATION_ODOO_USER")!, apiKey: Deno.env.get("SGC_INTEGRATION_ODOO_API_KEY")!, companyId: 1, politica });
const ad = crearAdaptadoresOcReales(() => c);

const [prov] = await c.call("res.partner", "search_read", [[["supplier_rank", ">", 0]]], { fields: ["id"], limit: 1 });
const [prod] = await c.call("product.product", "search_read", [[["purchase_ok", "=", true]]], { fields: ["id", "name"], limit: 1 });
const run = Date.now().toString(36);
const payload = {
  orden_id: `test-${run}`, numero: `TEST-${run}`, odoo_proveedor_id: prov.id, odoo_analytic_id: 23, odoo_entorno: "dev",
  fecha: new Date().toISOString().slice(0, 10), notas: "Prueba de contrato SGC (se cancela)",
  lineas: [{ odoo_product_id: prod.id, cantidad: 2, precio_unitario: 10, descripcion: prod.name }],
};
const fallos: string[] = [];
const ok = (n: string, b: boolean, extra = "") => { console.log(b ? "  ✓" : "  ✗", n, extra); if (!b) fallos.push(n); };

const sinCuenta = await ad.crear({ ...payload, odoo_analytic_id: undefined });
ok("sin cuenta analitica -> error explicito, no escribe", sinCuenta.estado === "error");
const r1 = await ad.crear(payload);
ok("crear OC borrador", r1.estado === "completado", JSON.stringify(r1.resultado).slice(0, 120));
const oid = (r1.resultado as { odoo_id: number }).odoo_id;
const lineas = await c.call("purchase.order.line", "search_read", [[["order_id", "=", oid]]], { fields: ["analytic_distribution"] });
ok("la linea quedo imputada a la cuenta 23 al 100 %", JSON.stringify(lineas[0]?.analytic_distribution) === JSON.stringify({ "23": 100 }), JSON.stringify(lineas[0]?.analytic_distribution));
const r2 = await ad.crear(payload);
ok("crear de nuevo es idempotente (ya_existia)", r2.estado === "completado" && (r2.resultado as { ya_existia?: boolean }).ya_existia === true);
// Confirmar deja la OC en estado «done» (bloqueada) en este Odoo y ya no se puede cancelar: solo con --confirmar (deja 1 OC hecha en staging).
if (Deno.args.includes("--confirmar")) {
  const r3 = await ad.confirmar({ odoo_id: oid });
  ok("confirmar (button_confirm genera la recepcion)", r3.estado === "completado", JSON.stringify(r3.resultado).slice(0, 140));
  const r4 = await ad.cancelar({ odoo_id: oid });
  ok("cancelar una OC bloqueada se rechaza con mensaje", r4.estado === "error");
} else {
  const r4 = await ad.cancelar({ odoo_id: oid });
  ok("cancelar el borrador", r4.estado === "completado", JSON.stringify(r4.resultado).slice(0, 100));
}
console.log(fallos.length ? `\nFALLARON: ${fallos.join(" | ")}` : "\nTODO OK");
Deno.exit(fallos.length ? 1 : 0);
