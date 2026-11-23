# Release 1.222.1 (QR de solicitud de compra en pantalla + pantalla «Escaneos de QR»)
- Equipo/tester: Claude Code (sesión asistida).
- Qué cambia: el drawer de «Crear orden» desde una solicitud de compra muestra su QR (interruptor ya encendido); nueva pantalla Administración › Escaneos de QR (solo admin; lee `doc_qr_escaneos`, RLS admin/tecnología). Sin migración.
- Qué se probó: prebuild completo, build, 399 tests web. Mecanismo del QR (emitir/resolver/permisos/alterado) ya probado en dev en 1.221.0 con tipo requisición; el tipo solicitud_compra tiene test Deno de token y ruta.
- NO probado: las dos pantallas en navegador (sin Playwright), escaneo real con cámara, la variante `ordenes-odoo` (no lleva el QR).
- Versión de origen: 1.222.0
- Resultado: OK
- Fecha: 2026-11-23
**OK de Xaviel** 2026-11-23: «si, dale» (arrancar los QR restantes); el paso a prod se confirma aparte.
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-23
