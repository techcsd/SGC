// 2026-11-18 -- Archiva en Odoo (active=false, reversible) los registros de prueba de la PoC: producto ZZ-PRUEBA-SGC-PoC-NO-USAR-2026-10-25 (template 1454)
// y proveedor ZZ-PRUEBA-SGC-Proveedor-Test-2026-10-27 (partner 5432). NO toca la OC P00919. Autorizado por Xaviel el 18-nov-2026. Desarchivar: active=true.
//   node scripts/data-fixes/2026-11-18-ds-archivar-pruebas-odoo.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
import { conectar } from '../lib/odoo-staging.mjs';
const env = await resolverEnv(process.argv.slice(2));
process.env.SGC_INTEGRATION_ODOO_URL = process.env[`ODOO_URL_${env.entorno.toUpperCase()}`];
process.env.SGC_INTEGRATION_ODOO_DB = process.env[`ODOO_DB_${env.entorno.toUpperCase()}`];
const { kw } = await conectar();
const ctx = { active_test: false };
const objetivos = [['product.template', 1454, 'ZZ-PRUEBA-SGC-PoC'], ['res.partner', 5432, 'ZZ-PRUEBA-SGC-Proveedor']];
for (const [modelo, id, prefijo] of objetivos) {
  const [r] = await kw(modelo, 'search_read', [[['id', '=', id]]], { fields: ['name', 'active'], context: ctx });
  if (!r) { console.log(`${modelo} ${id}: no existe`); continue; }
  if (!String(r.name).startsWith(prefijo)) { console.log(`${modelo} ${id}: nombre inesperado, se omite`); continue; }
  if (!r.active) { console.log(`${modelo} ${id}: ya archivado`); continue; }
  await kw(modelo, 'write', [[id], { active: false }]);
  const [v] = await kw(modelo, 'search_read', [[['id', '=', id]]], { fields: ['active'], context: ctx });
  console.log(`${modelo} ${id}: archivado=${v.active === false}`);
}
