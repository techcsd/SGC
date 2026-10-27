# Release 1.203.0

- Equipo/tester: Claude Code (sesión autónoma, ronda CZ) — **sin** clic-por-clic de Xaviel
  en el navegador todavía (ver nota honesta abajo).
- Qué se probó (automatizado, contra dev real `sgc-dev`/`dev.sgcconstructorasd.com`):
  1. **Cotizaciones de Tecnología**: smoke transaccional (ROLLBACK) — crear/actualizar/
     descartar/restaurar, vincular/desvincular compra y equipo (el vínculo a una compra
     marca la cotización "usada"), `cotizacion_de_equipo` resuelve correctamente directa
     vs. heredada de la compra, `compra_tec_adjuntar_cotizacion` sigue registrando también
     en la biblioteca, y un usuario sin módulo/permiso queda negado.
  2. **Rol Subadministrador**: smoke transaccional — `es_subadmin()`/`is_admin()` correctos,
     el permiso granular abre Inventario TI/Compras tecnológicas/Cotizaciones SIN el
     módulo `tecnologia` completo (confirmado que NO abre Odoo-sync/monitoreo/APIs), y un
     usuario ajeno sigue sin acceso.
  3. **Vault**: 4 capas de prueba —
     - smoke transaccional de permisos negativos (ni admin puede `SELECT` las columnas
       cifradas ni `INSERT` directo; Subadministrador sin Vault; `boveda_accesos` rechaza
       `UPDATE`/`DELETE`);
     - 9 tests Deno sin red de las primitivas de cifrado/TOTP (incluye el vector OFICIAL
       de RFC 6238 Appendix B, byte a byte);
     - smoke HTTP contra la edge `boveda` YA DESPLEGADA en dev probando rutas de FALLO
       (sin auth, sin rol admin, sin sesión de Vault, contraseña incorrecta — con sesión
       minteada, nunca tocando una contraseña real);
     - **smoke end-to-end COMPLETO** con un usuario admin desechable (contraseña propia
       del script): abrir sesión con contraseña real → crear/revelar/editar/eliminar una
       cuenta, un 2FA y una nota → el código 2FA calculado por el servidor verificado
       contra un cálculo RFC 6238 **independiente** (no reusa el código de la edge) →
       auditoría exacta de las 10 acciones. Este último encontró y permitió corregir un
       bug real (eliminar una entrada daba 500 siempre, por una FK que chocaba con el
       trigger append-only).
  4. **Dev notes**: 5 tests unitarios nuevos de `zonaDestinoDeFila()` (encabezado/tarjeta/
     zona vacía resuelven el mismo destino; seudogrupos sin destino).
  5. `npm run build`, 127/127 Vitest, 74/74 Deno, todos los guards de `prebuild` (incluido
     el nuevo `verify-boveda-fuera-de-ia.mjs`) — verdes.
  6. Migraciones + la edge `boveda` + el secret `BOVEDA_MASTER_KEY` (propio, distinto al
     de dev) ya promovidos a **prod**, verificados ahí por objeto (solo `SELECT`, regla 19):
     las 4 tablas `boveda_*`, `tec_cotizaciones`+M:N, el rol `subadmin` con sus módulos/
     permisos exactos, las funciones clave, el trigger append-only, y que las columnas
     cifradas siguen sin `SELECT` para `authenticated` — todo presente y correcto.
- Versión de origen: 1.202.1
- Resultado: OK — automatizado de punta a punta; falta el repaso visual en el navegador.
- Fecha: 2026-10-27

**Nota honesta (no se esconde):** esto NO incluye que Xaviel haya entrado físicamente a
`dev.sgcconstructorasd.com` y probado los 3 flujos con sus propios clics — lo que se
promovió a prod se apoya en pruebas automatizadas reales (transaccionales + HTTP en vivo
contra la edge desplegada + un vector criptográfico oficial), no en un browser real.

**OK de Xaviel**: confirmó explícitamente en el chat, tras ver el resumen completo de las pruebas de arriba — "yes, prod" y, antes, "tienes mi ok, continua trabajando" — 2026-10-27.

Queda como tarea física suya (ya comunicada aparte, ésta sí pendiente): probar en el navegador después de este release, crear un usuario Subadministrador de prueba, y mover la llave maestra de prod a su custodia real (ya hizo esto mismo con la de dev).
