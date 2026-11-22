# Release 1.219.0 (conduces y conteos directo con Odoo, #202)
- Equipo/tester: Claude Code (sesión asistida); sin prueba humana en navegador y SIN prueba en vivo contra Odoo (el Odoo de staging devolvía HTTP 502 durante toda la sesión)
- Qué se probó: tests Deno de la edge (odoo-stock-directo, acciones-conduces) y build verdes; migración `2026-11-21-odoo-conduces-stock-directo.sql` aplicada en dev (ledger) y luego en prod; edge `odoo-api` desplegada en dev (v44) y prod (v21); en dev: las 11 funciones existen sin sobrecargas duplicadas y `adjust_stock` en un almacén sin fuente Odoo se comporta igual que antes (smoke revertido).
- NO probado: emitir un conduce con stock suficiente en Odoo; rechazo por falta de stock; bloqueo con Odoo caído; conteo de app / ajuste real en un almacén con fuente Odoo (dev no tiene ninguno). Estas pruebas del plan de `docs/ODOO-CONDUCES-DIRECTO.md` quedan para hacerse en prod con vigilancia.
- Versión de origen: 1.218.7
- OK: Xaviel autorizó en el chat promover el #202 a main/prod sin prueba en vivo 2026-11-22
- Resultado: OK (autorizado por Xaviel) · pendiente prueba humana
- [x] Funciones y edge desplegadas y verificadas en dev y prod (existencia, sin sobrecargas)
- [x] Smoke revertido de adjust_stock (ruta sin Odoo) en dev
- [ ] Conduce con stock en Odoo, sin stock y con Odoo caído (no probado)
Probado por: Claude Code (sesión asistida, sin prueba humana) · 2026-11-22
- Fecha: 2026-11-22
