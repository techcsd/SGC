# Plan de integración SGC ↔ Odoo (traslados, conduces y bodegas)

**Estado: APROBADO (8-nov-2026) por Alejandro Miranda** con una decisión que cambia el borrador: **se usa tránsito** (ADR 4), enlazado con las rutas y paradas de SGC. Los ADR que dependen de Contabilidad o del dueño (4, 5, 10, 11, 15, usuario de integración, piloto) quedan aprobados para ejecutar la fase 0 y se ratifican con ellos antes de la fase 3 (nada se escribe en el Odoo de prod antes). Cada fase tiene su issue en GitHub (sección 7). Reemplaza las decisiones abiertas de `PLAN-TRASLADOS-ODOO.md` y consolida `DISENO-INTEGRACION-CONDUCES-ODOO.md`, `ESTRUCTURA-ODOO-BODEGAS.md` y `ODOO-CHATTER-AUTOR.md`. Nada está aplicado en prod.

## 0. Hechos que sostienen las decisiones (medidos, solo lectura)
- Odoo 17.0+e. Los traslados internos se crean y validan casi al instante: p50 0,00 h, p90 0,3 h, p99 59 h, máx 166 h. Hay **1** traslado interno abierto hoy. No usan tránsito.
- En SGC, de la salida a la confirmación de recepción pasan **137 a 498 horas** de promedio por usuario receptor (retraso administrativo, no físico).
- Odoo **no permite stock negativo** (`allow_negative_stock` apagado) y hoy hay 1 quant negativo entre 802 con saldo.
- La cuenta del gateway es **Eduardo Ng con Ajustes e Inventario/Administrador**: puede crear almacenes, ubicaciones, identificadores externos y adjuntos. El perfil "limitado" también puede crear y escribir en stock.
- SGC: 258 salidas reales, 251 con chofer o ruta; `stock_por_bodega` es una tabla de saldo escrita por RPC y usada por 55 archivos. **0 de 29 bodegas, 0 de 295 artículos y 0 instancias** homologadas en prod. En los traslados de Odoo hay 101 productos distintos y en SGC 143, y solo 10 coinciden por nombre.
- 160 de 227 salidas a obra están `entregado_incompleto` por un artefacto de `conduce_confirmar_receptor`.

## 1. Decisiones (ADR)
| # | Decisión | Razón | Cómo se revierte |
|---|---|---|---|
| 1 | **Reparto de propiedad:** Odoo = movimiento y saldo; SGC = conduce logístico, evidencia, permisos y estados logísticos | Un solo escritor por dato; Odoo no guarda firmas ni GPS | Cambiar la tabla de propiedad |
| 2 | **Write-through síncrono, Odoo primero.** El outbox solo como red de seguridad ante timeout o caída | Es el principio acordado (cada acción de SGC al instante en Odoo); si Odoo rechaza no queda nada a medias | Apagar la política de publicación |
| 3 | **Si Odoo no responde:** hasta el corte por bodega (fase 5) el despacho sigue con la disponibilidad de SGC y queda `pendiente`, visible y con reintento automático. Después del corte, bloquea con mensaje claro y un modo de contingencia aprobado por admin | Un despacho físico no debe depender de que Odoo esté arriba mientras SGC siga siendo el libro | Flag por bodega |
| 4 | **Tránsito en dos pasos, enlazado con rutas.** Picking A (origen → `Physical Locations/Traslado entre almacenes`) se valida al **despachar**. Picking B (tránsito → destino) se valida cuando la **parada de la ruta pasa a `entregada`** (llegada física, `ruta_paradas.estado`), no cuando alguien confirma la recepción en el sistema. La confirmación de recepción solo fija la cantidad recibida y dispara los ajustes | El stock en camino queda visible en Odoo y no se pierde entre bodegas. Anclar el paso B a la parada evita que el destino quede en 0 durante los 137–498 h de retraso administrativo. Sin ruta (retiro directo), B se dispara con la confirmación de recepción | Validar A y B juntos al despachar (un solo paso) con un flag |
| 5 | **Faltantes y rechazos nunca se corrigen solos:** SGC abre una solicitud de ajuste, la aprueba el rol de jefe de inventario o admin y entonces se registra al instante en Odoo. Con tránsito, lo no recibido **permanece en la ubicación de tránsito** (B se valida solo por lo recibido) hasta resolverse: rechazo → devolución tránsito → origen; faltante → ajuste de tránsito a `Faltantes SGC` | Protege el costo y la contabilidad; el 68% de "incompletos" ya demostró que el dato puede ser falso | Política por tipo |
| 6 | **Stock:** Odoo es el dueño del saldo **por bodega** al cortar. `stock_por_bodega` se conserva como **proyección de lectura** alimentada desde Odoo | No se reescriben los 55 consumidores; el corte es reversible bodega a bodega | Volver el flag `odoo_fuente_stock` a falso |
| 7 | **Bodegas:** 1 bodega = 1 almacén = `lot_stock_id`. Se vinculan los 16 existentes; demo, prueba y fusionadas no se homologan; los 8 almacenes de Odoo sin bodega SGC quedan "no gestionados" (informativos, no son deriva) y se crean solo si un proyecto lo necesita | YAGNI y la convención actual de Odoo | Vincular más después |
| 8 | **Identificador externo** `ir.model.data` (`sgc.bodega_<uuid>`) como extra opcional; el vínculo oficial es `odoo_warehouse_id` en SGC. **Sin campos de Studio** | No customizar Odoo ni arriesgar las actualizaciones | Borrar los identificadores |
| 9 | **Identidad de integración:** crear un usuario dedicado **"SGC Integración"** con permisos mínimos (Inventario/Usuario, sin Ajustes), y una credencial de administración separada y manual solo para crear almacenes. Dejar de usar la cuenta personal de Eduardo Ng. Corregir el perfil "limitado" para que sea solo lectura | Menor radio de daño, auditoría clara (`create_uid` = integración) y rotación de claves sin depender de una persona. Cuesta 1 licencia interna (por confirmar con Odoo) | Volver al usuario anterior |
| 10 | **Autor del chatter:** usuario interno → empleado (cédula, luego correo) → cuenta de integración con el nombre en el cuerpo; siempre "vía SGC". No se crean usuarios ni contactos. Se captura la cédula en SGC (hoy 15 de 54) | Cero licencias y sin ensuciar la libreta de contactos | Quedarse con la cuenta técnica |
| 11 | **Crear almacenes:** solo el rol admin de SGC, con vista previa, aprobación de Contabilidad registrada en la auditoría y solo tras pasar por el sandbox. Nunca desde el flujo de conduces | Es irreversible (genera ubicaciones, 5 tipos y rutas) | Archivar el almacén |
| 12 | **Roles:** despachar y cancelar antes de la recepción = `inventario` con acceso a la bodega de origen y destino; cancelar un traslado ya hecho = admin o jefe de inventario, por devolución; recibir = el RBAC actual; leer traslados = filtrado por bodega | Reutilizar el RBAC existente | — |
| 13 | **Validar en Odoo 17 sin asistente de transferencia inmediata:** confirmar (reserva), validar, y el backorder se rechaza con un mensaje, no se procesa solo. El rechazo por stock negativo de Odoo se traduce a un mensaje claro por rol | El asistente no existe en 17; la regla de stock negativo ya protege | Ajustar tras el sandbox |
| 14 | **Corregir el artefacto de incompletos antes de publicar recepciones:** `conduce_confirmar_receptor` debe tratar `cantidad_recibida` NULL como lo enviado, con migración en dev y un data-fix versionado | Sin eso se publicarían faltantes falsos | Revertir la migración |
| 15 | **Productos:** el catálogo maestro es el de Odoo. Los artículos de SGC sin producto se dan de alta por la pantalla existente "Productos por dar de alta" (con aprobación de Contabilidad) | Solo 10 nombres coinciden; la homologación es el mayor bloqueo | — |
| 16 | **Un solo canal de entrada por flujo y bodega en el piloto:** mientras una bodega esté en piloto, los traslados desde y hacia ella se crean por SGC, no a mano en Odoo; el detector marca los que no vengan de la integración | Evita el doble registro (hoy dos personas operan en Odoo) | Quitar la bodega del piloto |
| 17 | **Sincronía Odoo → SGC:** sondeo de `write_date` cada 5 min más conciliación diaria completa; el webhook de `base_automation` se evalúa después | No hay webhook verificado en 17.0 | — |
| 18 | **Sandbox primero.** Se pide una copia de la base a Chai Consultoría. Si en 2 semanas no existe, se crea un almacén de pruebas `SGCT` (archivable) con el producto de prueba para las escrituras de contrato | D-08: no escribir en prod sin aislamiento | — |
| 19 | **PDF firmado como adjunto del picking** (`ir.attachment`) en la fase 4, no en el MVP | Copia inmutable en Odoo, pero no es necesaria para que funcione | No generarlo |
| 21 | **Enlace con las tablas de rutas:** `salidas_inventario` (conduce) ya tiene `ruta_id` y `ruta_parada_id`. Se agregan `odoo_picking_salida_id` (A) y `odoo_picking_entrada_id` (B) y un estado de tránsito derivado de `rutas.estado` y `ruta_paradas.estado`. Un trigger/RPC sobre el cambio de parada a `entregada` llama a `traslados.validar` de B (idempotente por `origin = SGC-TRAS-<uuid>-B`). Parada `omitida` o ruta cancelada no valida B y abre una incidencia; un cambio de destino de parada (`destino_cambiado`) se refleja en B antes de validarlo. Los eventos de ruta (`ruta_eventos`) alimentan el chatter | Reutiliza el modelo logístico existente y evita un segundo estado de tránsito paralelo | Desactivar el disparo por parada y validar B con la recepción |
| 20 | **Retiro:** al cerrar la fase 5 se retiran `odoo_vinculos_stock`, `odoo_vinculos_stock_lineas` y `odoo_comandos_oc` si no se usan, con migración de contracción | Las columnas `odoo_picking_*_id` son suficientes | No retirarlas |

## 2. Arquitectura objetivo
- **Escritura:** pantalla → RPC de SGC (permisos y reglas) → gateway `odoo-api` (`traslados.crear` + validar). Despacho: crea y valida **A** (origen → tránsito). Parada `entregada`: crea/valida **B** (tránsito → destino) por la cantidad recibida o enviada. Idempotente por `origin = SGC-TRAS-<uuid>-A|B`.
- **Lectura de estado y stock:** `traslados.obtener` y `stock.consultar` sin caché; `stock_por_bodega` como proyección.
- **Red de seguridad:** outbox con `odoo_sync_estado` (pendiente / sincronizado / incierto / error), backoff, circuito de fallo, "Reintentar" visible.
- **Hitos al chatter** (en tránsito, entregado, transferido, cambio de despachante o receptor) como notas cortas con enlace al conduce.
- **Esquema aditivo en `salidas_inventario`:** `odoo_instancia_id`, `odoo_picking_salida_id` y `odoo_picking_entrada_id` (únicos por instancia), `odoo_sync_estado`, `odoo_sync_error`, `odoo_sync_intentos`, `odoo_sync_en`. Todo con RLS y grants verificados y migración en `sql/` con ledger.

## 3. Fases con criterio de salida
**Fase 0. Preparación (sin tocar Odoo real; 1-2 semanas)**
1. Corregir el artefacto de incompletos (ADR 14) en dev, con data-fix; revisar qué envía la app móvil.
2. Pedir el sandbox a Chai (ADR 18) y el usuario "SGC Integración" (ADR 9); corregir el perfil de solo lectura.
3. Capturar cédulas en SGC y homologar en simulación las 16 bodegas y 5 artículos piloto con Contabilidad.
4. Acordar el canal único del piloto (ADR 16) con las dos personas que operan en Odoo.
5. Firma de este plan por Contabilidad y el dueño.
*Salida:* decisiones firmadas, sandbox o plan `SGCT`, incompletos corregidos en dev.

**Fase 1. Fundaciones en dev**
Rama `feature/traslados-odoo` desde `dev` (CQ6: un worktree por sesión). Dos pickings (A y B) enlazados a `ruta_id`/`ruta_parada_id` (ADR 21). Commitear el código de `traslados.*` tras revisión; corregir lectura filtrada por bodega, `validar` para Odoo 17 y los tests; migración aditiva; RPC de despacho con write-through; pantalla con estado de sincronización y "Reintentar" (AT11, BS2, BS4, AW12, CJ4); nota de versión (Y1); `docs/DATOS-Y-TERCEROS.md` (CI13).
*Salida:* `release-check --env dev` verde y pruebas de contrato contra el sandbox.

**Fase 2. Sombra contra el sandbox (2 semanas)**
Escritura real al sandbox, conciliador, métricas y runbook de reversa.
*Salida:* 2 semanas con 0 deriva, 0 inciertos abiertos y 0 stock varado en tránsito sin explicar.

**Fase 3. Canary en prod**
Par `WH` → `TA` (el destino más frecuente de Odoo), 5 artículos, solo los usuarios piloto, flag por bodega y por agregado.
*Salida:* 2 semanas sin deriva, p99 de publicación < 5 s y ningún traslado fuera de canal.

**Fase 4. Expansión**
Las 16 bodegas, recepción con solicitud de ajuste y devolución, conduces externos con inventario, PDF adjunto.

**Fase 5. Corte del saldo por bodega**
Apertura con ajuste de inventario y fecha de corte, `stock_por_bodega` alimentada desde Odoo, bloqueo si Odoo no responde (ADR 3).

**Fase 6. Contracción**
Retiro de lo obsoleto (ADR 20) y revisión del diseño.

## 4. Verificación y operación
- **SLO propuestos:** 99% de acciones reflejadas en Odoo en menos de 2 min; 0 deriva sin explicar tras la conciliación diaria; `incierto` resuelto en menos de 1 h; retraso del outbox con alerta a los 5 min.
- **Conciliación diaria:** cada salida con `odoo_picking_id` contra su picking (estado y cantidades); cada picking `SGC-TRAS-` contra una salida; saldo contra `quant` por artículo y bodega mientras convivan los libros; pickings editados a mano o creados fuera del canal en bodegas piloto.
- **Pruebas:** unitarias (ya hay 261 en edges), de contrato en sandbox con cada versión de Odoo (el 18 cambia `is_storable` y los asistentes), de permisos por rol y por bodega, y E2E del despacho y la recepción.
- **Seguridad:** claves en Doppler, rotación trimestral, ningún secreto en el cliente, el gateway nunca recibe ids de Odoo del navegador, auditoría de quién y cuándo.

## 5. Riesgos
| Riesgo | Mitigación |
|---|---|
| Homologación de artículos (solo 10 nombres coinciden) | Piloto de 5 artículos y alta controlada por Contabilidad |
| Doble canal de captura | ADR 16 y detector diario |
| Escritura real sin sandbox | ADR 18 y almacén `SGCT` |
| Cuenta de integración con permisos de administrador | ADR 9 |
| Faltantes falsos por el artefacto de incompletos | ADR 14 antes de publicar recepciones |
| Cambios de versión de Odoo | Aislar supuestos en `odoo-traslados.ts` y pruebas de contrato |
| Dependencia de la app móvil (otro repositorio) | Revisar `csd-app` en la fase 0 |
| Stock varado en tránsito (ruta que no cierra, parada omitida) | Alerta diaria de tránsito > 72 h, incidencia al omitir/cancelar y reporte en el conciliador |
| Sin ruta o chofer en el conduce | B se dispara con la confirmación de recepción |

## 6. Responsables y pendientes humanos
- **Contabilidad / Eduardo Ng:** aprobar ADR 4, 5, 10, 11, 15; el usuario de integración; el piloto.
- **Chai Consultoría:** sandbox, licencia del usuario de integración y permisos.
- **Tecnología (Xaviel):** fases 1 a 6, la app móvil, la captura de cédulas.
- **Dueño:** firma del plan y las condiciones de corte por bodega.
- **Sin verificar aún:** validar en Odoo real (depende del sandbox), la regla de licencias por escrito, `ir.model.data` por la cuenta de integración dedicada, y el comportamiento de `button_validate` sin stock.

## 7. Issues de GitHub (una por fase)
Se crean en `techcsd/SGC` con las etiquetas `odoo` y `mod:inventario`.

| Fase | Issue |
|---|---|
| 0 Preparación | [techcsd/SGC#111](https://github.com/techcsd/SGC/issues/111) |
| 1 Fundaciones en dev | [techcsd/SGC#112](https://github.com/techcsd/SGC/issues/112) |
| 2 Sombra en sandbox | [techcsd/SGC#113](https://github.com/techcsd/SGC/issues/113) |
| 3 Canary en prod | [techcsd/SGC#114](https://github.com/techcsd/SGC/issues/114) |
| 4 Expansión | [techcsd/SGC#115](https://github.com/techcsd/SGC/issues/115) |
| 5 Corte del saldo | [techcsd/SGC#116](https://github.com/techcsd/SGC/issues/116) |
| 6 Contracción | [techcsd/SGC#117](https://github.com/techcsd/SGC/issues/117) |
