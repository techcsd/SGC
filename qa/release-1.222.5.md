# Release 1.222.5 (hotfix Odoo 19: el almacén muestra el stock real)
- Equipo/tester: Claude Code (sesión asistida) con credenciales de integración (solo lectura sobre Odoo) y usuario QA de dev.
- Qué cambia: el sondeo `odoo-conciliar` importa los productos de Odoo con stock que SGC no conoce (RPC `odoo_articulos_importar`, categoría «Revisión», origen `odoo`, sin apertura ni eventos al outbox) y luego proyecta el stock; parámetro `apertura_nuevos_articulos` = 0.
- Qué se probó: tests Deno (`odoo-catalogo`, `odoo-conciliacion`, 18 ok); en dev la RPC en transacción revertida (crea, vincula por nombre, idempotente, sin apertura ni eventos); en prod, tras el sondeo: 368 artículos importados, WH 35→266 artículos con stock, 0 eventos al outbox, sondeo sin error.
- NO probado: la pantalla del almacén y la creación de conduces/requisiciones en navegador/app (se valida con Raykler).
- Versión de origen: 1.222.4
- Resultado: OK
- Fecha: 2026-11-25
**OK de Xaviel** 2026-11-25: «apply all the stuff. i give u my OK. --yes» (SQL+edge en prod) y «i give u my ok, u can do the commit and the push. aproe the pr.»
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-25
