# Release 1.220.3 (contador de conduces degradados en Tecnología › Sincronización con Odoo)
- Equipo/tester: Claude Code (sesión asistida), navegador Chromium con el usuario QA de Tecnología de dev.
- Qué cambia: aviso en Tecnología › Sincronización con Odoo con los conduces emitidos en modo degradado (tabla `odoo_conduces_degradados`, RLS solo Tecnología): cuántos en 24 h y 7 días y los últimos 10. Sin migración; solo lectura.
- Qué se probó: build y 374 tests; en dev se insertaron 2 filas degradadas de prueba (ya borradas), el aviso mostró «2 en 24 h (2 en 7 días)» con los dos folios, hora y horas sin sondeo, en escritorio (1280) y móvil (390) y en kreyòl (idioma del usuario QA). Se probó con la misma versión corriendo local contra la base de dev porque el dominio de dev exige SSO de Vercel.
- NO probado: el despliegue de dev.sgcconstructorasd.com ni producción con conduces degradados reales (en prod no hay ninguno todavía: el aviso no se muestra sin filas).
- Versión de origen: 1.220.2
- Resultado: OK
- Fecha: 2026-11-22
**OK de Xaviel** 2026-11-22: «si, pruébalo en dev y envíalo a prod»
- [x] Build y tests
- [x] Pantalla con filas de prueba en dev, escritorio y móvil
Probado por: Claude Code (sesión asistida) · 2026-11-22
