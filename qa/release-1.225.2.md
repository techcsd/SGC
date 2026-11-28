# Release 1.225.2 (hotfix Odoo 19: conduces vuelven a publicarse en Odoo; Unidades; errores de edge legibles)
- Equipo/tester: Claude Code (sesión asistida, ronda EB, PROMPT-158 F1)
- Qué cambia: `move_ids_without_package` → `move_ids`; `stock.move` sin `name`; `uom.uom` sin `category_id`/`uom_type`; producto sin `uom_po_id`; PO `note` y línea `product_uom_id`; handler común `edge-seguro` en odoo-api/odoo-sync/odoo-conciliar; Unidades sin categoría.
- Qué se probó: `fields_get` contra el Odoo real (solo lectura) de todos los campos que SGC escribe (test de contrato `ODOO_CONTRACT_TEST=1`, pasa); deno test `_shared/odoo-*` (simulador ahora estricto con campos de Odoo 19); ng test 480 OK; build OK; verify-i18n 0 fallos; edges desplegadas a dev.
- NO probado por Claude: creación real de un picking en Odoo (staging no disponible y no se escribe en el Odoo real sin OK); la pantalla Unidades y un conduce real en dev con el navegador.
- Versión de origen: 1.225.1
- Resultado: OK con reservas (hotfix; falta el reintento de la cola atascada, F2.5, con OK nombrado)
- Fecha: 2026-11-28
**OK de Xaviel** 2026-11-28: «desde main, hotfix, sigue con F1» (rama y hotfix; el despliegue a prod sigue pendiente de su OK nombrado).
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-28
