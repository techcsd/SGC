# Release 1.224.0 (Odoo directo: catálogo, SLO/alertas del sondeo y arreglos de Odoo 19)
- Equipo/tester: Claude Code (sesión asistida); Xaviel probó en dev.sgcconstructorasd.com antes de pedir prod.
- Qué cambia: PRs #229 (SLO 2 min y errores del outbox), #230 (autor del chatter por work_email), #232 (catálogo/unidades/categorías directo de Odoo; corregido para Odoo 19: orden por `name`, `is_storable`, `consu`), #233 (alerta de sondeo caído, SQL ya estaba en prod) y el hotfix de `tg_homologar_nombre` (SQL ya aplicado en prod).
- Qué se probó: 550 pruebas de las edges, 475 de la web y build en la rama integrada; SQL de #229/#232 aplicado en dev con ledger; en dev se guardó categoría/bodega/artículo en transacción descartada.
- NO probado por Claude: las pantallas nuevas en navegador y el flujo de «dar de alta producto» contra el Odoo real de prod.
- Versión de origen: 1.223.0
- Resultado: OK
- Fecha: 2026-11-26
**OK de Xaviel** 2026-11-26: «mandalo a prod, ya lo probe. soluciona todo» (release 1.224.0 a prod; antes: «apruébalos todos»).
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-26
