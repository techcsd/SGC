# Release 1.222.2 (QR en la ficha del conduce externo)
- Equipo/tester: Claude Code (sesión asistida) con usuario QA de dev.
- Qué cambia: tipo de QR `conduce_externo` (tabla `conduces_externos`, ruta `/inventario/conduces-externos/:id`); la ficha muestra el QR (sale al imprimir). Parámetro `doc_qr_conduce_externo_activo` (encendido). Edge `conduce-qr` ampliada.
- Qué se probó: prebuild, build; test Deno del token/ruta; en dev emitir con usuario con acceso→token, resolver→ruta de la ficha, token alterado→400.
- NO probado: la ficha en navegador ni la impresión con QR, escaneo con cámara.
- Versión de origen: 1.222.1
- Resultado: OK
- Fecha: 2026-11-23
**OK de Xaviel** 2026-11-23: «si, hazlo. --yes» (QR restantes y paso a prod)
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-23
