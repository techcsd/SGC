# Release 1.192.1

- Equipo/tester: Claude Code (sesión autónoma) + Xaviel
- Qué se probó: Xaviel probó 1.192.0 en producción y reportó que no encontraba el botón de
  descargar/subir la plantilla en Conductores ni en Vehículos. Causa: el botón "Plantilla SGC
  (sin Odoo)" vivía dentro de un `<details>` colapsado titulado "Cómo exportar desde Odoo",
  y el botón de entrada de Vehículos decía "Importar desde Odoo" — toda la UI leía como un
  flujo exclusivo de Odoo aunque el caso de uso real (plantilla llenada a mano) no lo es.
  Fix: la descarga de plantilla ahora es la acción principal y siempre visible al entrar al
  paso 2 del asistente; la ayuda de Odoo solo aparece si la entidad tiene perfil Odoo
  (vehículos/proveedores/artículos — nunca choferes) y quedó separada, con su propio título.
  Botón de Vehículos renombrado de "Importar desde Odoo" a "Importar". `npm run build` verde
  (incluye todos los guards del prebuild).
- Versión de origen: 1.192.0
- Resultado: OK
- Fecha: 2026-10-16

**OK de Xaviel**: reportó el problema y pidió el fix en la misma sesión (2026-10-16); autorización
implícita a seguir el mismo flujo de release ya acordado para 1.192.0.
