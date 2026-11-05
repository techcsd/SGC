# Mapa de integración de inventario SGC → Odoo

Fecha: 15/10/2026. Base inspeccionada: `f755dbfed1f8adcb740a852d59b4eabdcc4c0350`.

Este documento mapea **código existente** y propone dónde emitir eventos y ejecutar llamadas a Odoo. No implementa integración, no acredita el esquema desplegado y no ha escrito en servicios externos. Complementa `docs/AUDITORIA-SOLAPAMIENTO-ODOO.md`.

Las referencias `archivo:línea` señalan el checkout inspeccionado. Los SQL son definiciones/antecedentes localizados, **no certificación de la función activa ni del orden de aplicación**: hay sobrecargas, wrappers y modificaciones dinámicas. Antes de migrar se necesita contrastar firmas y cuerpos con dev y su ledger.

## 1. Decisión de arquitectura

Los archivos Angular siguientes identifican los disparadores, pero **la llamada autenticada a Odoo debe vivir en servidor**. Propuesta:

`Pantalla → servicio Angular → operación/RPC SGC + evento durable en la misma transacción → procesador servidor → acción de negocio Odoo → vínculo y estado de sincronización`.

No agregar `fetch(Odoo)` después de cada llamada Angular: un cierre de pestaña perdería la publicación y las operaciones nacidas dentro de otros RPC quedarían fuera. Tampoco reutilizar la notificación de correo como transporte económico: `src/shared/utils/notificar-solicitud.util.ts:8` es deliberadamente fire-and-forget.

Puntos canónicos propuestos: creación de OC, creación de salida, materialización de entrada y cambios de estado confirmados. Un único evento por operación/etapa, aunque haya varios caminos para llegar a ella. Una migración nueva añadirá estos puntos; no editar migraciones históricas para esperar que se reapliquen.

El modo inicial sería publicación y conciliación con SGC como autoridad operativa. Cambiar a Odoo como maestro de stock es otro corte: requiere decidir reservas, validación previa y actualización de la proyección SGC; una cola posterior al hecho no evita por sí sola conflictos entre dos sistemas que descuenten existencias.

### Fase 0A — Diagnóstico de desfases y equivalencias

**Primer paso:** comparar los catálogos reales de ambos sistemas, sin escrituras, antes de fijar la migración de identidad. Historia [#18](https://github.com/techcsd/SGC/issues/18), asignada a `amirandap`, dentro de la [épica #2](https://github.com/techcsd/SGC/issues/2).

El diagnóstico produce una matriz por entidad/registro con ID SGC, instancia/modelo/ID Odoo, evidencia de correspondencia, diferencia y acción por lado. Clasifica equivalentes, solo SGC, solo Odoo, divergentes, ambiguos/duplicados y archivados/no aplicables. Los IDs de ambos sistemas no tienen que ser iguales: deben representar la misma entidad de negocio y conservar sus referencias cruzadas.

Alcance: compañías, almacenes/ubicaciones de obra/centrales/tránsito/cuarentena, productos/plantillas/variantes, categorías, unidades/empaques y proveedores. Se añaden monedas, impuestos, tipos de operación y referencias de proyecto/analíticas/lotes/series cuando la configuración real los requiera. No se asume equivalencia por nombre ni correspondencia 1:1 de bodega y almacén ERP.

Acceso: lecturas autorizadas o exportaciones verificables, con fecha/entorno/base/compañía/filtros. No depende de haber construido el outbox o el adaptador de publicación. Los saldos distintos se reportan por separado; no se igualan automáticamente al homologar maestros.

### Fase 0B — Persistencia de identidad nativa y vínculos

Después de aceptar el contrato de equivalencias del diagnóstico, preparar la persistencia de identificadores nativos ([#3](https://github.com/techcsd/SGC/issues/3)) y relaciones de stock ([#4](https://github.com/techcsd/SGC/issues/4)). El esquema siguiente es una **propuesta para la migración**, condicionada a las cardinalidades verificadas; no columnas ya añadidas ni una migración aplicada.

Ya existe `odoo_ref text` en proveedores, artículos y vehículos (`sql/2026-09-29-cc4-odoo-ref.sql:15`). El mapeador acepta External ID y Database ID en ese mismo campo (`src/shared/services/importador.service.ts:26`). Preservarlo por compatibilidad; no convertirlo ni rellenar identificadores nativos mediante un cast, aunque su texto sea numérico. Cada vínculo necesita resolución verificada contra la base Odoo correcta.

Se consideran tres enfoques: (a) solo columnas, sencillo para relaciones uno a uno pero insuficiente para documentos divididos; (b) solo una tabla de vínculos, flexible pero sin referencias directas en los maestros; (c) **columnas para identidades uno a uno y vínculos auxiliares para relaciones múltiples**, recomendado para este alcance. Los documentos con múltiples correspondencias usan la relación auxiliar como autoridad, evitando mantener dos representaciones editables del mismo vínculo.

| Grupo / tablas SGC | Extensión propuesta | Regla |
| --- | --- | --- |
| Contexto | Registro `odoo_instancias`: identificador local, URL/base y entorno; compañía como contexto cuando corresponda | Sin credenciales. El mismo entero en dos bases no implica el mismo registro. El cambio de identidad de base requiere un nuevo contexto. |
| Proveedores `proveedores` | `odoo_instancia_id` + `odoo_id bigint` | Modelo fijo `res.partner`. Conservar UUID SGC y `odoo_ref`. |
| Artículos `articulos` | `odoo_instancia_id` + `odoo_product_id bigint` + `odoo_template_id bigint` | El ID de variante y el de plantilla no son intercambiables. Varios artículos/variantes pueden compartir plantilla; no imponer unicidad a `odoo_template_id`. |
| Categorías `categorias_inventario` y unidades `unidades` | `odoo_instancia_id` + `odoo_id bigint` | Modelo fijo por tabla y unidad/conversión verificadas antes de vincular. |
| Almacenes `bodegas` | Referencia de instancia + IDs explícitos de ubicación/almacén Odoo cuando procedan | No usar un `odoo_id` ambiguo para dos modelos. Una ubicación puede pertenecer a un almacén sin ser ese almacén. |
| OC `ordenes_compra` y líneas `orden_compra_items` | `odoo_instancia_id` + `odoo_id bigint` en cabecera y líneas | Identidad por documento y renglón; comprobar que la línea ERP pertenece a la cabecera vinculada y a la misma instancia. |
| Entradas/salidas y sus líneas: `entradas_inventario`, `salidas_inventario`, `detalle_entradas`, `detalle_salidas` | Relación auxiliar de vínculos, con FK a la entidad SGC, instancia, modelo e ID nativo Odoo; propósito/etapa del vínculo | Permitir recepciones parciales, pendientes y movimientos divididos sin sobrescribir un único ID. La salida y su entrada vinculada pueden ser etapas del mismo traslado. |
| Conteos, retiros y conduces externos | Vínculos a las operaciones Odoo efectivas, reutilizando los de entradas/salidas cuando correspondan | No crear otro vínculo de stock independiente por cada pantalla que muestra el mismo movimiento. |

Condiciones de la migración inicial:

- IDs nativos positivos, referencias opcionales para registros todavía no vinculados y contexto obligatorio cuando exista un ID. Unicidad de cada identidad uno a uno por instancia/modelo/ID; compañía es contexto de acceso, no un mecanismo para duplicar el mismo registro nativo en una base. Categorías/unidades que hoy sean alias requieren reconciliación antes de imponer correspondencia uno a uno.
- No reemplazar PK/FK SGC ni usar nombre, folio o código como identidad nativa. Proteger la escritura de los vínculos para que solo la integración autorizada pueda establecerlos/cambiarlos.
- En relaciones auxiliares, usar FKs efectivas y claves de relación; no una pareja genérica tabla/UUID sin integridad referencial. Permitir las relaciones múltiples legítimas y excluir asociaciones duplicadas; la restricción exacta depende de la cardinalidad por modelo/etapa.
- No publicar llamadas, no poblar IDs por inferencia y no cambiar los importadores en este corte. Primero demostrar que el esquema permite sin ambigüedad proveedor, variante, OC/línea y recepción parcial. Estados/reintentos pertenecen a la siguiente capa de sincronización.
- Primera migración propuesta: contexto + maestros + OC/líneas. Segundo corte: vínculos de operaciones de stock, una vez fijadas las cardinalidades/etapas. Ambos pasan por dev antes de producción.

### Fase 0C — Homologación inicial y alta de faltantes en cada lado

Historia [#19](https://github.com/techcsd/SGC/issues/19), asignada a `amirandap`. A partir del plan aceptado en #18 y con la persistencia de IDs lista, crear o corregir los registros en el lado que corresponda y guardar sus referencias verificadas. Un equivalente existente solo se vincula; no se recrea en ambos sistemas.

Ejecutar primero en dev, con previsualización, autoridad por campo, orden de dependencias y resultado reanudable/idempotente por fila. Recomparar después del lote y bloquear publicación del alcance que conserve referencias pendientes. La carga no modifica saldos ni fija aperturas. La sincronización continua se mantiene separada en [#7](https://github.com/techcsd/SGC/issues/7).

## 2. Compras: crear y actualizar la OC

| Operación | Pantalla que la origina | Servicio existente / RPC | Documento/acción Odoo propuestos |
| --- | --- | --- | --- |
| OC directa | `src/app/pages/compras/ordenes/ordenes.ts:529` | `src/shared/services/ordenes-compra.service.ts:48`, `create()` → `crear_orden_compra` | Crear `purchase.order` en borrador y sus líneas. Guardar vínculo con UUID y líneas SGC. |
| OC desde solicitud aprobada | `src/app/pages/compras/ordenes/ordenes.ts:502` | `src/shared/services/solicitudes-compra.service.ts:69`, `aprobar()` → `aprobar_solicitud_compra` | La misma operación anterior. El RPC crea una OC **borrador**; aprobar la solicitud no equivale a confirmar la OC en Odoo. |
| Aprobar/cancelar OC | `src/app/pages/compras/ordenes/ordenes.ts:583` | `src/shared/services/ordenes-compra.service.ts:75`, `updateEstado()` → `actualizar_estado_orden` | Confirmar/cancelar la OC vinculada mediante la acción admitida por Odoo. Si nace aprobada, crear y después confirmar con recuperación por etapas. |
| Marcar OC recibida | Mismo `updateEstado()` | Revisar junto con `EntradasService` | El estado SGC no contiene cantidades por recepción. **No validar stock por este botón**: la recepción física debe ser el hecho que actualice las cantidades y el estado derivado. |

Definiciones localizadas:

- `sql/2026-07-28-z6b-crear-orden-compra-rpc.sql:11`: `crear_orden_compra`.
- `sql/2026-07-02-atomic-solicitud-approval.sql:91`: `aprobar_solicitud_compra` llama a `crear_orden_compra` dentro de la transacción. Emitir en la creación canónica de la OC; no duplicar la publicación en ambos niveles.
- `sql/2026-07-03-review-fixes.sql:78`: `actualizar_estado_orden`; contrastar con cambios posteriores en dev.

Dependencias: proveedor, compañía, moneda, impuestos, variante/unidad y destino. Los importes/impuestos SGC deben conciliarse con las reglas del ERP. No crear factura ni pago por crear una OC.

## 3. Requisición y salida: distintos caminos, una misma operación

| Operación | Pantalla | Servicio / RPC | Punto de integración |
| --- | --- | --- | --- |
| Aprobar requisición | `src/app/pages/inventario/requisiciones/requisiciones.ts:881` | `src/shared/services/solicitudes-material.service.ts:135`, `aprobarRequisicion()` → `aprobar_requisicion` | Publicar la **salida efectivamente creada**, si la hay; la parte faltante crea solicitud de compra, todavía no una OC. |
| Camino adicional en código de Salidas | `src/app/pages/inventario/salidas/salidas.ts:1067` | Mismo servicio/RPC | Cubrir desde servidor. El template dirige a la bandeja; la presencia del método no prueba que toda su lógica siga alcanzable por UI. |
| Salida directa/despacho parcial | `src/app/pages/inventario/salidas/salidas.ts:936` | `src/shared/services/salidas.service.ts:411`, `create()` → `registrar_salida_inventario` | Crear/vincular una transferencia `stock.picking`, con renglones y ubicaciones acordes al propósito. No tratar todo envío a obra como venta ni consumo final. |
| Completar entrega desde conduce | `src/app/pages/inventario/conduce/conduce.ts:581` | `src/shared/services/salidas.service.ts:221`, `entregarConduce()` → `entregar_conduce` | Publicar la transición efectiva y cantidades recibidas del documento ya vinculado. Verificar convergencia con la otra recepción. |
| Recepción por obra | `src/app/pages/bitacora/entregas/entregas.ts:154` | `src/shared/services/salidas.service.ts:702`, `confirmarRecepcion()` → `confirmar_recepcion_salida` | Completar la etapa de recepción del traslado con cantidades reales; tratar faltantes explícitamente. |
| Anular conduce | `src/app/pages/inventario/conduce/conduce.ts:309` | `src/shared/services/salidas.service.ts:244`, `anularConduce()` → `anular_conduce` | Cancelar si aún es cancelable; si Odoo ya validó, definir devolución/compensación, conservando trazabilidad. |

Definiciones importantes:

- `sql/2026-10-14-co4-autoaprobar-requisicion.sql:99`: la aprobación divide disponible/faltante; `requisicion_auto_conduce` condiciona crear salida. Publicar el resultado real, no asumir que toda aprobación descuenta stock.
- `sql/2026-10-14-co15-co3-co5-combustible-conduce-antidup.sql:419`: `registrar_salida_inventario`; también recibe llamadas internas de otros RPC. Su anti-duplicado de 120 segundos no sustituye idempotencia permanente de integración.
- `sql/2026-10-08-cj6-recepcion-unificada.sql:12`: `_aplicar_recepcion_salida`; actualiza entrega y genera entrada en el almacén de obra cuando corresponde. Lo usan `confirmar_recepcion_salida` (`:77`) y la recepción externa (`:153`).
- `sql/2026-08-19-au1-conduce-firma-despachante-regla-recordatorio.sql:28`: `entregar_conduce`, camino adicional que debe contrastarse con helpers/wrappers posteriores.
- `sql/2026-08-14-aq10-aq12-anular-conduce-confirmaciones-central.sql:26`: `anular_conduce`.

**Frontera transaccional por resolver antes de publicar salidas:** `SalidasService.create()` crea primero el documento y después escribe `destino_almacen_id`, conductor y vehículo (`salidas.service.ts:428`). El evento no debe salir con un destino incompleto ni depender de que el navegador termine la segunda escritura. Propuesta: incorporar los datos necesarios al RPC o introducir una transición explícita «lista para sincronizar» validada en servidor.

**Una salida y su entrada vinculada en obra son etapas del mismo traslado.** No publicarlas como una entrega y una recepción independiente de proveedor, porque duplicaría el efecto. Definir ubicación de tránsito/etapas y cuándo Odoo valida cada una antes de implementar. Firma/foto pueden enriquecer un documento ya creado; no deben crear otro movimiento.

## 4. Entradas, compra recibida y devolución

| Operación | Pantalla | Servicio / RPC | Documento/acción propuestos |
| --- | --- | --- | --- |
| Registrar entrada | `src/app/pages/inventario/entradas/entradas.ts:801` | `src/shared/services/entradas.service.ts:161`, `create()` → `registrar_entrada_inventario` | Si está pendiente, preparar/vincular; si ya materializó stock, publicar recepción efectiva. Si tiene OC, **reutilizar la recepción generada por la OC Odoo**, no crear otra suelta. |
| Confirmar entrada | `src/app/pages/inventario/entradas/entradas.ts:285` | `src/shared/services/entradas.service.ts:59`, `confirmarConEvidencia()` → `confirmar_entrada_evidencia` | Actualizar cantidades realmente recibidas y validar la recepción vinculada; resolver parciales y documentos pendientes que devuelva Odoo. |
| Confirmación alternativa | `src/shared/services/entradas.service.ts:45`, `confirmarChofer()` | `confirmar_entrada_chofer` | Cubrir en servidor si sigue habilitada. No asumir uso web actual solo por existir el método. |
| Devolución desde obra | Misma pantalla de Entradas, rama de `create()` en `entradas.service.ts:165` | `registrar_devolucion_obra`, con `p_descontar` | Transferencia inversa o devolución enlazada, según propiedad/origen. Respetar si descuenta el origen y evitar sumar una recepción sin contrapartida. |
| Rechazar recepción | `src/shared/services/entradas.service.ts:115`, `rechazarRecepcion()` | `rechazar_recepcion` | No validar stock por rechazar. Actualizar/cancelar lo pendiente si existe documento Odoo, según estado. |

SQL localizados: `sql/2026-09-15-br4b-entrada-sin-renglones.sql:7` (`registrar_entrada_inventario`); `sql/2026-08-04-af1-confirmaciones-recepcion.sql:171` (`confirmar_entrada_evidencia`, revisar wrappers posteriores); `sql/2026-08-02-ae2-revert-ferreteria-antifraude.sql:14` (`confirmar_entrada_chofer`); `sql/2026-08-03-ae7-devolucion-obra-idempotente.sql:17` (`registrar_devolucion_obra`).

## 5. Conduce externo

| Operación | Archivo existente | Acción propuesta |
| --- | --- | --- |
| Crear | `src/app/pages/inventario/conduce-externo-form/conduce-externo-form.ts:311` → `src/shared/services/transporte-v3.service.ts:179`, `crearConduceExterno()` | Publicar solo si hay movimiento de catálogo/almacén propio. Si el RPC enlaza `p_salida_id`, reutilizar el documento de esa salida, sin nuevo descuento. El soporte SQL de ese parámetro no prueba que la pantalla actual lo exponga. |
| Confirmar | `src/shared/services/transporte-v3.service.ts:206`, `confirmarRecepcionExterno()` → `conduce_externo_confirmar_receptor` | Materializar entrada pendiente o completar entrega de la salida vinculada. Usar el mismo vínculo/evento canónico del stock, no otro por el hecho de ser transporte externo. |
| Anular | `src/app/pages/inventario/conduce-externo-ficha/conduce-externo-ficha.ts:127` → `transporte-v3.service.ts:223`, `anularConduceExterno()` | Cancelar/compensar según estado efectivo y movimiento vinculado. |

SQL: `sql/2026-10-14-co15-co3-co5-combustible-conduce-antidup.sql:519` (`crear_conduce_externo`); `sql/2026-10-08-cj6-recepcion-unificada.sql:153` (confirmación); `sql/2026-09-22-bv6-conduce-externo-inventario.sql:165` (anulación).

Transportista, placa, fotos y viaje no constituyen por sí solos una compra/venta ni una factura. Un conduce de transporte sin efecto inventariable puede conservarse solo en SGC.

## 6. Regularización, cuarentena y ajustes

| Operación | Pantalla → servicio existente | Integración propuesta / condición |
| --- | --- | --- |
| Vincular material libre | `src/app/pages/inventario/material-no-catalogado/material-no-catalogado.ts:228` → `src/shared/services/salidas.service.ts:624`, `vincularItemLibre()` | Con `generarMovimiento=false`, solo vínculo; con `true`, sincronizar el movimiento real una vez. |
| Crear artículo desde libre | Misma pantalla `:210` → `salidas.service.ts:636`, `crearArticuloDesdeLibre()` | Resolver primero identidad/variante de producto y luego el movimiento opcional. No confundir crear catálogo con aumentar stock. |
| Recibir retiro dañado | `src/app/pages/inventario/retiros/retiros.ts:396` → `src/shared/services/retiros.service.ts:150`, `recibir()` | Representar entrada/traslado a una ubicación no disponible para despacho. Conciliar la contrapartida del origen: no asumir que cuarentena equivale a stock nuevo ni que el retiro ya descontó el stock normal. |
| Disponer retiro | Misma pantalla `:412` → `retiros.service.ts:160`, `disponer()` | Descarte → candidato `stock.scrap`; devolución → documento inverso/proveedor; reparación → retorno a disponible después de validar equivalencia. No asumir que elegir «reparación» acredita un proceso de Repair Odoo. |
| Ajustar existencia individual | `src/app/pages/inventario/almacen-inventario/almacen-inventario.ts:230` → `src/shared/services/inventario-almacen.service.ts:180`, `ajustarStock()` | Ajuste físico por producto/ubicación, con cantidad contada, motivo y referencia. |
| Apertura / ajuste real individual | Misma pantalla `:233` y `:236` → `inventario-almacen.service.ts:126`, `setApertura()`; `:158`, `ajusteRealStock()` | **Decisión de equivalencia pendiente.** Son rebases SGC; no enviar automáticamente los dos como ajustes ordinarios Odoo. Definir corte y evitar sumar apertura sobre historia ya importada. |
| Apertura / ajuste real en lote | `src/app/pages/inventario/apertura/apertura.ts:176`; `src/app/pages/inventario/ajuste-real/ajuste-real.ts:149` → `inventario-almacen.service.ts:138` y `:166` | Misma política de corte/reconciliación; lote con identidad propia y resultado por línea. |
| Aplicar/deshacer conteo | `src/app/pages/inventario/conteos/conteos.ts:386` y `:403` → `src/shared/services/conteos.service.ts:75` y `:81` | Publicar al aplicar, no durante borrador/autoguardado. Deshacer exige operación compensatoria; si hubo movimientos posteriores, no restaurar ciegamente un saldo antiguo en Odoo. |

SQL de referencia: `sql/2026-09-23-bw2-vincular-item-libre-elevados.sql:19` y `:79`; `sql/2026-09-01-bg4-retiro-material-rpcs.sql:234` y `:280`; `sql/2026-07-28-z11-ajustar-stock-articulo.sql:9`; `sql/2026-08-21-au1-p1-ajuste-existencia-motivo.sql:73` y `:86`; `sql/2026-08-17-as10-as12-inventario-apertura-ubicacion.sql:30`; `sql/2026-08-20-at12-ajuste-real.sql:39`; `sql/2026-09-08-bl4-conteo-fisico.sql:165` y `:209`.

Una solicitud de retiro también puede nacer de Bitácora: `src/app/pages/bitacora/nueva/nueva.ts:1473` → `src/shared/services/bitacora.service.ts:185`, `guardarBitacoraExtra()`. Su creación/aprobación no debe producir por sí sola un ajuste Odoo; los hechos inventariables están en recepción/disposición, según la contrapartida acordada.

## 7. Maestros necesarios antes de publicar documentos

Estos son puntos de edición actuales, **no una decisión de sincronización bidireccional**. Si Odoo es maestro, convertir ediciones SGC en solicitudes al adaptador y aplicar la respuesta; no editar ambos lados sin propiedad por campo.

| Maestro | Archivo/métodos actuales | Mapeo propuesto |
| --- | --- | --- |
| Proveedor | `src/shared/services/proveedores.service.ts:78`, `create()`; `:90`, `update()`; `:103`, `toggleActivo()` | `res.partner`; referencia de instancia/compañía/modelo y UUID SGC. También se crea proveedor desde `compras/ordenes/ordenes.ts:343`, por lo que no basta intervenir la pantalla de Proveedores. |
| Artículo | `src/shared/services/articulos.service.ts:67`, `create()`; `:95`, `update()`; `:107`, `toggleActivo()`; más creación desde material libre | Resolver `product.template` del importador frente a la variante `product.product` utilizada en movimientos. No usar sus IDs indistintamente. |
| Categoría | `src/shared/services/categorias.service.ts:36`, `create()`; `:46`, `update()`; `:59`, `toggleActivo()` | Categoría de producto; conservar jerarquía/referencias, no solo nombre de la hoja. |
| Unidad | `src/shared/services/unidades.service.ts:30`, `create()`; `:44`, `updateNombre()`; `:52`, `toggleActivo()` | Unidad compatible y conversiones/empaque. No inferir equivalencia por texto. |
| Almacén | `src/shared/services/bodegas.service.ts:112`, `create()`; `:123`, `update()`; `:135`, `toggleActivo()`; `:188`, `fusionar()` | `stock.warehouse` o `stock.location`, según diseño. Fusionar referencias/stock necesita conciliación; no se resuelve renombrando un almacén ERP. |

`src/shared/services/importador.service.ts:209` y `src/shared/components/importar-odoo/importar-odoo.ts:159` son importación de archivo → Supabase. No son un cliente autenticado de Odoo. La importación no debe provocar eventos de regreso y crear un bucle.

Equipos y activos requieren otro mapeo dentro de la fase: `src/shared/services/activos.service.ts:66` y `src/shared/services/tecnologia.service.ts` son escritores separados. No tratarlos automáticamente como movimientos de materiales o activos contables; esta matriz detalla primero el circuito de materiales.

## 8. Archivos nuevos propuestos, todavía inexistentes

| Archivo | Responsabilidad |
| --- | --- |
| `supabase/functions/odoo-sync/index.ts` | Consumir eventos autorizados/validados, reclamar trabajos con exclusión, resolver dependencias y guardar resultado. Sin endpoint que acepte modelos/métodos arbitrarios del navegador. |
| `supabase/functions/_shared/odoo-client.ts` | Credenciales servidor, API compatible con la instancia, tiempos límite, lectura de errores y acciones de negocio. |
| `supabase/functions/_shared/odoo-inventario.ts` | Resolver OC, recepciones, transferencias, devoluciones y ajustes; cantidades, compañías y unidades. |
| Nueva migración en `sql/` | Eventos durables, vínculos documento/línea SGC↔Odoo, versiones, estados, permisos y puntos de emisión en las transacciones. Fecha/nombre definitivos al implementar en `feature/*`. |
| `src/shared/services/odoo-sync.service.ts` | Consultar estado y solicitar reintento autorizado. No almacenar credenciales ni decidir desde el navegador si un documento ya existe. |

El registro/outbox de la app y sus errores no demuestra una cola de integración ERP utilizable. Diseñar el contrato propio antes de reutilizar tablas por su nombre.

## 9. Contrato mínimo de cada evento y verificación

- Identidad estable: entorno + instancia/base Odoo + compañía + entidad/UUID SGC + acción + revisión; líneas con sus propios identificadores. Vínculo ERP con modelo e ID real, incluyendo documentos creados por Odoo.
- Snapshot/versionado de cantidades y ubicaciones al confirmar. No releer un documento mutable y publicar por error una versión posterior; serializar etapas y bloquear dependencias pendientes.
- Unicidad durable en SGC y mecanismo idempotente comprobable en Odoo. Tras un timeout, reconciliar por referencia única antes de reintentar; `search` seguido de `create` sin exclusión/garantía ERP no resuelve la carrera.
- Estado visible: pendiente, procesando, sincronizado, error o conciliación necesaria; guardar ID/número ERP. Diferenciar rechazo de negocio, fallo transitorio y resultado incierto. No revertir silenciosamente una operación SGC ya confirmada porque Odoo esté caído.
- `es_prueba`: impedir publicación de prueba a la compañía real. Revisar cambios real↔prueba: `src/shared/services/datos-prueba.service.ts:62` y `sql/2026-10-08-cl6-conduce-externo-prueba.sql:229` pueden revertir/reaplicar stock; ignorarlos dejaría un documento ERP huérfano.
- Confirmar en ERP el estado final. Una respuesta de wizard/acción no equivale a transferencia validada; los parciales, lotes y conflictos requieren tratamiento.
- Probar en dev: OC directa y convertida, recepción parcial, requisición mixta, transporte externo vinculado, entrega incompleta, devolución, anulación antes/después de validar, timeout/reintento y real↔prueba. Conciliar cantidad por artículo/unidad/ubicación y referencias; no solo contar respuestas HTTP exitosas.

Orden: **diagnóstico real (#18) → persistencia de identidades (#3/#4) → conexión servidor (#5) y homologación inicial (#19) → sincronización continua (#6/#7)**. Primer circuito posterior: OC directa y OC desde solicitud → una sola OC Odoo → confirmar OC → recepción física parcial sobre su recepción vinculada. Después despacho a obra y recepción, con ubicación de tránsito definida. Migraciones/edges/secrets: dev primero según `docs/ENTORNOS.md`; sin llamada a una instancia Odoo ajena al proyecto.

## 10. Referencia Odoo y decisiones pendientes

Se consultó código oficial de Odoo 19 como referencia técnica; la versión/plan/módulos de la instancia del proyecto siguen pendientes. Las acciones siguientes son **candidatas**, no contratos verificados contra esa instancia:

- [API externa JSON-2](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html): disponible desde 19, sujeta al plan; cada llamada tiene su transacción, no existe transacción distribuida con Supabase.
- [Purchase + Stock](https://github.com/odoo/odoo/blob/19.0/addons/purchase_stock/models/purchase_order.py): la compra puede generar recepciones; reutilizarlas.
- [Transferencias](https://github.com/odoo/odoo/blob/19.0/addons/stock/models/stock_picking.py): `stock.picking`, tipos incoming/outgoing/internal y `button_validate()`; puede devolver acciones pendientes.
- [Conteos](https://github.com/odoo/odoo/blob/19.0/addons/stock/models/stock_quant.py): `action_apply_inventory()`; no sustituir por escritura directa de la cantidad disponible.
- [Descarte](https://github.com/odoo/odoo/blob/19.0/addons/stock/models/stock_scrap.py): `stock.scrap.action_validate()`.

Pendientes antes de fijar payloads: URL/base/versión/plan autorizado; compañías y módulos; dueño de catálogo/stock; producto-variante/unidades; obra como ubicación frente a consumo; etapas de tránsito; equivalencia de apertura/ajuste real; contrapartida de cuarentena; método ERP de idempotencia; permisos y relación documento-línea. Sin estas decisiones no debe elegirse un endpoint definitivo ni activar publicaciones.
