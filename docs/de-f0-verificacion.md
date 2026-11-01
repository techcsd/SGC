# Ronda DE — F0: verificación con evidencia (30-oct-2026)

> Base de trabajo: `feature/de-ronda` desde `origin/dev` (98c0259b). Worktree propia `../SGC-de-ronda` (CQ6: el nombre `SGC-de` ya estaba tomado por `feature/de-fase-c-oc-odoo`, una ronda distinta del epic Odoo — no es la letra de ronda "DE", coincidencia de texto. No se tocó ese worktree).
> Numeración: el prompt es PROMPT-126 según CONTEXTO-ACTUALIZACION-62.md (carpeta `imp 30102026`); no hubo colisión con 125 en esa carpeta.

## DE2 — MARBETES.pdf (decide DE-06)

Abierto `C:\developer\improvements\octubre 2026\imp 29102026\MARBETES.pdf` (23 páginas, 11 marbetes SURA). Evidencia:
- **Los 11 reversos son idénticos**: instrucciones genéricas "En caso de accidente / En caso de robo" + teléfonos de Asistencia Vial SURA, Centro del Automovilista, Seguridad Vial + un QR de WhatsApp de la aseguradora (no vehículo-específico).
- **Ningún reverso trae placa, póliza, chasis ni VIN** del vehículo — ni impreso ni en el QR (el QR apunta a un número de WhatsApp genérico de SURA).
- El reverso va **siempre en la página inmediatamente siguiente** a su anverso: 1→2, 3→4, 5→6, 7→8, 9→10, 11→12, 13→14, 15→16, 17→18, 19→20, 21→22. Sin excepciones en el lote.

**Conclusión → DE-06 confirmado tal cual el default:** el reverso se empareja **por posición** (DE-05) y se guarda **solo como imagen** — no se extrae ningún campo nuevo de él, no se crea columna «teléfono de asistencia» (no hay nada vehículo-específico que leer en este lote; si en el futuro aparece un marbete de otra aseguradora con datos impresos en el reverso, el lector ya tendrá la regla para extraerlos, ver F1).

## DE4 — SELECT en PROD (decide la causa real)

Ejecutado `scripts/diagnosticos/2026-10-30-de4*.mjs --env prod --yes` (solo lectura, Management API).

1. **`conduce_transferencias` últimos 10 días → 0 filas.** La última transferencia en TODO el historial de prod es del `2026-09-18` (aceptada). No existe ninguna oferta cerca de la fecha en que Misael dice haber transferido a Xaviel.
2. **Xaviel SÍ es chofer en prod**: `conductores.id=a1796a6f-91ce-4707-b584-7e4c482b0af2`, `nombre='XAVIEL TERRERO'`, `usuario_id` = su propio `auth.uid()` (`4b19cc4b-...`), `activo=true`. **Descarta C2** (no es que Xaviel no sea chofer).
3. **0 conductores activos sin `usuario_id`** en prod. **Descarta C1** (no hay un "Xaviel" duplicado o chofer huérfano al que Misael pudo haberle transferido por error).
4. **0 notificaciones de conduce** a Xaviel en ningún rango reciente (solo le llegan avisos de "Material no catalogado en un conduce", nada de transferencia).
5. `sgc.app_error_reports` (15 días, filtro transfer/conduce): **ninguna fila de tipo `conduce_transferir`/`ofrecer_transferencia`** — solo errores de otros flujos (`conduce_estado_op`, `conduce_simple`, `conduce_entregado`, `conduce_firmar_receptor`). Esa tabla registra fallos del **outbox** (acciones offline-first); el botón de transferir **no pasa por el outbox**, llama al RPC directo (`conduces.service.ts:2278` en csd-app) — por eso un fallo ahí no deja rastro en `app_error_reports`.
6. Leído el código real de csd-app (`conduces-historial.ts:194-214`): antes de llamar al RPC hay dos guardas **client-side silenciosas para la base de datos** (no generan fila ni error de servidor): `if (!this.network.online())` → toast "Necesitas conexión para ofrecer una transferencia." y `if (!esUuid(this.choferSel()))` → toast "Elige el chofer...". Si cualquiera de las dos se dispara, la función retorna **antes** de tocar el RPC — exactamente el patrón que explica "0 filas en servidor, 0 errores de servidor, el que ofrece no se entera del estado".

**Conclusión (causa real = C3, confirmada por datos, no por hipótesis):** la oferta **nunca se creó** en el servidor. La hipótesis original de CONTEXTO-62 (C1/C2, un destino mal elegido) queda **descartada por los datos** — Xaviel sí es chofer válido y no hay conductor huérfano con su nombre. La causa más probable del lado del cliente es el guard de conectividad (`network.online()`) disparándose en el momento del intento (típico en obra/camión con señal intermitente) y Misael no reparando en el toast de error, combinado con la **mala UX ya señalada en CONTEXTO-62**: quien ofrece no tiene forma de confirmar después si la oferta quedó creada o no. La corrección de ese guard específico del cliente (csd-app) es de **PROMPT-127**; lo que corresponde a esta ronda (F5) es DE-11/DE-12: que el flujo del servidor sea a prueba de destinos inválidos, y que **tanto quien ofrece como Flota/admin tengan visibilidad real** del estado — hoy no existe ninguna pantalla donde Xaviel hubiera podido confirmar "0 ofertas pendientes para mí" sin que yo corriera SQL.

## DE3 — badge de Inventario sin nada adentro

Confirmado con código real (no solo el diagnóstico de CONTEXTO-62):
- **App (csd-app) `src/app/core/services/badges.service.ts:23`**: `count('salidas_inventario', 'estado', 'despachado', 'inventario')` — cuenta **todas** las filas `despachado` visibles por RLS, sin filtrar por "mío" ni por almacén del usuario. Esto es exactamente lo que ve Misael: un número en el icono que no corresponde a nada concreto suyo adentro.
- **Web (`src/shared/services/notificaciones.service.ts`)**: el patrón es distinto pero tiene el mismo problema de fondo — cada badge es una consulta independiente sin una fuente única verificada contra "la lista de adentro" (`solicitudes_material` pendiente, `inventario.requisiciones`, `inventario.material_no_catalogado`, `inventario.conduces_por_implementar` conviven como submódulos separados bajo la clave `inventario`; además hay una consulta de `salidas_inventario despachado` que curiosamente se asigna a la clave `'bitacora'`, no `'inventario'`, línea 41 — nombrado así a propósito, no es el mismo bug que en la app, pero confirma que nadie garantiza "número = lista").

**Conclusión:** DE-07/DE-08 se implementan tal cual los defaults — RPC única `badges_modulos_app()` consumida por ambos clientes; la app consume el contrato en PROMPT-127. Esta ronda (F4) entrega la RPC + la aplica al sidebar web + dicta el contrato en `PARIDAD.md`.

## Resumen para HANDOFF
| ID | Causa confirmada | Dónde se arregla |
|---|---|---|
| DE1 | selector solo placa, sin sugerencias, sin visor — confirmado en código (`cargar-documentos.html`/`.ts`) | F1+F2 de esta ronda |
| DE2 | reverso descartado a propósito, sin datos vehículo-específicos en ningún marbete del lote | F3 de esta ronda |
| DE3 | app cuenta TODO `despachado` sin filtrar por "mío"; web sin fuente única | F4 (RPC) de esta ronda + wiring en PROMPT-127 (app) |
| DE4 | C3 confirmado por datos: oferta nunca se creó (guard client-side silencioso, csd-app); C1/C2 descartados por datos | F5 de esta ronda (servidor + visibilidad web); guard del cliente es PROMPT-127 |
