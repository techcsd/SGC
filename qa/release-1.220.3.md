# Release 1.220.3 (contador de conduces degradados en Tecnología › Sincronización con Odoo)
- Equipo/tester: Claude Code (sesión asistida).
- Qué cambia: aviso en Tecnología › Sincronización con Odoo con los conduces emitidos en modo degradado (tabla `odoo_conduces_degradados`, RLS solo Tecnología): cuántos en 24 h y 7 días y los últimos 10. Sin migración nueva; solo lectura.
- Qué se probó: `npm run build` y `npm test` pasan.
- NO probado todavía: la pantalla en dev con datos reales (aún no hay conduces degradados registrados); responsive en móvil.
- Versión de origen: 1.220.2
- Resultado: pendiente prueba en dev
- Fecha: 2026-11-22
- [x] Build y tests
- [ ] Pantalla en dev con una fila degradada de prueba
