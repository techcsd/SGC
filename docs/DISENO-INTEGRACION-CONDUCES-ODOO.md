# Diseño: integración de conduces entre SGC y Odoo

Estado: PROPUESTA (8-nov-2026), complementa `docs/PLAN-TRASLADOS-ODOO.md`. Nada de esto está aplicado en prod.

## 1. Qué es un conduce hoy (SGC, prod, solo lectura)
- Un conduce es una **salida de inventario con transporte**: 251 de las ~258 salidas reales tienen chofer o ruta. Más 3 conduces externos (`conduces_externos`, transporte de terceros).
- Alrededor de la salida SGC guarda: rutas y paradas (GPS, polilínea, km, fotos, firma por parada), 689 firmas, transferencias de conduce entre choferes, cambios de despachante y de receptor, 33 ítems libres sin producto de Odoo, 28 vehículos y 23 conductores.
- Estados SGC: `despachado → entregado | entregado_incompleto | rechazada | anulado`.
- Odoo 17.0+e no tiene un "conduce" nativo y **no tiene `fleet`, `delivery`/`stock_delivery`, `stock_barcode` ni `l10n_do_stock`**. Sí tiene `stock`, `sign`, `hr`, `base_automation`, `web_studio` y `l10n_do_ecf` (solo contabilidad).

## 2. Qué vive dónde (un solo escritor por dato)
| Dato | Dueño | En el otro lado |
|---|---|---|
| Movimiento de stock: picking, líneas, cantidades hechas, estado, ubicaciones, nº `WH/INT/…` | **Odoo** | SGC guarda `odoo_picking_id` y un espejo de solo lectura del estado |
| Stock por ubicación | **Odoo** (cuando termine la migración) | SGC lo lee con `stock.consultar` |
| Quién lo hizo | SGC (RBAC) | Chatter de Odoo: autor real + "vía SGC" (ver `docs/ODOO-CHATTER-AUTOR.md`) |
| Conduce como documento logístico: folio, chofer, vehículo, ruta, paradas, GPS, km, fotos, firmas, notas | **SGC** | En Odoo solo el folio SGC y un enlace en el chatter |
| Estados logísticos (en tránsito, entregando, rechazada) y recepción con evidencia | **SGC** | Odoo solo conoce "hecho" o "cancelado" |
| Cantidad recibida por línea y motivo del faltante | **SGC** | Un faltante genera una tarea de ajuste; nunca se corrige solo en Odoo |
| Ítems libres (sin producto de Odoo), obra/proyecto, permisos | **SGC** | No se envían |
| Conduce externo | SGC; solo si `afecta_inventario` se crea picking | Odoo recibe el picking; la evidencia queda en SGC |
Clave de unión: `salidas_inventario.odoo_picking_id` (único por instancia) y `origin = SGC-TRAS-<uuid de la salida>` en el picking.

## 3. Principio: cada acción de SGC se ejecuta al instante en Odoo (write-through)
La acción del usuario llama a Odoo **en la misma petición** (gateway `odoo-api`, ya síncrono) y el usuario ve el resultado. El outbox queda solo como red de seguridad cuando Odoo no responde (timeout o caída): la acción se guarda como `pendiente`, se ve en pantalla y se reintenta sola; nunca se pierde.
- **Orden:** primero Odoo, luego SGC. Si Odoo rechaza, no cambia nada en SGC. Si Odoo acepta y SGC falla al guardar, el picking queda huérfano pero se detecta y se adopta por su `origin` (idempotente).
- **Acciones que dependen de disponibilidad** (despachar) consultan Odoo antes y se bloquean si no hay stock, salvo política contraria.
- **Hitos logísticos** (en tránsito, entregado, firmado por X, transferido a otro chofer, cambio de despachante o receptor) se publican al instante como notas cortas en el chatter del picking, con enlace al conduce en SGC. La evidencia pesada (GPS, fotos, firmas) se queda en SGC.
| Acción en SGC | Llamada a Odoo (instantánea) |
|---|---|
| Despachar | `traslados.crear` + validar, o confirmar y validar después según la decisión 1 |
| Anular | cancelar el picking; si ya está hecho, devolución |
| Confirmar recepción | nota en el chatter; si hay faltante, tarea de ajuste y luego devolución o ajuste |
| Ruta iniciada, entregada, transferida | nota en el chatter |
| Conduce externo con inventario | picking de entrada o salida; sin inventario solo SGC |

## 3b. Flujo
1. **Despachar** (SGC): el RPC valida permisos y llama a Odoo; con la respuesta guarda la salida con `odoo_picking_id`. Si Odoo no responde, guarda `odoo_sync_estado = pendiente` y el evento del outbox en la misma transacción.
2. **Reintento/publicación diferida**: `odoo-sync` reclama el evento y llama a `traslados.crear` (+ validar). Es idempotente por `origin`. Guarda `odoo_picking_id`, escribe el chatter y marca `sincronizado`; ante un timeout queda `incierto` y se resuelve leyendo Odoo.
3. **En tránsito y entrega**: solo SGC (ruta, GPS, fotos, firma). Odoo no se entera de cada paso.
4. **Recepción** (SGC, con foto y firma): si lo recibido es menor, SGC abre una tarea de ajuste y, tras aprobarla, se registra una devolución o ajuste en Odoo.
5. **Anular**: cancela el picking si no está `done`; si ya está hecho, crea una devolución y deja el rastro.
Valores de Odoo hoy (medidos): los traslados internos se validan casi al instante (mediana 0,3 min), sin ubicación de tránsito. Por eso el valor por defecto propuesto es **un picking validado al despachar**; usar tránsito en dos pasos es una decisión de Contabilidad.

## 4. Cómo se asegura que ambos lados estén al día
No se puede prometer "100%" sin medirlo; lo que se garantiza es **divergencia acotada, detectada y reparada automáticamente**:
1. **Un escritor por dato** (tabla anterior). Nada se edita en los dos lados.
2. **Outbox transaccional** SGC → Odoo, con lease, reintentos con backoff e idempotencia por `origin`. El estado `odoo_sync_estado` (pendiente / sincronizado / incierto / error) es visible en pantalla con "Reintentar".
3. **Odoo → SGC por sondeo**: cada pocos minutos, `search_read` de `stock.picking` con `write_date` mayor a la marca y `origin` con prefijo `SGC-TRAS-`. Si el estado o las cantidades difieren, se actualiza el espejo y se abre una incidencia de deriva. (No hay webhook nativo comprobado en 17.0; `base_automation` está instalado y se podría evaluar, sin verificar.)
4. **Conciliación diaria completa**: toda salida con `odoo_picking_id` tiene picking en el estado esperado, todo picking `SGC-TRAS-` tiene una salida, las cantidades coinciden y, mientras convivan los dos libros, el saldo de SGC contra el `quant` de Odoo por artículo y bodega homologados.
5. **Detección de cambios manuales**: un picking SGC con `write_uid` distinto de la cuenta técnica se marca como editado en Odoo.
6. **Métricas y alertas** en Tecnología: retraso del outbox, `incierto` abiertos, deriva abierta más de 24 h. Objetivo propuesto: 99% sincronizado en menos de 2 minutos y 0 deriva sin explicar tras la conciliación diaria.
7. **Pruebas de contrato** en un sandbox de Odoo antes de cada fase (D-08) y un runbook de reversa: apagar la política de publicación.
8. **Lo que ya se hace en dev antes de prod** (BU1/CP5) y datos visibles en pantalla (AT11): cada dato enviado se puede ver, también el estado de sincronización.

## 4b. Bodegas de SGC contra almacenes de Odoo (medido 8-nov-2026, solo lectura)
Una bodega de SGC debe mapear a **una ubicación de stock** de Odoo (normalmente `lot_stock_id`, p. ej. `TA/Existencias`), y se guarda también el almacén (`odoo_warehouse_id`) porque de él sale el tipo de operación. No es 1:1 estricto: Odoo tiene 24 almacenes y 120 ubicaciones internas (hasta 5 por almacén).
- Por nombre de proyecto: **21 de 29 bodegas** de SGC tienen un almacén candidato fuerte (13 activas reales + 8 inactivas "fusionado" que apuntan al mismo almacén que su sucesora), 3 posibles (p. ej. Villa Caleton #260 contra "CALENTON") y 5 sin candidato (Bodega Central, "BLUEWAVE - Volares" y 4 de prueba o demo).
- Mapeo propuesto: ~16 bodegas reales activas ↔ 16 almacenes; Bodega Central ↔ `WH` (Almacén principal); las demo, de prueba y fusionadas no se homologan. Los otros 8 almacenes de Odoo no tienen bodega SGC.
- Se hace con `odoo_homologacion_vincular_bodega` en modo simulación y lo valida Contabilidad. Esto reemplaza la nota de octubre ("ninguna coincidencia por nombre"), que usaba nombres exactos.

## 5. Lo que bloquea hoy
- Homologación en prod: 0 de 29 bodegas, 0 de 295 artículos y 0 filas en `odoo_instancias`.
- No hay sandbox de Odoo; `traslados.validar` depende de un asistente que no existe en 17.
- 160 de 227 salidas a obra aparecen `entregado_incompleto` por un artefacto (`conduce_confirmar_receptor` deja `cantidad_recibida` en NULL); hay que corregirlo antes de publicar recepciones.
- Falta el visto bueno de Contabilidad sobre tránsito, faltantes y autor del chatter.

## 6. Decisiones pendientes
1. ¿Un picking validado al despachar o tránsito en dos pasos?
2. Política de faltantes: devolución, merma o ajuste, y quién aprueba.
3. ¿Se adjunta el PDF del conduce firmado al picking en Odoo (`ir.attachment`)?
4. ¿Odoo es el dueño del saldo desde la Fase 4?
5. Cobertura del autor del chatter: solo usuarios y empleados, o también contactos etiquetados.
