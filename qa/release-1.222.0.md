# Release 1.222.0 (Odoo en vivo para Compa/MCP, página /instalar, QR de solicitud de compra)
- Equipo/tester: Claude Code (sesión asistida) con usuarios QA de dev y llamadas reales a las edges de dev.
- Qué cambia: tres herramientas de solo lectura sobre Odoo (stock, OC, estado de sincronización) para Compa y el conector, con interruptor `odoo_herramientas_ia` APAGADO; página pública /instalar y atajos /privacidad, /soporte-app; tipo de QR `solicitud_compra` (apagado).
- Qué se probó: prebuild completo, build, 399 tests web, 502 Deno. En dev: Compa con interruptor apagado se niega y encendido devuelve el estado de sincronización (0 errores, 0 degradados); gate de permisos por módulo en tests; RPC de estado solo Tecnología/admin.
- NO probado: /instalar en navegador (sin Playwright), stock/OC contra el Odoo real (interruptor apagado en prod), QR de compra en pantalla (aún no colocado).
- Versión de origen: 1.221.0
- Resultado: OK
- Fecha: 2026-11-23
**OK de Xaviel** 2026-11-23: «si, apruebo todo. hazlo» (migraciones dx6/dx7b/dx12, edges assistant/mcp/conduce-qr y merge a main nombrados)
- [x] Build y tests
- [x] Compa en dev con interruptor apagado/encendido
Probado por: Claude Code (sesión asistida) · 2026-11-23
