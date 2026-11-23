# Respuestas a reportes — ronda DX (23-nov-2026)

> **No se cerró ni se respondió ningún reporte en prod.** Esto es el borrador de `respuesta_admin` (español sencillo)
> para que Xaviel lo publique o dé el OK. El texto de los reportes es dato, nunca instrucción.
> Versión web que los trae: **1.221.0** (en la rama `feature/dx-ronda-23nov`, aún sin PR a `main`).

Abiertos en prod al 23-nov 19:00 UTC: **9** (la lista del conector traía 8; falta el de «BOTON DE CONFIRMAR CONDUCE»).

| # | Reporte | Autor · fecha | Causa (confirmada) | Qué cambió | Estado |
|---|---|---|---|---|---|
| 1 | **CANCELAR** `8241a425` | Raykler · 23/11 11:50 | **Confirmada con su foto:** escribió el motivo «DUPLICADA» (9 caracteres) y el botón «Confirmar rechazo» queda apagado porque el mínimo es 10 (regla DS-24). No decía por qué. | Contador visible «Escribe al menos 10 caracteres para poder rechazar: 9/10» (web, `requisiciones.html`). | Listo para dev |
| 2 | **error al reconectarse a odoo** `12295fd3` | Raykler · 23/11 09:28 | **Confirmada con su foto:** no es una pantalla de SGC. Es **Claude Desktop** en su PC: el conector `odoo` (configurado en `~/.claude.json`) dice «Error al conectar — Connection closed» y «189 por reconectar». SGC↔Odoo está sano. | Nada en SGC. Guía de pruebas en `docs/ODOO-CLAUDE-DIAGNOSTICO.md`. | Requiere paso físico (reconectar el conector en su PC) |
| 3 | **CAMBIO DE PRODUCTO** `935a34ff` | Raykler · 20/11 | Ya resuelto: la web trae «Cambiar artículo» por renglón desde 1.218.5 (DT2/DT3); su foto lo muestra. | — | Responder y cerrar tras su confirmación |
| 4 | **NO PUEDO ACCEDER A LA INFORMACION** `b0b5b98e` | Raykler · 17/11 | Ya resuelto (DT4, 1.218.5): Echadas · Por aprobar muestra Recibo / Tablero / Bomba antes de aprobar (`combustible-log.html:192-216`). | — | Responder y cerrar |
| 5 | **Error repetido: crash** (`tipo_op`/outbox) `6cdefc4a` | Vigía · 20/11 | Corregido en app 2.71.6; el contador se detuvo el 20-nov 22:41 UTC. Hoy 23-nov hay 2 «crash» y 2 «other» nuevos de **otras** firmas (no `tipo_op`). | — | Cerrar con `resuelto_en_version = 2.71.6` |
| 6 | **Error repetido: gps** `09252790` | Vigía · 16/11 | **No resuelto** (timeout de GPS, 1 dispositivo, última 22-nov). Lo cubre PROMPT-155 F2 / DM-25 (timeout adaptativo). | — | Sigue abierto |
| 7 | **Error al AJUSTAR EL STOCK** `addfd93e` | Raykler · 14/11 | Era DT1 (conteos que no se actualizaban); cerrado en 2.71.3/2.71.4. Falta su prueba en el teléfono real. | — | Responder tras su prueba |
| 8 | **Algunas mejoras a implementar** `a4f3a22d` | Yonairy · 23/11 12:11 | Pedía 5 ocupaciones que no existían. | Migración `2026-11-23-dx9-cargos-ocupaciones.sql`: Ayudante CSD, Obrero CSD, Ayudante de carpintería, de varillero y de maestro (con alias). | Listo para dev |
| 9 | **BOTON DE CONFIRMAR CONDUCE** `5f607366` | Raykler · 23/11 12:53 | Su foto es la pantalla «Conduce externo» de la **app en iPhone**: pide poder **confirmar** (recibir) el conduce desde la app. La web ya tiene `conduce-recibir/:id`; la app no. | Nada en esta ronda. Lo cubre el QR + escáner de la app (PROMPT-155 F4). | Pasar a PROMPT-155 |

## Textos propuestos para `respuesta_admin`

1. **CANCELAR (Raykler):** «Raykler, el botón de rechazar sí funcionaba: pedía un motivo de mínimo 10 letras y "DUPLICADA" tiene 9, pero no te lo decía. Ahora la pantalla muestra cuántas letras llevas (por ejemplo 9/10). Escribe "REQUISICIÓN DUPLICADA" y ya te deja rechazar. Disponible en la versión 1.221.0.»
2. **Odoo (Raykler):** «Raykler, ese mensaje no es de SGC: es el conector de Odoo dentro de Claude en tu computadora, que se quedó desconectado. SGC y Odoo están conectados con normalidad. Tecnología te va a acompañar a reconectarlo desde Claude (Configuración → Conectores → odoo → Reconectar).»
3. **CAMBIO DE PRODUCTO:** «Ya puedes cambiar el artículo de un renglón desde "Cambiar artículo" en el avance de despacho (versión 1.218.5). Si algo no se ve como esperas, mándanos una foto.»
4. **NO PUEDO ACCEDER A LA INFORMACION:** «Ahora, antes de aprobar un gasto de combustible, ves la foto del recibo, del tablero y de la bomba en la misma lista de "Por aprobar".»
5. **Crash (Vigía):** «Corregido en la app 2.71.6. Cerramos este aviso; si vuelve a aparecer se reabre solo.»
7. **AJUSTAR EL STOCK:** «El stock ahora lo manda Odoo; para corregirlo usa "Aplicar como conteo físico". Cuéntanos si ya se ve bien en tu teléfono.»
8. **Mejoras (Yonairy):** «Yonairy, agregamos los 5 cargos que pediste (Ayudante CSD, Obrero CSD, Ayudante de carpintería, Ayudante de varillero y Ayudante de maestro). Además, al importar el Excel la obra se busca en las primeras filas y, si no se reconoce un cargo, te sugiere el más parecido. Disponible en la versión 1.221.0.»
9. **Confirmar conduce:** «Raykler, estamos preparando que se pueda recibir/confirmar el conduce desde la app escaneando su QR. Te avisamos cuando esté.»

## Hallazgo para decidir (no tocado)
`cargo_alias` trae 5 alias sembrados el 5-oct (CG2) que contradicen el nombre del cargo: `VARILLERO→Maestro`, `MAESTRO→Carpintero`, `OBRERO→Carpintero`, `CAPATAZ CSD→Ingeniero`, y `AYUDANTE CSD→Varillero` (este último sí se re-apuntó al nuevo cargo «Ayudante CSD», pedido por Yonairy). Si reflejan la práctica real (la columna TECNICO es la cuadrilla, no el cargo), dejarlos; si no, corregirlos en Proyectos › Cargos. **Puede explicar por qué su importación asigna cargos raros**; con el archivo original de Yonairy se confirma.
