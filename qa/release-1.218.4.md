# Release 1.218.4 — Odoo: pendientes y reabastecimiento (17-nov-2026)
- Equipo/tester: Claude Code, con navegador visible sobre prod (cuenta QA admin) y pruebas reales contra el Odoo de producción; NO es una prueba humana independiente.
- Qué se probó: conteo físico (+1 y deshacer) y retiro de material con reparación y con descarte (desecho real, repuesto con un conteo) en prod con neto cero verificado en el quant del Odoo real; sondeo de pendientes y reglas de reabastecimiento en dev y prod; build, tests Deno (pendientes, reabastecimiento) y unit.
- Versión de origen: 1.218.3
- Resultado: desplegado en prod; la sección «Pendientes en Odoo» se verificó en navegador visible con la cuenta QA admin (tarjetas por almacén y atrasados, 41 pendientes).
- Fecha: 2026-11-17
- Autorización: Xaviel pidió (17-nov-2026) las pruebas de Ajustes/Desechar, el cruce de pendientes y el reabastecimiento, y cerrar todos los issues; si se publica por --hotfix, lo autoriza él por nombre.
