# Anexo técnico de inventario SGC y Odoo

Fecha del corte: 16/10/2026. Complementa el resumen para Eduardo y Contabilidad.

**Resultado:** se consultaron ambos sistemas vivos en solo lectura. Hay **17 candidatos por nombre exacto**, de los cuales **7 tienen unidad compatible por definición**; solo 5 de esos 7 están activos en SGC. **No hay identidades de producto ni ubicaciones homologadas con evidencia suficiente: 0 diferencias de cantidades certificables.** Esto no demuestra igualdad de saldos ni ausencia de productos en un sistema.

**Estado para Contabilidad:** soluciones F01-F16 pendientes de aprobación. El resumen ejecutivo se entrega por separado. Este anexo conserva la evidencia del corte, los ejemplos, efectos y propuestas; no acredita cambios aplicados.

## Alcance y trazabilidad

- **Principal:** SGC producción, `csd-core` / `jeeqhgccqefbqilntcpu`, snapshot SQL único del **16/10/2026 11:34:03.774604 UTC / 07:34:03.774604 RD**.
- **Control separado:** SGC desarrollo, `sgc-dev` / `fzfrnrvndzrjwyvdpkgg`, **11:34:04.860483 UTC**. Sus saldos no se utilizaron para comparar con Odoo producción.
- **Odoo:** [scheker.chaiconsultoria.com](https://scheker.chaiconsultoria.com), base del mismo nombre, **Enterprise 17.0+e**, cuenta configurada de Eduardo, `uid=10`, compañía `res.company(1)` **CONSTRUCTORA SCHEKER & DOMINGUEZ SRL**. Captura **11:31:42–11:31:56 UTC / 07:31:42–07:31:56 RD**; comprobación adicional de códigos posterior, con hora en su JSON.
- El conector nativo Supabase solo mostró otro proyecto y rechazó la consulta SGC por permisos. Se usó la API oficial `POST /v1/projects/{ref}/database/query/read-only`. Ambos snapshots confirman `supabase_read_only_user` y `transaction_read_only=on`; el probe de producción confirma `BYPASSRLS`, por lo que no son conteos limitados al perfil Angular.
- XML-RPC oficial de Odoo: `version`, `authenticate`, `fields_get`, `search_count`, `search_read`; paginación de **500 filas**, orden `id asc`, `active_test=false`, `lang=en_US`. Conteos antes/después de cada catálogo coinciden con las filas descargadas. Sin errores de captura. El conector Odoo disponible apuntaba a otra instancia.
- No se modificaron datos, permisos, credenciales, esquema, configuración ni integración. `odoo_ref` se conserva intacto. No se ejecutaron movimientos ni reconciliaciones.

La captura Odoo consta de varias lecturas y no forma una transacción común con SGC. Los horarios difieren aproximadamente dos minutos. No se atribuye una eventual diferencia a sincronización sin un corte temporal acordado.

## Conteos: distinguir catálogo, saldo y quant

| Entidad/grano | SGC prod | SGC dev | Odoo de la compañía indicada |
| --- | ---: | ---: | ---: |
| Artículos / variantes `product.product` | 282 | 276 | 1.149 |
| Artículos / variantes activos | 206 | 199 | 1.014 |
| Artículos / variantes inactivos/archivados | 76 | 77 | 135 |
| Artículos marcados de prueba | 0 | 3 | Sin bandera equivalente consultada |
| Plantillas `product.template` | No aplica | No aplica | 1.149 |
| Unidades | 33 | 33 | 31 |
| Categorías | 30 | 30 | 41 |
| Bodegas / almacenes `stock.warehouse` | 26 | 26 | 23 |
| Bodegas / almacenes activos | 18 | 18 | 23 |
| Bodegas activas reales, excluyendo prueba | 15 | 15 | Sin clasificación de prueba confirmada |
| Ubicaciones `stock.location` | Sin modelo independiente equivalente | Igual | 148; 115 internas, 23 de ellas activas |
| `stock_por_bodega`: saldo actual por artículo+bodega | **3.444 filas** | **2.913 filas** | No equivale a un conteo de quants |
| `stock_apertura`: apertura por artículo+bodega | **3.416 filas** | **2.895 filas** | No se suma al saldo actual |
| `stock.quant`: todas las clases de ubicación | No aplica | No aplica | 1.638 |
| `stock.quant`: solo ubicación interna | No aplica | No aplica | **741**, de 498 productos y 13 ubicaciones |

Las 3.444 y 3.416 son **filas de saldos**, no movimientos ni totales de unidades físicas. Los quants pueden distinguir ubicación, lote, paquete y propietario: para compararlos habría que agregarlos al grano homologado. Nunca sumar cantidades de productos/unidades distintos.

Odoo separa tipos de producto:

| `detailed_type` | Activos | Archivados | Total |
| --- | ---: | ---: | ---: |
| Almacenable, `product` | 754 | 60 | **814** |
| Consumible, `consu` | 174 | 74 | **248** |
| Servicio, `service` | 86 | 1 | **87** |

El catálogo Odoo incluye servicios y un alcance comercial mayor. **282 frente a 1.149 no significa 867 faltantes.** Los 741 quants internos son positivos, sin negativos ni disponible negativo; 5 pertenecen a productos archivados. Los negativos de proveedores/clientes/ajustes quedan fuera de ese análisis.

## Productos: cobertura y referencias ambiguas

Regla automática conservadora: comparar código SGC con `default_code`/`code` Odoo; para nombres, únicamente `strip().casefold()`. No se eliminaron palabras, medidas o signos ni se usó similitud semántica. Los nombres exactos son candidatos de revisión, no identidad nativa aprobada.

- `odoo_ref` informado: **0/282 prod**, **0/276 dev**. El esquema vivo consultado de maestros no contiene aún las columnas nativas propuestas en el mapa.
- Odoo tiene **2/1.149 referencias internas informadas** (`ESTENCIONES`, `EPECO`) y **0 códigos de barras**. Ninguna referencia coincide con los códigos SGC.
- **17/282 (6,0 %) candidatos únicos por nombre exacto**; **265/282 sin candidato exacto**. Esos 265 no son faltantes demostrados: faltan referencias comunes para descartarlos/resolverlos.
- SGC: 0 grupos duplicados de código y 0 de nombre normalizado. Odoo: 0 grupos duplicados de referencia interna no vacía, pero **26 grupos de nombres duplicados**. Ninguno de los 17 candidatos cae en esos grupos. Ejemplos Odoo: `CINTA METRICA 8M` variantes 346/1009; `VARILLA ELECTRODOS 6013 3/32` variantes 313/780. No fusionar por nombre.
- **1.146/1.149 IDs de variante difieren del ID de su plantilla.** Aunque cada plantilla capturada tiene una variante, no son IDs intercambiables: `ART-0002` es candidato a variante **1142**, plantilla **1146**.
- Los otros **1.132 registros Odoo** no tienen un candidato exacto en esta matriz. Esto tampoco prueba que deban darse de alta en SGC.

| Código SGC | `product.product` / plantilla candidata | Unidad SGC → Odoo | Resultado de unidad |
| --- | --- | --- | --- |
| ALM-016 | 253 / 257 | unidad → Units(1) | Compatible; SGC inactivo |
| ALM-020 | 246 / 250 | caja → Units(1) | Contenido/criterio sin homologar |
| ALM-021 | 247 / 251 | caja → Units(1) | Contenido/criterio sin homologar |
| ALM-022 | 248 / 252 | caja → Units(1) | Contenido/criterio sin homologar |
| ALM-023 | 249 / 253 | caja → Units(1) | Contenido/criterio sin homologar |
| ART-0002 | 1142 / 1146 | unidad → Units(1) | Compatible; ambos activos |
| CSD-01-007 | 261 / 265 | par → Units(1) | Confirmar qué cuenta una unidad de guantes |
| CSD-03-020 | 892 / 896 | u → Units(1) | Alias SGC no catalogado |
| CSD-03-021 | 1070 / 1074 | u → Units(1) | Alias SGC no catalogado |
| CSD-05-018 | 1128 / 1132 | unidad → Units(1) | Compatible; ambos activos |
| CSD-05-047 | 1130 / 1134 | unidad → Units(1) | Compatible; ambos activos |
| CSD-06-015 | 294 / 298 | pie → Units(1) | Longitud frente a unidad de conteo |
| CSD-06-016 | 295 / 299 | unidad → Units(1) | Compatible; ambos activos |
| CSD-06-020 | 291 / 295 | u → Units(1) | Alias SGC no catalogado |
| CSD-06-021 | 1324 / 1328 | Uni → Units(1) | Alias SGC no catalogado |
| CSD-08-003 | 265 / 269 | unidad → Units(1) | Compatible; ambos activos |
| OFI-001 | 1294 / 1298 | unidad → Units(1) | Compatible; SGC inactivo |

La matriz privada contiene UUID, código y nombre completos de los 282 artículos. Ejemplos verificables: `ART-0002` / `ff466fc2-201a-4afe-b711-fb4e893f6647` = “GUANTE SOLDAR PIEL LARGO 10\"”; `ALM-020` / `fbe8370c-24b8-4443-9e6f-23a50b882567` = “CLAVO CORRIENTE 4\" (CAJA 50LBS)”. Que el nombre incluya una caja no prueba si Odoo cuenta cajas o clavos; no se aplicó un factor de 50 por inferencia.

## Unidades: definiciones compatibles y bloqueos

**0 vínculos persistidos.** Se identifican **14 correspondencias de definición dimensional** en el catálogo; sirven como candidatos de mapeo de unidad y no confirman por sí solas cómo cuenta cada producto:

| Códigos SGC | `uom.uom` Odoo |
| --- | --- |
| unidad / docena | Units **1** / Dozens **2** (12 Units) |
| kg / lb / tonelada | kg **12** / lb **15** / t **14** |
| m / pie / yarda / pulgada | m **5** / ft **18** / yd **19** / in **17** |
| m2 / pie2 | m² **9** / ft² **21** |
| litro / m3 / pie3 | L **10** / m³ **11** / ft³ **26** |

`paquete`→PAQUETE(54) y `funda`→FUNDA(56) son otros **2 candidatos de etiqueta**; cada uno tiene categoría propia y no acredita contenido ni conversión a Units. `galon` no especifica US/imperial; Odoo `gal (US)`(24) equivale a **3,78541 L**. Los otros 17 códigos, incluido galón, requieren acuerdo o unidad/empaque por producto.

- **10 artículos** no coinciden con el catálogo SGC ni ignorando mayúsculas/espacios externos: `u`(6), `Uni`(1), `32`(1), `50`(1), `79`(1). `Pie` sí coincide normalizado con `pie`.
- Ejemplos: `ART-0003.unidad=32`, `CSD-04-021.unidad=50`, `CSD-04-022.unidad=79`. No se interpretan como IDs Odoo.
- Odoo tiene dos “pies” de categorías diferentes: `ft(18)` pertenece a longitud y equivale a ~0,3048 m; `Pies(30)` es referencia de una categoría propia **Unidad de medidas**. No son convertibles automáticamente; 16 productos usan Pies(30).

## Bodegas y ubicaciones: matriz revisable, ninguna homologada

Hay **15 bodegas SGC activas reales** con hipótesis de correspondencia. Todas requieren validar la sede/alcance físico y guardar una identidad explícita. En Odoo sí se confirmó la relación interna **almacén → `lot_stock_id`**; eso no prueba la relación SGC → Odoo. No se asumió que todos los hijos de un almacén equivalen a su ubicación principal.

| Bodega SGC activa real | Almacén Odoo candidato → ubicación principal | Límite |
| --- | --- | --- |
| Bodega Central | WH **1** → **8** | “Principal” no prueba la misma sede |
| ALMACÉN las AMERICAS | ALMA **21** → **132** | Confirmar separación respecto de Central/WH |
| ALMACEN - SOLHE SIGNATURE CONDOS | SOLSC **23** → **144** | Nombre de obra; sin vínculo |
| Almacén - Villa Caleton #260 | VC **22** → **138** | Revisar grafía/obra; sin vínculo |
| ASA - Residencial Romo | RSR **12** → **78** | Proyecto común; sin vínculo |
| BATCON - Interplaza | INT **11** → **72** | Proyecto común; sin vínculo |
| BEST IN PRO - City Place | CITY **6** → **42** / CITY2 **7** → **48** | **Ambiguo: 1.0 frente a 2.0/colegio/plaza** |
| BLUEWAVE - Olea | Olea **9** → **60** | Proyecto común; sin vínculo |
| BLUEWAVE - Volares | VOLAR **8** → **54** | Grafías distintas; **no se da por equivalente** |
| BRISAS CITY CENTER | BCC **3** → **24** | El proyecto SGC está inactivo; la bodega sigue activa |
| NOVAL - Poseidonia | POSE **18** → **114** | Proyecto común; sin vínculo |
| NOVAL - Riviera Bay | RIVI **10** → **66** | Proyecto común; sin vínculo |
| ROSCH - Edif Adm 911 | ADM11 **2** → **18** | Proyecto común; sin vínculo |
| VISTA CANA - Monterezzo | MONT **15** → **96** | Bodega inactiva del proyecto conserva saldos |
| Torre Alpha | TA **16** → **102** | Confirmar sede SD; sin vínculo |

Esta tabla propone revisión de **16 almacenes Odoo**, debido a las dos alternativas City Place. Los otros 7 no tienen candidato en este corte: **CSJ(4), IMPRS(5), DELMA(13), RM(14), COSMO(17), MCC(19), OF VC(20)**. No se declara que falten en SGC ni se mezclan sedes por semejanza de nombres.

**Monterezzo:** `f370827c-a02c-4504-ba45-cb85e7c870ff`, “Monterezzo (fusionado)”, está inactiva y mantiene **25 filas de saldo positivo**. La activa es `b2699cc1-675e-44d5-9890-800c7d77667a`, “Almacén VISTA CANA - Monterezzo (Vista Cana)”. Comparten proyecto. No sumar, trasladar ni borrar estos saldos hasta establecer si representan existencias distintas, residuos de fusión o una duplicación. El diagnóstico no determinó esa causa. Las otras siete bodegas inactivas no tienen saldos positivos en el snapshot.

## Cantidades, reservas y pruebas

**0 pares producto+unidad+ubicación completamente homologados ⇒ 0 deltas de cantidad calculadas.** Los 5 candidatos activos con unidad compatible son un buen primer lote para revisión, pero tampoco admiten todavía una comparación exploratoria de saldos por ubicación sin introducir la hipótesis no validada Central↔WH u otra sede. No se reporta esa hipótesis como un desfase de stock.

SGC guarda `stock_por_bodega.cantidad` como saldo operativo por artículo+bodega; esa tabla no aporta columna de reserva. Odoo expone `quantity` (existencia), `reserved_quantity` y `available_quantity` (existencia menos reserva). Ejemplo real: quant **1467**, producto **286** “POLOCHE ROJO SIZE M”, ubicación **8**: **52 físicos, 25 reservados, 27 disponibles**. Comparar 52 con 27 como si fuesen el mismo concepto produciría un falso desfase de 25.

Separación de pruebas y estados en producción:

- **3 bodegas de prueba** y **540 filas de stock** con contexto de prueba por artículo o bodega. De las 3.444 filas, quedan **2.904 fuera de ese filtro básico**; no es garantía de pureza histórica.
- **3 entradas** tienen bandera real/prueba distinta de la salida vinculada. La regla de exclusión debe verificar la cadena completa.
- Hay **130 entradas** (107 reales, 23 prueba), **219 salidas** (189 reales, 30 prueba), 319 detalles de entrada y 639 de salida. Son documentos/líneas, no quants.
- **91 salidas reales** están en `entregado_incompleto`; este estado no cuantifica por sí solo una merma. No se reconstruyeron movimientos ni se rellenaron recepciones desconocidas.
- SGC contiene **9 filas de stock de artículos inactivos**; Odoo, **5 quants internos de productos archivados**. Conservarlos visibles para conciliación; archivar no equivale a saldo cero.

## Ejemplos y consecuencias por hallazgo

Los ejemplos proceden del corte conservado. F14 y las cadenas mixtas de F11 incluyen conteos agregados, porque esa captura no conserva folios; no son entregas individuales identificadas. Las cantidades citadas son saldos registrados, no un conteo físico nuevo.

### F01 0 referencias SGC; solo 2 referencias internas Odoo y 0 códigos de barras. Hay 17 candidatos por nombre y 265 artículos SGC sin candidato exacto.

- ART-0002: candidato a variante Odoo 1142, con odoo_ref SGC vacío; falta confirmar identidad técnica.
- CSD-05-018: candidato a variante Odoo 1128, también sin vínculo persistido.

**Consecuencia de aplicar cambios:** Los vínculos y altas aprobados cambian la correspondencia del catálogo. Un vínculo incorrecto atribuiría movimientos y costos a otro artículo; homologar no autoriza cambiar saldos.

### F02 En 1.146 casos el ID de variante difiere del de plantilla.

- ART-0002: variante 1142 y plantilla 1146 son IDs distintos.
- ALM-020: variante 246 y plantilla 250; usar 250 para stock apuntaría al modelo incorrecto.

**Consecuencia de aplicar cambios:** Separar modelos evita operaciones sobre el objeto equivocado. La fase de campos solo prepara identidad y no debe crear movimientos.

### F03 26 grupos de nombres duplicados en Odoo.

- CINTA METRICA 8M: variantes 346 y 1009 comparten nombre.
- VARILLA ELECTRODOS 6013 3/32: variantes 313 y 780 comparten nombre; el nombre no acredita duplicación de negocio.

**Consecuencia de aplicar cambios:** Elegir un registro canónico puede cambiar el uso futuro y la presentación de reportes. Unificar historial o saldos requiere una decisión distinta y soportada.

### F04 Los catálogos difieren en tamaño, tipos y categorías: Odoo incluye 87 servicios; SGC tiene 30 categorías y Odoo 41.

- Odoo 300, TRANSPORTE DE MATERIAL-MADERA: servicio activo, fuera de una comparación de cantidades almacenables.
- Odoo 303, Servicio de construccion: servicio archivado; tampoco equivale a un artículo físico faltante en SGC.

**Consecuencia de aplicar cambios:** Definir alcance evita altas artificiales. Reclasificar categorías puede afectar configuración contable y debe revisarse antes de ejecutarse.

### F05 33 unidades SGC frente a 31 Odoo; 0 vínculos persistidos y 14 definiciones dimensionales compatibles.

- unidad / Units(1) y docena / Dozens(2): relación dimensional propuesta de 12 unidades por docena.
- kg(12) y lb(15): peso; m(5) y ft(18): longitud. Los factores y redondeos deben aprobarse por dimensión.

**Consecuencia de aplicar cambios:** La conversión puede modificar la cantidad expresada y el costo por unidad. Debe conservar el significado económico y documentar el redondeo aceptado.

### F06 10 artículos usan unidades fuera del catálogo: `u`, `Uni`, `32`, `50`, `79`.

- ART-0003.unidad = 32.
- CSD-04-021.unidad = 50.
- CSD-04-022.unidad = 79. Los tres son valores fuera del catálogo, no IDs Odoo confirmados.

**Consecuencia de aplicar cambios:** Corregir la etiqueta puede cambiar cómo se interpreta la cantidad histórica. No se multiplican saldos ni costos sin equivalencia aprobada.

### F07 Cajas, pares, paquetes/fundas y galones no tienen contenido confirmado; 16 productos usan `Pies(30)`, distinta de `ft(18)`.

- ALM-020: caja de clavos de 50 lb en SGC frente a Units(1) en el candidato Odoo; 50 lb no equivale a 50 piezas.
- CSD-01-007: par de guantes frente a Units(1); confirmar si se cuenta el par o cada pieza.
- ALAMBRE ELECTRICO GOMA 12/3, Odoo 402: Pies(30), categoría propia, distinta de ft(18) de longitud.

**Consecuencia de aplicar cambios:** Un factor incorrecto puede multiplicar existencia y distorsionar valoración. El contenido del empaque y la dimensión deben acreditarse por producto.

### F08 0 ubicaciones homologadas; 15 bodegas activas reales y 16 almacenes Odoo candidatos, con ambigüedad City Place.

- City Place: candidatos CITY(6), ubicación 42, y CITY2(7), ubicación 48; alcance todavía ambiguo.
- Bodega Central → WH(1)/ubicación 8 y Las Américas → ALMA(21)/ubicación 132 son hipótesis que requieren confirmar sedes y solapamientos.

**Consecuencia de aplicar cambios:** El alcance aprobado determina dónde se agrega el stock. Un solapamiento contaría dos veces la misma existencia; una omisión la dejaría fuera.

### F09 Monterezzo inactivo conserva 25 saldos positivos y comparte proyecto con una bodega activa.

- En Monterezzo (fusionado), CSD-04-002 registra saldo 110 unidad de puntal metálico.
- En esa misma bodega inactiva, CSD-01-017 registra saldo 1 unidad de bota de seguridad #44. Son saldos registrados, no conteos físicos nuevos.

**Consecuencia de aplicar cambios:** Una reubicación, corrección residual o ajuste físico puede afectar stock y eventualmente valor. Cada tratamiento requiere causa, documento y aprobación, sin borrar historia.

### F10 Brisas City Center mantiene bodega activa con proyecto inactivo; las bodegas no comparten siempre el estado del proyecto.

- Brisas City Center: proyecto inactivo con bodega activa.
- Monterezzo: una bodega inactiva conserva 25 saldos positivos mientras otra del mismo proyecto permanece activa.

**Consecuencia de aplicar cambios:** Cambiar el estado limita o habilita operación futura. No elimina saldos ni reemplaza el cierre documentado de una sede.

### F11 3 bodegas de prueba, 540 filas de stock en contexto de prueba y 3 cadenas entrada/salida con banderas real/prueba distintas.

- Almacén Proyecto Ejemplo 2 y Almacén Saasasa están activos y marcados es_prueba=true.
- Almacén TEST Proyecto de Prueba también está marcado de prueba. Además hay 3 cadenas mixtas entrada/salida; la captura conserva su conteo agregado, no sus folios.

**Consecuencia de aplicar cambios:** La exclusión cambia el universo conciliado; una clasificación errónea podría ocultar una operación real. Se conserva historia y lista de exclusiones.

### F12 Existencia física, reserva y disponible representan cantidades diferentes; SGC no aporta reserva en la tabla consultada.

- Quant 1467, producto 286, ubicación 8: 52 físicos - 25 reservados = 27 disponibles.
- Quant 1468, producto 287, ubicación 8: 1 físico - 1 reservado = 0 disponibles.
- Quant 1470, producto 284, ubicación 8: 39 físicos - 5 reservados = 34 disponibles. Ningún ejemplo acredita una merma por sí solo.

**Consecuencia de aplicar cambios:** Elegir una magnitud distinta cambia el desfase aparente. Las reservas reducen disponible, no demuestran por sí solas pérdida física.

### F13 `stock_por_bodega` y `stock_apertura` son saldos de distinto propósito; quants y documentos tienen otro nivel de detalle.

- SGC conserva 3.444 filas de saldo actual y 3.416 de apertura en tablas separadas: no deben sumarse.
- Odoo conserva 1.638 quants, de los que 741 son internos; SGC tiene 130 entradas y 319 líneas de entrada. Son niveles de detalle distintos.

**Consecuencia de aplicar cambios:** Duplicar apertura y saldo actual inflaría la base a sincronizar. Cambiar la base histórica puede alterar reportes y necesita fecha y regla aprobadas.

### F14 91 salidas reales están en `entregado_incompleto`; contar documentos no acredita recepciones completas.

- La captura registra 91 salidas reales entregado_incompleto y 31 reales despachado: requieren verificar recepción por línea.
- Hay 4 entradas reales pendientes de confirmación. Son ejemplos agregados de pendientes; no se afirma que correspondan a las mismas salidas ni se inventan folios.

**Consecuencia de aplicar cambios:** Registrar recepciones, traslados o diferencias acreditadas puede modificar saldos y valoración. Completar por inferencia generaría existencias o pérdidas sin soporte.

### F15 SGC conserva 9 saldos de artículos inactivos; Odoo tiene 5 quants internos de productos archivados.

- OFI-011, CORRECTOR 9ML ARTESCO: artículo inactivo con saldo registrado 999 unidad en Bodega Central.
- OFI-021, CLICK (PAQ): artículo inactivo con saldo registrado 999 paquete en Bodega Central. Estos saldos requieren validar realidad, condición y contexto de prueba.

**Consecuencia de aplicar cambios:** Reactivar habilita uso futuro; trasladar, devolver o dar de baja puede afectar stock y valor. Archivar por sí solo no corrige la existencia.

### F16 0 pares producto+unidad+ubicación completamente homologados y capturas con ~2 minutos de diferencia.

- Captura Odoo: 07:31:42-07:31:56 RD; captura SGC prod: 07:34:03 RD. Las lecturas no representan un corte común.
- ART-0002 y CSD-05-018 son candidatos activos con unidad compatible, pero todavía sin ubicación homologada: su diferencia de stock no puede certificarse.

**Consecuencia de aplicar cambios:** Un corte y una identidad aprobados permiten medir deltas. Las diferencias temporales deben explicarse antes de proponer un ajuste de cantidad o importe.

## Aviso al desarrollador y alcance del issue

El [issue #20](https://github.com/techcsd/SGC/issues/20), asignado a XavielT, solicita evaluar y promover la fase mínima de identidades en SGC/Supabase: 61 columnas opcionales en 11 tablas, 2 tablas de contexto y funciones de protección. No modifica la base interna de Odoo. Su descripción indica que aún no se aplicó en dev ni producción. Exige evaluación, pruebas en dev y verificación antes de producción; no importa datos ni activa un worker o sincronización. La ampliación de cola/documentos es opcional y queda fuera de esa promoción.

La estructura permitirá guardar equivalencias aprobadas. Para empezar a sincronizar siguen siendo necesarias la homologación, el adaptador y la validación del circuito; los campos por sí solos no son suficientes.

## Propuesta de solución y aprobación por hallazgo

**Todas las soluciones siguientes son propuestas; ninguna está aprobada ni ejecutada.** P1 bloquea la conciliación del alcance afectado. P2 debe resolverse antes de extender ese alcance. Se pueden aprobar filas verificadas y mantener las demás pendientes; una excepción no habilita todo el catálogo.

### Decisiones generales que se propone aprobar

| Decisión | Propuesta concreta | Alcance de la aprobación solicitada |
| --- | --- | --- |
| D01 — Responsabilidad por sistema | Odoo como catálogo de referencia y fuente de valoración contable, sujeto a verificar su configuración; SGC conserva la operación de bodegas y sus documentos durante la conciliación. Contabilidad decide las reglas financieras, Almacén acredita identidad/ubicación/conteo y Tecnología mantiene los vínculos. | Aprobar esta distribución para el diagnóstico y piloto. La transferencia de autoridad del stock a Odoo y la sincronización continua quedan para una decisión posterior. |
| D02 — Saldo comparable | Comparar `stock_por_bodega.cantidad` con existencia física Odoo (`quantity`) normalizada a la unidad base y a las ubicaciones/propiedad aprobadas. Mostrar reservas y disponible por separado. | Aprobar definición y filtros. No modificar reservas ni asumir que disponible es existencia física. |
| D03 — Primer lote | Revisar **ART-0002, CSD-05-018, CSD-05-047, CSD-06-016 y CSD-08-003**: los 5 candidatos activos con unidad compatible. Elegir una bodega cuya ubicación física también sea validada. | Aprobar el lote para validación documental y física. La selección no confirma todavía identidades, saldos ni autorizaciones de ajuste. |

La propuesta D01 sigue el [mapa de integración local](MAPA-ODOO-INVENTARIO.md): durante la transición no deben existir dos sistemas modificando de forma independiente el mismo stock. La decisión final de autoridad debe quedar firmada por Contabilidad y Operaciones.

### Plan de corrección por hallazgo

| ID / prioridad | Hallazgo del diagnóstico | Solución propuesta | Responsable y evidencia para cerrar |
| --- | --- | --- | --- |
| **F01 / P1** | 0 referencias SGC; solo 2 referencias internas Odoo y 0 códigos de barras. Hay 17 candidatos por nombre y 265 artículos SGC sin candidato exacto. | Preparar una ficha por artículo con código/UUID SGC, descripción técnica, presentación, unidad, fabricante/referencia cuando exista y candidato Odoo. Clasificar cada fila como equivalente, diferente, pendiente o fuera de alcance. Empezar por D03; resolver después los otros 12 candidatos y los 265 restantes. Registrar vínculos aprobados conservando `odoo_ref` y los IDs SGC. Proponer altas solo cuando la búsqueda técnica confirme que no existe equivalente. | **Almacén y Compras** acreditan el artículo; **Contabilidad** aprueba la correspondencia y las altas; **Tecnología** registra. Cierre: ficha, soporte y aprobación por fila. Un nombre o un código nuevo no demuestra identidad. |
| **F02 / P1** | En 1.146 casos el ID de variante difiere del de plantilla. | Guardar por separado instancia/base/compañía, `product.product` y `product.template`, verificando su relación en Odoo. Usar la variante para stock. Para ART-0002 validar expresamente variante 1142 → plantilla 1146; no sustituir un ID por el otro. | **Tecnología** prepara y valida la relación; **Contabilidad/Almacén** aprueban el artículo representado. Cierre: cada vínculo apunta al modelo correcto y la variante pertenece a la plantilla declarada. |
| **F03 / P1** | 26 grupos de nombres duplicados en Odoo. | Revisar cada grupo por características, unidad, categoría, historial y stock. Mantener registros separados si representan artículos distintos, aunque compartan nombre. Si se confirma duplicación, proponer un registro canónico para operaciones futuras y un tratamiento separado del historial/saldos; no fusionar ni borrar por nombre. | **Compras/Almacén** identifican; **Contabilidad** aprueba el tratamiento; **Tecnología** documenta referencias. Cierre: dictamen por grupo y ningún vínculo automático ambiguo. |
| **F04 / P2** | Los catálogos difieren en tamaño, tipos y categorías: Odoo incluye 87 servicios; SGC tiene 30 categorías y Odoo 41. | Aprobar un catálogo de alcance: almacenables; consumibles con control físico cuando corresponda; servicios excluidos de la comparación de cantidades. Clasificar también los 1.132 registros Odoo sin candidato exacto. Crear una matriz de categorías por función real; no exigir igualdad de conteos ni copiar categorías que determinen valoración sin revisión contable. | **Contabilidad y Compras**, con **Almacén**. Cierre: listado incluido/excluido con motivo, categoría operativa y categoría contable cuando aplique. La diferencia de conteos no genera altas por sí sola. |
| **F05 / P1** | 33 unidades SGC frente a 31 Odoo; 0 vínculos persistidos y 14 definiciones dimensionales compatibles. | Validar y registrar las 14 correspondencias propuestas con categoría dimensional, unidad base, factor, redondeo y sentido de conversión. Mantener separadas las 2 coincidencias de etiqueta de empaque y los otros 17 códigos pendientes. Probar conversiones de ida/vuelta con cantidades reales de muestra antes de aplicarlas. | **Almacén** confirma uso; **Contabilidad** aprueba precisión/base de conteo; **Tecnología** valida factores. Cierre: matriz firmada y conversiones consistentes con el redondeo autorizado, sin cruces de dimensión. |
| **F06 / P1** | 10 artículos usan unidades fuera del catálogo: `u`, `Uni`, `32`, `50`, `79`. | Proponer `u` y `Uni` como alias de `unidad` únicamente tras verificar cómo se cuenta cada uno de los 7 artículos. Investigar los 3 valores numéricos contra documentos y origen de importación; sustituirlos por una unidad validada, sin interpretarlos como IDs Odoo. Preservar el valor anterior en el registro de corrección. | **Almacén/Compras** aportan soporte; **Contabilidad** aprueba equivalencia; **Tecnología** corrige en lote validado. Cierre: los 10 artículos tienen unidad válida y la cantidad/costo conservan su significado o tienen un ajuste explícitamente aprobado. |
| **F07 / P1** | Cajas, pares, paquetes/fundas y galones no tienen contenido confirmado; 16 productos usan `Pies(30)`, distinta de `ft(18)`. | Definir unidad de inventario y presentación por producto. Documentar cuántas piezas contiene una caja/par o si el artículo se cuenta por peso/longitud. Confirmar US/imperial para galón. Revisar individualmente los 16 productos `Pies(30)`; si son longitud, preparar una propuesta de tratamiento de unidad e historial, sin cambiar de categoría directamente. No derivar factores del nombre ni usar “50 LBS” como 50 piezas. | **Compras y Almacén** acreditan empaque/medición; **Contabilidad** aprueba equivalencia e impacto; **Tecnología** simula. Cierre: ficha de presentación por producto, factor probado cuando proceda y tratamiento del stock/documentos anteriores. |
| **F08 / P1** | 0 ubicaciones homologadas; 15 bodegas activas reales y 16 almacenes Odoo candidatos, con ambigüedad City Place. | Validar las 15 filas de la matriz por sede, obra y responsable físico. Para cada una enumerar exactamente ubicaciones Odoo incluidas/excluidas, hijas, tránsito, cuarentena y propiedad. Comprobar si Central↔WH y Las Américas↔ALMA representan sedes distintas o solapadas, evitando doble conteo; resolver City1/City2, grafías Volares/VOLAR y Villa Caletón, y la sede de Torre Alpha. Revisar los otros 7 almacenes Odoo y clasificarlos como incluidos, fuera de alcance o pendientes; no agregarlos por semejanza. | **Responsables de bodega y Operaciones** validan sede; **Contabilidad** aprueba el alcance de conciliación; **Tecnología** registra. Cierre: cada bodega del piloto tiene conjunto explícito de ubicaciones, sin doble inclusión ni ambigüedad. La tabla anterior sigue siendo candidata hasta esa firma. |
| **F09 / P1** | Monterezzo inactivo conserva 25 saldos positivos y comparte proyecto con una bodega activa. | Revisar las 25 filas con documentos de fusión/traslado y conteo físico por artículo. Si las existencias son distintas, documentar su ubicación y proponer reactivación temporal con custodio o traslado a la bodega que se apruebe; si ya se trasladaron y el saldo es residual/duplicado, proponer la corrección sustentada; si hay una diferencia física real, someter el ajuste por línea a Contabilidad. No sumar ambas bodegas ni eliminar la inactiva para resolver el caso. | **Encargado de Monterezzo y Almacén** hacen acta/conteo; **Contabilidad** determina tratamiento e impacto; **Tecnología** prepara lote. Cierre: las 25 filas tienen destino/causa documentados, sin duplicar cantidad ni valor. |
| **F10 / P2** | Brisas City Center mantiene bodega activa con proyecto inactivo; las bodegas no comparten siempre el estado del proyecto. | Confirmar si la obra aún guarda materiales, recibe devoluciones o está en cierre. Si debe seguir operando, justificar el estado y asignar custodio; si corresponde cerrarla, conciliar existencias y operaciones pendientes y proponer después su cierre. El estado del proyecto no debe borrar ni excluir saldos automáticamente. | **Operaciones/Almacén** justifican situación; **Contabilidad** aprueba cierre o permanencia. Cierre: estado de cada sede afectada consistente con acta, custodio, saldo y pendientes. |
| **F11 / P1** | 3 bodegas de prueba, 540 filas de stock en contexto de prueba y 3 cadenas entrada/salida con banderas real/prueba distintas. | Excluir inicialmente del lote de conciliación las 540 filas identificadas y poner las 3 cadenas mixtas en revisión separada. Rastrear origen, salida, recepción y efectos posteriores para decidir qué es prueba y qué operación real debe conservarse. Corregir clasificación solo con soporte. Recalcular después el conjunto incluido; las 2.904 filas restantes no se declaran limpias sin esa revisión. | **Almacén y responsable funcional** acreditan realidad; **Contabilidad** aprueba inclusión/exclusión y efectos; **Tecnología** prepara filtros. Cierre: ninguna cadena mixta sin resolver dentro del lote aprobado y lista auditable de exclusiones, sin borrar historia. |
| **F12 / P1** | Existencia física, reserva y disponible representan cantidades diferentes; SGC no aporta reserva en la tabla consultada. | Aplicar D02 y presentar tres columnas Odoo separadas. Conciliar existencia física con física, usando el mismo conjunto de ubicaciones/propiedad y unidad. Mantener las reservas como información de control hasta definir su correspondencia operacional en SGC. El ejemplo 52 físicos − 25 reservados = 27 disponibles no requiere por sí solo un ajuste. | **Almacén** valida concepto operativo; **Contabilidad** aprueba base; **Tecnología** prepara comparación. Cierre: cada diferencia identifica la magnitud comparada y no nace de mezclar físico con disponible. |
| **F13 / P1** | `stock_por_bodega` y `stock_apertura` son saldos de distinto propósito; quants y documentos tienen otro nivel de detalle. | Usar saldo actual SGC frente al saldo Odoo agregado al mismo artículo+ubicación aprobada. Conservar apertura como antecedente; si se reconstruye historia, sumar únicamente movimientos pertinentes posteriores a esa apertura, una sola vez. No cargar apertura más saldo actual ni contar cabecera/líneas/quant como si fueran la misma entidad. | **Contabilidad y Almacén** aprueban fecha/base de apertura y regla de reconstrucción; **Tecnología** demuestra cálculo reproducible. Cierre: cada saldo se explica por una sola base y no hay doble carga. |
| **F14 / P1** | 91 salidas reales están en `entregado_incompleto`; contar documentos no acredita recepciones completas. | Conciliar por línea cantidad despachada, recibida, pendiente y devuelta con sus documentos. Clasificar cada caso como tránsito pendiente, recepción no registrada, entrega parcial válida o diferencia física sustentada. Proponer recepción/traslado/ajuste solo para el hecho acreditado; no completar automáticamente lo solicitado ni considerar todo pendiente como pérdida. | **Despacho y receptor de obra** acreditan entrega; **Contabilidad** aprueba tratamiento de pendientes/diferencias; **Tecnología** vincula etapas. Cierre: todas las líneas del lote afectadas tienen soporte y destino, sin doble descuento ni recepción inventada. |
| **F15 / P2** | SGC conserva 9 saldos de artículos inactivos; Odoo tiene 5 quants internos de productos archivados. | Revisar por separado ambos conjuntos, sin asumir que son los mismos artículos. Mantenerlos en la conciliación histórica. Si existe material utilizable, proponer reactivación controlada; si requiere devolución, traslado o baja, aportar evidencia y someter la operación correspondiente. Archivar no elimina existencias ni acredita una baja. | **Almacén** verifica existencia/condición; **Contabilidad** aprueba destino y eventual impacto; **Tecnología** conserva vínculos. Cierre: cada registro tiene decisión explícita y su saldo queda explicado. |
| **F16 / P1** | 0 pares producto+unidad+ubicación completamente homologados y capturas con ~2 minutos de diferencia. | Repetir la comparación del piloto después de aprobar F01/F02/F05/F07/F08 y resolver sus excepciones. Acordar fecha/hora de corte; efectuar conteo físico y controlar o reconstruir movimientos ocurridos entre las capturas. Separar discrepancia de identidad, tiempo, unidad, ubicación y cantidad. Fijar tolerancias por unidad/redondeo; cualquier diferencia fuera de tolerancia queda pendiente con causa. | **Almacén y Contabilidad** firman corte/conteo/tolerancias; **Tecnología** entrega comparación reproducible. Cierre: cada diferencia cuantificada corresponde a identidades aprobadas y al mismo corte; toda fila no comparable figura excluida con motivo. |

### Condición para aprobar importes y ajustes

**El diagnóstico no levantó costos ni configuración de valoración por categoría y no calculó diferencias monetarias. El importe está pendiente de determinar; no es RD$0.** Antes de aprobar una corrección con efecto económico, Contabilidad debe verificar el método de costo, valoración manual/automática, cuentas, moneda y período de registro aplicables a los productos del lote. No se propone cambiar esos métodos como parte de la homologación.

En Odoo 17, las conversiones de unidades dependen de su categoría; esto respalda la validación dimensional de F05/F07. [Referencia oficial de unidades de medida](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html).

Los ajustes de inventario registran diferencias mediante movimientos contra ubicaciones de ajuste; por eso F09/F14/F15 requieren causa y documento, en lugar de editar directamente saldos. [Referencia oficial de ubicaciones y ajustes](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management.html).

La valoración automática puede generar asientos relacionados con movimientos de inventario; su configuración real debe comprobarse antes de estimar el efecto contable. No se afirma que esté activada en esta compañía. [Referencia oficial de valoración automática](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/inventory_valuation_config.html).

Cada propuesta de ajuste deberá presentar **ID del artículo/variante y ubicación, unidad base, cantidad anterior, cantidad verificada, diferencia, causa, soporte físico/documental, método y valor contable calculado, fecha/período y documento previsto por sistema**. Una corrección de identidad o presentación también debe demostrar cómo conserva el significado de cantidades y valores históricos. La aprobación de este plan no autoriza importes todavía desconocidos.

### Secuencia propuesta de trabajo

| Etapa | Entregable para revisión | Condición para avanzar |
| --- | --- | --- |
| 1. Aprobar criterios | Decisiones D01–D03 y fichas F01–F16 con responsables designados. | Contabilidad y Operaciones aceptan alcance, saldo comparable y validaciones. |
| 2. Homologar y documentar excepciones | Matrices de producto, unidad y bodega del piloto; actas para Monterezzo, pruebas y entregas parciales que lo afecten. | Cada fila del piloto está aprobada o excluida con motivo; sin decisiones pendientes que alteren sus saldos. |
| 3. Simular en dev | Previsualización por fila, valores antes/después, respaldo/versiones y resultados de conversión/conciliación. | Probar primero en SGC dev según `docs/ENTORNOS.md`. Cualquier prueba que escriba en Odoo requiere una instancia o copia de pruebas aislada; no se sustituye por escribir en el Odoo real. Las diferencias dev/prod se cubren con casos representativos y datos anonimizados, sin asumir que dev reproduce todos los casos. |
| 4. Aprobar un lote concreto | Cantidades e importes, documentos, fecha, responsables y plan de recuperación del lote. | Firma de Contabilidad sobre el lote cuantificado y aceptación operativa; la implementación se solicita por separado. |
| 5. Verificar y cerrar | Relectura de ambos sistemas y conciliación contra el lote aprobado. | Vínculos únicos correctos, operaciones aplicadas una vez, saldos/valores explicados y evidencia de cierre. La sincronización continua requiere su propia validación posterior. |

Las correcciones de maestros conservarán valores anteriores y evidencia de aprobación. Las correcciones de stock se documentarán con operaciones de negocio y el mecanismo de reversión que corresponda; no mediante borrados de historia ni restauraciones indiscriminadas de toda la base.

### Registro para aprobación de Contabilidad

Estado inicial de todas las filas: **Pendiente**. Registrar **Aprobado / Aprobado con condiciones / Devuelto para corrección / No aplica con justificación**, junto con alcance exacto y soporte. Un “aprobado” general no sustituye la decisión por fila ni la aprobación posterior de ajustes valorados.

| Referencia | Estado | Condiciones / filas aprobadas / evidencia | Responsable de aprobación y fecha |
| --- | --- | --- | --- |
| D01 — Responsabilidad por sistema | Pendiente | Por completar | Por completar |
| D02 — Saldo comparable | Pendiente | Por completar | Por completar |
| D03 — Piloto de 5 artículos | Pendiente | Por completar | Por completar |
| F01 — Identidad y cobertura de productos | Pendiente | Por completar | Por completar |
| F02 — Variante y plantilla | Pendiente | Por completar | Por completar |
| F03 — Nombres duplicados | Pendiente | Por completar | Por completar |
| F04 — Alcance y categorías | Pendiente | Por completar | Por completar |
| F05 — Equivalencias de unidades | Pendiente | Por completar | Por completar |
| F06 — Unidades fuera de catálogo | Pendiente | Por completar | Por completar |
| F07 — Empaques y medidas ambiguas | Pendiente | Por completar | Por completar |
| F08 — Bodegas y ubicaciones | Pendiente | Por completar | Por completar |
| F09 — Monterezzo | Pendiente | Por completar | Por completar |
| F10 — Estado de bodegas/proyectos | Pendiente | Por completar | Por completar |
| F11 — Pruebas y cadenas mixtas | Pendiente | Por completar | Por completar |
| F12 — Físico, reserva y disponible | Pendiente | Por completar | Por completar |
| F13 — Saldo, apertura y detalle | Pendiente | Por completar | Por completar |
| F14 — Entregas incompletas | Pendiente | Por completar | Por completar |
| F15 — Artículos inactivos con stock | Pendiente | Por completar | Por completar |
| F16 — Corte y diferencias cuantitativas | Pendiente | Por completar | Por completar |

**Aprobación del plan:** Contabilidad: ____________________ · Operaciones/Almacén: ____________________ · Fecha: ____________________ · Versión/alcance aprobado: ____________________.

**Aprobación posterior de ajustes:** lote: ____________________ · Importe y moneda: **pendientes de determinar** · Soporte y firma: ____________________. Las capturas originales y sus hashes se conservan como evidencia del diagnóstico, no como un saldo aprobado de apertura.

## Evidencia local privada

Carpeta gitignored **`scratchpad/odoo-comparison-2026-10-16/`**, directorio 0700 y archivos 0600. No se añadieron credenciales ni datos de personas a los artefactos.

- `prod-snapshot.json`, `dev-snapshot.json`, `prod-probe.json`: entorno, hora, endpoint, respuesta y hash de la respuesta.
- `odoo-manifest.json`: contexto, métodos/filtros, campos, paginación, horas por modelo, conteos inicial/final y SHA-256 de catálogos.
- `product_product.json`, `product_template.json`, `stock_warehouse.json`, `stock_location.json`, `stock_quant.json`, `uom_uom.json`: datos consultados; metadatos reales en `*-fields.json`.
- `product-codes-supplement.json`, `product-comparison.json`, `analysis-summary.json`: comprobación de referencias y clasificación reproducible.
- **`matriz-productos.csv`**: los 282 artículos y candidatos; **`matriz-bodegas.csv`**: las 26 bodegas, exclusiones y alternativas; **`matriz-unidades.csv`**: las 33 unidades, IDs candidatos y límites.
- `queries-used.json`: las dos consultas SELECT exitosas, sin credenciales. `evidence-manifest.json`: hashes de todos los artefactos conservados.

Los JSON/CSV crudos permanecen privados; este informe resume evidencia técnica revisable. Los helpers de captura efímeros se eliminaron al terminar. No se publicaron ramas, PR ni cambios en servicios.
