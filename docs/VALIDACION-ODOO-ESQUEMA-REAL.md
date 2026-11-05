# Validación de la propuesta Odoo contra Supabase real

Inspección: 15/10/2026, entre 10:20 y 10:28, America/Santo_Domingo. Propuesta contrastada: [MAPA-ODOO-INVENTARIO.md](MAPA-ODOO-INVENTARIO.md). Checkout: `f755dbfed1f8adcb740a852d59b4eabdcc4c0350`.

**Resultado: la Fase 0 de identidades es compatible con la estructura actual, con ajustes de tipos, unidades y permisos. La sincronización de compras/stock todavía no está validada de punta a punta y necesita resolver los casos siguientes antes de publicar movimientos.** No se aplicaron migraciones ni se ejecutaron RPC de negocio.

## Alcance y evidencia

Se inspeccionaron directamente catálogo PostgreSQL, restricciones, índices, RLS, triggers, cuerpos de funciones relevantes y conteos agregados:

| Entorno | Proyecto | Tablas en `sgc` | Columnas | Funciones |
| --- | --- | ---: | ---: | ---: |
| Producción, csd-core | `jeeqhgccqefbqilntcpu` | 306 | 3.345 | 981 |
| Desarrollo, sgc-dev | `fzfrnrvndzrjwyvdpkgg` | 307 | 3.349 | 986 |

El conector Supabase no pudo consultar con su identidad conectada; se usó el endpoint oficial `/v1/projects/{ref}/database/query/read-only` con la credencial autorizada de Doppler. Ambos entornos confirmaron `current_user = supabase_read_only_user` y `transaction_read_only = on`. El rol tiene `BYPASSRLS`: los conteos no representan únicamente las filas visibles para un usuario de Angular. Esta inspección no prueba permisos efectivos de cada perfil de la aplicación.

Evidencia local sin credenciales: `.codegraph/odoo-reality/2026-10-15/`. Consultas reproducibles en `queries/`; resultados en `prod-*` y `dev-*`; comparación normalizada en `schema-diff-normalized.json`. Se consultó producción activa en varias solicitudes, no una única instantánea transaccional entre todos los archivos. Los conteos incluyen registros de prueba salvo indicación explícita.

## 1. Identidades: viable, pero todavía no hay vínculos para aprovechar

| Tabla | Producción | Desarrollo | Identidad actual | Evaluación |
| --- | ---: | ---: | --- | --- |
| `proveedores` | 1.576 | 7 | PK UUID; `odoo_ref text` opcional | Agregar contexto + ID nativo sin cambiar la PK. |
| `articulos` | 282 | 276 | PK UUID; `odoo_ref text` opcional | Separar ID de variante y plantilla. |
| `vehiculos` | 24 | 24 | PK UUID; `odoo_ref text` opcional | Vinculación posible; circuito de flota separado del stock de materiales. |
| `categorias_inventario` | 30 | 30 | **PK integer**; padre con FK | La relación auxiliar no puede asumir UUID para toda entidad. |
| `unidades` | 33 | 33 | **PK integer**; código único | Reconciliar equivalencias antes de vincular. |
| `bodegas` | 26 | 26 | PK UUID | Elegir explícitamente ubicación/almacén ERP y destino SGC. |

Los tres `odoo_ref` tienen índice único parcial para valores no nulos. **Ninguna fila tiene `odoo_ref` informado en ninguno de los dos entornos.** Tampoco existen columnas de ID nativo, contexto `odoo_instancias` ni vínculos Odoo en el esquema `sgc`. La revisión de nombres de tablas en esquemas no internos no encontró una cola Odoo identificable por nombre.

Consecuencias:

- No hay una correspondencia existente que pueda migrarse automáticamente. Resolver identidades contra la base Odoo autorizada; conservar `odoo_ref` y no interpretar números por su apariencia.
- Solo **3 de 1.576 proveedores** tienen RNC no vacío. No hay grupos duplicados de RNC normalizado entre esos tres, pero el RNC no cubre la reconciliación del catálogo. No fusionar por nombre automáticamente.
- Los códigos de artículos no tienen duplicados al normalizar espacios externos y mayúsculas; esto no demuestra identidad con productos ERP.
- Los importadores desplegados existen en ambos entornos. `importar_articulos` enlaza `odoo_ref` al encontrar un artículo existente, pero **no actualiza nombre/código/categoría/unidad** en esa rama. No sirve todavía como consumidor general de cambios de Odoo.

La extensión propuesta debe imponer ID positivo, contexto requerido cuando haya ID y unicidad por instancia/modelo para relaciones uno a uno. No imponer unicidad a la plantilla compartida por variantes. Proteger las nuevas referencias: los permisos actuales de actualización por fila en maestros no distinguen una futura columna de identidad ERP de otros campos editables. Usar escritura restringida o tablas de vínculo con permisos propios y FKs tipadas.

Evidencia: `*-catalog.json`, `*-quality.json`, `*-functions.json`.

## 2. Unidades y ubicaciones: reconciliar antes de cualquier movimiento

`articulos.categoria_id` sí tiene FK a categorías. **`articulos.unidad` es texto obligatorio sin FK a `unidades`.** En producción:

- 11 artículos no coinciden exactamente con un código del catálogo.
- 10 siguen sin coincidencia al ignorar mayúsculas y espacios externos: `32` (1), `50` (1), `79` (1), `u` (6), `Uni` (1).
- 17 artículos declaran empaque; ninguno de esos 17 tiene factor nulo o no positivo. Esto no acredita equivalencia dimensional con Odoo.

No interpretar `32`, `50` o `79` como IDs ERP. Preparar equivalencias revisables y definir cómo tratar alias; no agregar una FK/unicidad nueva sin reconciliar primero estos valores. Dev tiene 5 artículos sin coincidencia normalizada, por lo que no reproduce toda la casuística de producción.

De los 16 proyectos con bodegas, **8 tienen dos bodegas**. El cuerpo desplegado de `_aplicar_recepcion_salida` obtiene una bodega por `proyecto_id ... LIMIT 1`, sin un orden ni selección explícita de destino en esa consulta. Ese helper debe revisarse antes de usar su elección para fijar una ubicación ERP: proyecto no identifica unívocamente bodega.

Hay además 23 salidas sin proyecto ni almacén destino estructurado, ninguna con `destino_texto` informado; incluyen anuladas y pruebas, y **9 no anuladas marcadas como reales**. Clasificarlas por propósito antes de decidir si son traslado, consumo u otro movimiento. La falta de destino no prueba por sí sola un error operativo.

Evidencia: `prod-followup.json`, `prod-functions.json`, `*-quality.json`.

## 3. Compras y recepciones: falta probar el vínculo por renglón

| Tabla/caso | Producción | Desarrollo |
| --- | ---: | ---: |
| `ordenes_compra` | 4 | 4 |
| `orden_compra_items` | 4 | 4 |
| Líneas OC sin `articulo_id` | **4** | **4** |
| `entradas_inventario` | 121 | 29 |
| `detalle_entradas` | 293 | **0** |
| Entradas con `orden_compra_id` | **0** | **0** |

Las cuatro OC incluyen dos borradores reales, un borrador de prueba y una OC marcada recibida real, en ambos entornos. El estado «recibida» no acredita una recepción vinculada: ninguna entrada referencia una OC.

La estructura propuesta de ID ERP en cabecera y línea OC es compatible. Sin embargo, `detalle_entradas` solo identifica entrada y artículo; **no referencia `orden_compra_items`**. Las líneas libres pueden ser legítimas, pero requieren clasificar material/servicio y resolver producto/unidad para una recepción inventariable. Emparejar únicamente por artículo tampoco resuelve dos renglones del mismo producto, parciales o diferencias de precio/unidad.

Ajuste a la propuesta: incorporar identidad de línea de origen mediante FK opcional o asignaciones tipadas si una línea recibida cubre varias líneas OC. Mantener vínculos ERP separados por recepción/movimiento y sus parciales. La cardinalidad definitiva debe probarse con ejemplos de negocio.

Los cuerpos activos confirman:

- `aprobar_solicitud_compra` llama a `crear_orden_compra`: emitir la creación una vez en el punto canónico, no en ambos RPC.
- Hay **dos sobrecargas de `registrar_entrada_inventario`**, de 8 y 10 argumentos; sus validaciones no son idénticas. Una migración que modifique solo una dejaría otro camino de escritura fuera del contrato.
- Dev contiene 29 cabeceras de entrada sin detalles; 24 no están pendientes ni rechazadas. No es una muestra suficiente para validar materialización, parciales o conciliación de stock. Esta inspección no determinó por qué quedaron así.

Evidencia: `*-counts.json`, `*-quality.json`, `*-functions.json`.

## 4. Salidas y entradas: conservar una sola operación física

Producción contiene **212 salidas y 616 renglones**. De las 121 entradas, **92 enlazan una salida**; no hay múltiples entradas con el mismo `salida_id` en los datos inspeccionados. Ese vínculo confirma la necesidad de tratar salida/recepción como etapas de un traslado, evitando publicar la entrada otra vez como compra independiente.

Dos límites concretos del contrato de eventos:

1. `SalidasService.create()` ejecuta el RPC y luego actualiza destino/conductor/vehículo en otra petición (`src/shared/services/salidas.service.ts:411–461`). Emitir al insertar la cabecera puede capturar un destino incompleto. Incorporar el payload necesario al RPC o usar una transición validada en servidor antes de publicar.
2. Hay **82 salidas reales** en `entregado_incompleto`: 79 tienen algún renglón con `cantidad_recibida IS NULL`; solo 3 tienen algún renglón con cantidad explícitamente menor que la despachada. `entregar_conduce` considera incompleta también una cantidad nula. No traducir automáticamente ese estado a un faltante cuantificado ni completar nulos por inferencia.

El anti-duplicado de 120 segundos en `registrar_salida_inventario` no proporciona idempotencia durable frente a reintentos de integración. Se necesitan evento/revisión estables y reconciliación ERP ante resultado incierto.

Evidencia: `prod-counts.json`, `prod-quality.json`, `prod-followup.json`, `prod-functions.json`, `prod-stock-functions.json` y servicio Angular citado.

## 5. Separación de pruebas: comprobar la cadena completa

Hay **3 entradas `es_prueba=false` enlazadas a salidas `es_prueba=true`**: dos salidas incompletas y una anulada. Esto no cuantifica por sí solo un saldo incorrecto, pero impide confiar únicamente en la bandera de la entrada para exportar historia.

Los triggers de detalle incrementan/descuentan stock según la bandera de su propia cabecera. El trigger de herencia inspecciona vehículo/conductor/proyecto/bodega; no hereda por `salida_id`. Antes de habilitar eventos, validar cabecera, origen, líneas y contexto; mandar a revisión una discrepancia real/prueba. No corregirla silenciosamente ni publicar a la compañía real.

No se alteraron estas filas ni se reconstruyeron sus saldos históricos.

## 6. Stock, conteos, retiros y cola

| Grupo | Realidad | Evaluación de la propuesta |
| --- | --- | --- |
| `stock_por_bodega` | Tabla persistida, PK artículo+bodega; 3.439 filas prod / 2.913 dev; sin cantidades negativas al consultar | No reemplazarla por escrituras remotas de saldo sin acordar autoridad, corte y reconciliación. |
| `stock_apertura` | 3.416 filas prod / 2.895 dev | No sumar apertura y volver a reproducir la misma historia como movimientos ERP. |
| Conteos y líneas | 25 / 2.300 prod; 9 / 51 dev | Hay material para diseñar vínculos, pero no se ejecutó aplicar/deshacer. Sincronizar el hecho aplicado y su compensación. |
| Retiros y cuarentena | Sin filas en las tablas inspeccionadas de ambos entornos | La estructura existe; no hay evidencia de uso con la cual validar la equivalencia ERP. |
| Conduces externos | 3 prod / 2 dev, todos sin efecto inventariable ni salida/entrada vinculada | Estos datos no validan el camino externo con movimiento de stock. |
| `outbox_atascados` y relacionadas | Reportes de operaciones móviles atascadas, errores y recuperación | No acreditan una cola ERP durable con revisión, dependencias, reclamación y resultado incierto. |

Proveedores, categorías, unidades y bodegas no tienen todos un `updated_at` utilizable; líneas OC tampoco. Un poll genérico por esa columna perdería cambios. Mantener la propuesta de outbox transaccional y añadir un contrato de aplicación entrante que evite bucles, con propietario por campo y control de revisión/conflicto. Un webhook futuro debe alimentar ese mismo contrato.

## 7. Comparación dev/prod

En las tablas compartidas, los tipos, nulabilidad y valores por defecto coinciden al excluir el orden físico de columnas. Los cuatro CHECK con diferencias de representación conservan los mismos valores/límites. Los índices, triggers y políticas compartidos comparados coinciden.

Dev agrega `dev_acceso`, cinco funciones y dos políticas. Cinco cuerpos compartidos difieren para filtrar usuarios/datos demo: `choferes_activos`, `listar_mantenimientos`, `listar_proveedores_para_flota`, `mis_choferes_panel` y `trabajos_transporte_listado`. Los cuerpos de los RPC de compras/recepciones/importación contrastados coinciden entre entornos.

Hay también **127 firmas compartidas con diferencias en ACL explícitas**, después de ordenar las listas de permisos. Muchas involucran grants redundantes por `PUBLIC`; no se interpretaron automáticamente como diferencias efectivas de acceso. No afirmar paridad global de permisos. Las consultas con rol de lectura tampoco prueban que una nueva política permita o impida correctamente editar vínculos desde cada perfil.

## 8. Qué podemos aprobar y qué falta demostrar

| Propuesta | Resultado de esta revisión | Condición para continuar |
| --- | --- | --- |
| Contexto Odoo + identidad nativa en maestros/OC | **Viable estructuralmente** | FKs con tipos reales; identidad protegida; resolver registros ERP sin inferir IDs. |
| Vínculos auxiliares para stock/parciales | **Necesarios** | Definir cardinalidad de línea OC/recepción y etapas del traslado. |
| Outbox en la transacción de negocio | **Sigue siendo adecuada** | Cubrir sobrecargas y caminos internos; payload completo; idempotencia y anti-bucle. |
| Exportar historia automáticamente | **No habilitar todavía** | Reconciliar unidades, destino, cantidades desconocidas y cadena real/prueba; decidir corte de stock. |
| Sync bidireccional de stock | **No demostrado** | Autoridad por operación/campo, conflictos, reservas y pruebas de concurrencia con Odoo del proyecto. |

Orden recomendado para el siguiente corte en `feature/*`, pasando primero por dev:

1. Fase 0: contexto y vínculos opcionales con restricciones/permisos; conservar las PK y escritores existentes. Elegir proveedor, variante, unidad, bodega y OC de ejemplo con identidad verificada.
2. Preparar datos sintéticos en dev con OC y renglones catalogados, dos líneas del mismo artículo, recepción parcial y saldo comprobable. No copiar datos personales de producción como fixture.
3. Completar la relación de línea recibida y la selección explícita de bodega; fijar el momento transaccional en que una salida está lista.
4. Probar OC directa/convertida sin duplicación; recepción parcial reutilizando documentos ERP; timeout/reintento; no publicar prueba ni cadenas mixtas. Después probar traslado con dos bodegas posibles, cantidad recibida desconocida y anulación/compensación.

La revisión acredita estructura y datos observados, **no una migración aplicada ni una sincronización funcional**. No se consultó una instancia Odoo para resolver IDs, confirmar versión/módulos o ejecutar acciones; esa parte sigue pendiente.
