# Evaluación: SGC con acceso directo a Odoo

Fecha: 16/10/2026. Código examinado: `4d21fb640986f0279f5e8fdf78515cd97146c613`, rama `feature/odoo-schema-handoff`. Estado: evaluación técnica; no se modificó código ejecutable, no se aplicó DDL ni se realizaron escrituras en Odoo.

## 1. Recomendación

Adoptar un camino de petición/respuesta: **pantalla Angular → servicio de dominio → gateway servidor → API Odoo 17 → respuesta a la pantalla**. En ese camino, catálogo, existencias y documentos ERP se leen y escriben en Odoo. No se consultan las tablas ERP antiguas de SGC ni se mantienen copias completas de esas entidades en Supabase.

Supabase conserva autenticación, permisos, proyectos y procesos propios de SGC, evidencias, metadatos específicos y trazabilidad de comandos. Guardar una referencia a un documento Odoo o el contenido histórico de una evidencia no convierte a SGC en un segundo libro de inventario.

Este enfoque sustituye la necesidad de una proyección completa de catálogo/stock propuesta anteriormente. La cola de sincronización tampoco es un requisito para cada consulta o acción interactiva. Sí hace falta resolver idempotencia y resultados inciertos de las escrituras, aunque la llamada sea síncrona.

## 2. Lecturas directas verificadas

API oficial de `https://scheker.chaiconsultoria.com`, autenticada con la conexión ya configurada. Prueba de solo lectura del 16/10/2026 a las 14:41:58 UTC (10:41:58 RD), compañía 1. El conector disponible no permite seleccionar esta instancia; se utilizó XML-RPC oficial mediante terminal.

| Modelo / método | Resultado | Tiempo de esa llamada |
| --- | --- | --- |
| `product.product.search_read` | 5 productos; campos de identidad, nombre, unidad, categoría y tipo | 495 ms |
| `stock.location.search_read` | 5 ubicaciones internas con jerarquía y almacén | 175 ms |
| `stock.quant.read_group` | 5 grupos producto/ubicación con suma física y reservada | 157 ms |
| `stock.picking.fields_get` | Disponibles estado, movimientos, líneas, backorder, tipo y ubicaciones | 141 ms |
| `stock.move.fields_get` | Disponibles producto, unidad, demanda, cantidad, líneas y estado | 109 ms |
| `purchase.order.fields_get` | Disponibles estado, líneas, recepciones, facturas, total y moneda | 105 ms |

Las cifras son muestras de llamadas desde terminal, sin incluir una nueva Edge Function ni la carga completa de una pantalla. No certifican rendimiento bajo concurrencia ni escrituras. No se guardaron credenciales ni datos personales en esta evaluación.

## 3. Helper y archivos nuevos propuestos

| Archivo propuesto | Responsabilidad |
| --- | --- |
| `src/shared/services/odoo-api.service.ts` | Transporte tipado a `functions.invoke('odoo-api')`; traduce errores y conserva el cliente de práctica de SGC. |
| `src/shared/models/odoo.model.ts` | Referencias explícitas de instancia/modelo/ID, filtros paginados y resultados tipados. No reutilizar un UUID local como si fuera un ID Odoo. |
| `supabase/functions/odoo-api/index.ts` | Autenticar usuario SGC, autorizar acción/compañía/ubicación y despachar acciones permitidas. |
| `supabase/functions/_shared/odoo-client.ts` | Credenciales exclusivamente servidor; XML-RPC o protocolo compatible verificado, tiempos límite y manejo de errores. |
| `supabase/functions/_shared/odoo-inventario.ts` | Consultas agregadas y operaciones de recepción, reserva, traslado, devolución y ajuste mediante reglas de Odoo. |
| `supabase/functions/_shared/odoo-compras.ts` | Cotizaciones/OC y sus transiciones; detalle de líneas y vínculo con recepciones/facturas. |

Acciones de dominio sugeridas: `productos.buscar`, `ubicaciones.listar`, `stock.consultar`, `compras.obtener`, `transferencias.reservar`, `transferencias.despachar`, `transferencias.recibir`, `conteos.aplicar`. El navegador no envía libremente un modelo, método, dominio o compañía que el servidor ejecute con la cuenta técnica.

Los servicios actuales pueden mantenerse como fachada para reducir cambios de pantallas. Sus contratos y DTO deben adaptarse explícitamente; no es seguro interceptar globalmente `.from()` para intentar traducir PostgREST a Odoo.

## 4. Código que debe modificarse

Las rutas son relativas a la raíz del repositorio. Los números corresponden a la revisión examinada.

| Código actual | Sustitución propuesta | Acoplamiento que hay que separar |
| --- | --- | --- |
| `src/shared/services/articulos.service.ts:37`, `:49` | `getAll/getById` leen variantes `product.product` y su plantilla cuando se requiera. | `create` en `:67` genera código local y luego hace otro UPDATE; sustituir por alta ERP que devuelva la variante real. Alias, talla y reglas de entrega son extensión SGC o campos personalizados Odoo. |
| `src/shared/services/proveedores.service.ts:60`, `:78`, `:90` | Consulta y CRUD autorizado sobre `res.partner`. | `getFerreterias` usa un permiso/selección de choferes local: conservar esa regla como metadato con referencia Odoo. |
| `src/shared/services/categorias.service.ts:11`, `:36` | Leer árbol de `product.category`; altas/cambios permitidos en Odoo. | No enviar `activo`, `destacada` u `orden` como campos estándar: no aparecen en el catálogo real capturado de este modelo. |
| `src/shared/services/unidades.service.ts:10`, `:30` | Leer `uom.uom`; usar categoría, factor y redondeo oficiales. | El `codigo` local no es un campo estándar del modelo inspeccionado. Cambiar los formularios y contratos que identifican una unidad por texto. |
| `src/shared/services/bodegas.service.ts:60`, `:75`, `:102`, `:145`, `:157` | Ubicaciones/almacenes y movimientos directamente de Odoo; stock por `stock.quant`. | Encargado, proyecto y coordenadas operativas pueden ser extensión SGC. `fusionar_almacenes` (`:188`) no equivale a una simple escritura Odoo: retirar ese flujo del modo directo y diseñar regularización específica. |
| `src/shared/services/stock.service.ts:19`, `:28`, `:58` | Consultar/agrupar `stock.quant` por producto y ubicación, con compañía y alcance autorizados. | `getReposicion` (`:44`) mezcla mínimo/kit de obra con saldo local. Puede combinar el objetivo SGC con disponibilidad consultada en Odoo, sin leer `stock_por_bodega`. |
| `src/shared/services/inventario-almacen.service.ts:72`, `:111` | Inventario y kardex desde quants/movimientos Odoo. | `setApertura`, `ajusteRealStock` y variantes por lote no deben conservar la semántica de cambiar una base local sin movimiento ERP. Sustituir por ajustes de inventario trazables. |
| `src/shared/services/conteos.service.ts:47`, `:59`–`:87` | Leer el saldo de Odoo y enviar el conteo/ajuste a Odoo. | Conservar la captura ciega, responsables y evidencias si son propias de SGC, pero con referencias ERP y sin aplicar stock local. |
| `src/shared/services/ordenes-compra.service.ts:25`, `:36`, `:48`, `:75` | Leer/crear/confirmar/cancelar `purchase.order` y líneas mediante el gateway. | Un estado local `recibida` no se traduce automáticamente a `purchase.order.state`; derivarlo de recepciones y cantidades. Impuestos, moneda y totales deben resolverse en Odoo. |
| `src/shared/services/solicitudes-compra.service.ts:69` | Aprobación SGC seguida de creación/acción ERP idempotente y vínculo con la solicitud. | El RPC actual crea una OC local. Mantener solicitud/aprobación, sustituir esa creación. |
| `src/shared/services/entradas.service.ts:31`, `:45`, `:59`, `:150`, `:161` | Lectura y validación de recepciones Odoo con cantidades reales, líneas y parciales. | Separar foto/firma/confirmador del movimiento ERP. No releer una nueva `entradas_inventario` local después de la operación para fabricar la respuesta. |
| `src/shared/services/salidas.service.ts:83`, `:221`, `:244`, `:411`, `:702` | Lectura y transiciones de pickings/movimientos ERP; traslados y devoluciones según ruta. | Firmas, chofer, vehículo y ruta son operación SGC. Distinguir su documento de un picking y admitir varias etapas ERP por conduce. |
| `src/shared/services/solicitudes-material.service.ts:135`, `:201`, `:209`, `:309` | Mantener requisiciones; resolver reserva, cobertura y material a cargo con documentos/resultados Odoo. | Sustituir `aprobar_requisicion`, la búsqueda local de nombres en `:215` y las consultas de avance que dependan de stock/documentos ERP locales. |
| `src/shared/services/proyectos.service.ts:388` y `src/shared/services/obra-produccion.service.ts:512` | Consultar el indicador o documento económico correspondiente en Odoo. | Separar OC comprometida, recepción, consumo y gasto contable; conservar los procesos de construcción de SGC. |

### Consultas fuera de las fachadas

La búsqueda estática de `.from(...)` sobre once tablas ERP/inventario examinadas encontró **63 ocurrencias en 20 archivos**, incluyendo lecturas y escrituras. Es un inventario parcial de esos accesos literales, no un conteo exhaustivo de dependencias SQL ni de consumidores externos.

Además de los servicios, hay que cambiar:

- `src/app/pages/dashboard/dashboard.ts:553`–`:593`: catálogo, stock, entradas, salidas y compras.
- `src/app/pages/compras/reportes/reportes.ts:115` y `:118`.
- `src/app/pages/inventario/reportes/reportes.ts:242` y `:247`.
- `src/app/pages/proyectos/lista/lista.ts:1027` y `:1028`.
- `src/app/pages/inventario/retiros/retiros.ts:154`.
- `supabase/functions/assistant/index.ts`: herramientas de búsqueda de artículos, almacenes, stock y movimientos, además de sus acciones; referencias directas en `:727`, `:759`, `:821` y RPC de inventario en `:281` y `:805`.
- `supabase/functions/notificar-entrega/index.ts:78`: rehacer la composición de datos usando referencia ERP + evidencia SGC, conservando la autorización existente para notificar.

Redirigir únicamente `StockService` dejaría pantallas, asistente y mensajes consultando el sistema anterior.

## 5. El cambio de IDs exige modificar SQL y DTO

El código actual utiliza UUID SGC para artículo, bodega y documentos; Odoo utiliza IDs numéricos con contexto de instancia/modelo. Por ejemplo:

- `sql/2026-07-02-solicitudes.sql:60` contiene una FK desde el ítem de requisición hacia `sgc.articulos`; `:106` convierte el ID recibido a UUID.
- `sql/2026-09-05-bj4-despacho-parcial-requisicion.sql:155` convierte artículo a UUID y `:172` consulta `stock_por_bodega` para decidir disponibilidad.
- `sql/2026-10-14-co15-co3-co5-combustible-conduce-antidup.sql:419` recibe bodega UUID y en `:478` consulta el artículo local.
- `sql/2026-10-08-cj6-recepcion-unificada.sql:12` combina actualización de salida, entrada automática en obra y evidencias; no puede seguir ejecutando la parte de inventario al validar una recepción remota.

Para nuevos ítems de requisición y documentos de campo, admitir referencias Odoo explícitas y verificadas por el servidor. En la transición, conservar la FK legacy nullable para historia y exigir exactamente una identidad de origen válida. La lectura del flujo nuevo utiliza exclusivamente la referencia ERP, sin resolverla consultando un catálogo SGC.

El stock y la existencia remota del producto no se pueden garantizar con una FK entre bases. La operación ERP debe validar producto, unidad, ubicación, compañía y disponibilidad en Odoo. Las referencias guardadas pueden usar `bigint`; el contrato JavaScript debe preservar el entero sin pérdida, mediante cadena decimal o validación de entero seguro.

La homologación sigue siendo necesaria para asociar historia y solicitudes abiertas con los productos/ubicaciones correctos. No es necesario crear réplicas de todos los registros para empezar un flujo nuevo que seleccione directamente productos Odoo.

## 6. Qué tablas pueden dejar de usarse

| Tabla o grupo actual | Destino del flujo nuevo |
| --- | --- |
| `stock_por_bodega`, `stock_apertura` | Fuera del camino nuevo; histórico legado tras el corte. No construir una réplica equivalente obligatoria. |
| `articulos`, `proveedores`, `unidades`, `categorias_inventario`, `bodegas` | Catálogo ERP legado; sus consultas nuevas van al gateway. Migrar atributos propios de SGC a extensiones referenciadas por identidad Odoo. |
| `ordenes_compra`, `orden_compra_items` | Odoo contiene OC y líneas; conservar historia y enlaces con solicitudes anteriores. |
| `entradas_inventario`, `salidas_inventario` y sus detalles | La parte de libro de stock/documento ERP puede retirarse del flujo nuevo. No declarar todo el grupo prescindible antes de extraer firmas, rutas, material libre y demás dependencias operativas. |
| Requisiciones, aprobaciones, rutas, firmas, fotos, usuarios y proyectos SGC | Permanecen como procesos propios. Sus relaciones con entidades ERP dejan de depender de las tablas de catálogo antiguas. |

No eliminar tablas durante este cambio. Retirar sus lectores y escritores, resolver referencias y consumidores externos, preservar la historia y marcar el alcance migrado. Sin fallback automático a datos o stock locales si falla Odoo.

En este diseño no son requisito las tablas de proyección completa propuestas antes (`odoo_stock_quants` u otras copias operativas). Tampoco lo son las 61 columnas nuevas en maestros que salgan del camino nuevo. El paquete del issue #20 conserva utilidad para enlazar legado y otros alcances; revisar su alcance antes de promoverlo como prerequisito de este diseño.

## 7. Metadatos que realmente permanecen en SGC

- Contexto de conexión/entorno sin credenciales expuestas y relación proyecto SGC ↔ ubicación/proyecto/analítica Odoo.
- Reglas y atributos de campo como talla obligatoria, entrega en mano, alias, favoritos y encargado. Pueden trasladarse a campos personalizados Odoo si se desea que también residan allí.
- Evidencias y logística asociadas a referencias de picking/movimiento/OC, sin consultar sus antiguas cabeceras ERP locales.
- Identidad y resultado de cada comando de escritura para auditoría y resolución de timeout. Es trazabilidad de una petición directa, no una cola obligatoria de sincronización.

El catálogo de campos Odoo capturado el 16/10 confirma que `requiere_talla`, `entrega_en_mano` y `propiedad` no aparecen con esos nombres en `product.product`; `proyecto_id` y `encargado_id` no aparecen en `stock.location`. Por tanto, esos atributos requieren extensión o un mapeo funcional explícito.

## 8. Escrituras directas y fallos

El gateway debe ejecutar acciones de negocio Odoo y devolver IDs/estados confirmados. Para acciones compuestas recomiendo un módulo Odoo pequeño: comando único por instancia/origen + clave, huella del payload y resultado. La misma transacción registra el comando y aplica su acción; una repetición devuelve el resultado previo y un payload diferente con la misma clave se rechaza.

No existe una transacción distribuida automática entre una llamada HTTP a Odoo y una escritura Supabase. Si Odoo confirma y falla el registro de evidencia/vínculo local, la reparación debe partir del mismo comando y recuperar el resultado ERP. Ante timeout, el estado es incierto hasta comprobarlo; no repetir a ciegas.

Las lecturas son viables con la API actual, sin instalar ese módulo. Las mutaciones simples pueden usar acciones existentes, pero no se certificó todavía su idempotencia ni las reglas de esta instancia. Las operaciones compuestas deben agrupar validación y efecto dentro de Odoo para evitar carreras entre consultar disponibilidad y despachar.

## 9. Orden de sustitución y pruebas

1. Crear contratos y gateway; probar consultas de catálogo/ubicación/stock desde una pantalla de solo lectura, sin tabla espejo ni fallback. Mantener escrituras legacy fuera de esa pantalla: IDs nativos no deben enviarse a RPC UUID.
2. Migrar un circuito completo de reserva, despacho, tránsito y recepción, con todas sus evidencias; dejar de ejecutar sus triggers/funciones de stock local. Migrar los clientes que compartan esos RPC, incluida la app de campo antes de retirarlos globalmente.
3. Adaptar compras, conteos, devoluciones, asistente, dashboard y reportes; resolver consumos/costos según el criterio contable.
4. Retirar accesos del alcance migrado, manteniendo legado consultable explícitamente como histórico.

Pruebas necesarias:

- Fallar la prueba si el flujo directo llama `.from()` sobre las tablas ERP retiradas, en frontend o gateway; comprobar también que no ejecuta sus RPC/ajustes locales.
- Verificar que dos reservas/despachos concurrentes y un timeout posterior al éxito no generan duplicados ni exceden la política de disponibilidad acordada.
- Comprobar recepción parcial, pendiente/backorder, devoluciones y un cambio hecho directamente en Odoo visible en la siguiente consulta.
- Comprobar permisos por compañía/proyecto/ubicación en el servidor, aunque la cuenta técnica tenga permisos amplios.
- Conservar `SupabaseService.client` y su interceptación de práctica. `PracticaClienteService` ya intercepta Edge Functions (`:108`); agregar escenarios y registro de acciones simuladas, sin hacer llamadas reales a Odoo en práctica.
- Medir una pantalla paginada con consultas agrupadas. No sustituir un listado local por una llamada Odoo por cada fila.

Todo despliegue/secret/migración primero en Supabase dev y con una base Odoo de pruebas; después prueba funcional en `dev.sgcconstructorasd.com` y promoción según `docs/ENTORNOS.md`.

## 10. Referencias

- [API externa de Odoo 17](https://www.odoo.com/documentation/17.0/fr/developer/reference/external_api.html): `execute_kw`, consultas y `search_read`.
- [ORM de Odoo 17](https://www.odoo.com/documentation/17.0/developer/reference/backend/orm.html): operaciones y transacciones del servidor.
- `docs/MAPA-ODOO-INVENTARIO.md`: inventario previo de flujos y puntos SQL; su autoridad transitoria SGC queda sustituida para el diseño directo evaluado aquí.
- `docs/odoo-schema/README.md`: alcance del paquete aditivo preparado; no implementa este gateway.
- `scratchpad/odoo-comparison-2026-10-16/*-fields.json`: catálogo de campos capturado y consultado para distinguir campos oficiales de extensiones SGC.
