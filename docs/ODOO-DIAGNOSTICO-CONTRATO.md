# Diagnóstico de desfases SGC ↔ Odoo (CY18) + contrato de referencias/cardinalidades

> Épica #2 / historia #18 (HU-INV-00). Generado 25-oct-2026 con datos **reales** de Odoo (instancia de producción de Constructora SD, lectura con el usuario técnico de Eduardo Ng) contra una **lectura de solo-lectura de producción** del SGC. No se creó, modificó ni borró nada en ningún lado — todo el proceso es `SELECT`/exportación.

## Cómo se generó
1. `herramientas/odoo-lectura.mjs` (carpeta `imp 25102026`) — exportó productos, plantillas, categorías, UoM, proveedores (`res.partner`), almacenes, ubicaciones, impuestos, monedas y tipos de operación a CSV, más `RESUMEN.json` con versión/compañía/conteos/permisos. **No se commitea** (datos de la empresa) — vive en `C:\developer\improvements\octubre 2026\imp 25102026\odoo-export\`.
2. `scripts/diagnosticos/2026-10-25-cy18-snapshot-sgc.mjs --env prod` — snapshot de solo lectura del SGC (proveedores, artículos, categorías, unidades, bodegas, proyectos, órdenes de compra).
3. `scripts/diagnosticos/2026-10-25-cy18-comparar.mjs` — motor de comparación: produce `cy18-matriz-<env>.csv` (fila por registro, 6 estados) y `cy18-resumen-<env>.json`.

## Instancia Odoo verificada
- **Versión: Odoo 17.0 Enterprise** (`17.0+e`, confirmado en runtime vía `common.version`) — zanja la duda de §3.8 del contexto: es 17, no 19. El cliente XML-RPC del PoC #22 ya apunta a 17, correcto.
- **1 compañía:** CONSTRUCTORA SCHEKER & DOMINGUEZ SRL (moneda DOP).
- **El usuario técnico usado (Eduardo Ng) NO es de solo lectura** — `RESUMEN.json.permisos` confirma `create`/`write`/`unlink` en `purchase.order`, `stock.picking`, `product.product`, `res.partner` (solo `stock.quant.unlink=false`). Por eso esta ronda **solo leyó** — ninguna escritura se intentó con esta cuenta. Sigue pendiente pedir a Chai Consultoría un usuario de solo lectura (§6.1 del contexto).

## Conteos de la extracción (25-oct-2026, Odoo)
| Modelo | Conteo |
|---|---|
| `product.product` / `product.template` | 1,228 |
| `product.category` | 42 |
| `uom.uom` | 41 (10 categorías de UoM) |
| `res.partner` | 1,632 |
| `stock.warehouse` | 24 |
| `stock.location` | 154 |
| `account.tax` | 47 |
| `res.currency` | 171 |
| `stock.picking.type` | 121 |

## Conteos del SGC (producción, misma fecha)
| Tabla | Total | Activos | Con `odoo_ref` |
|---|---|---|---|
| `sgc.proveedores` | 1,576 | 1,576 | **0** |
| `sgc.articulos` | 285 | 209 (sin prueba) | **0** |
| `sgc.categorias_inventario` | 30 | — | n/a |
| `sgc.unidades` | 33 | — | n/a |
| `sgc.bodegas` | 27 | — | n/a |
| `sgc.proyectos` | 19 | — | n/a |
| `sgc.ordenes_compra` | 5 | — | n/a (columna no existe en esta tabla) |

**Hallazgo clave:** la columna `odoo_ref` existe en `articulos`, `proveedores` y `vehiculos` (migración `cc4-odoo-ref`) pero **hoy está vacía en el 100% de los registros de producción**. No hay ningún vínculo de identidad ya establecido — #3/#19 parten de cero, no de una base parcialmente poblada.

## Matriz de 6 clases — resultado por entidad
Archivo completo: `cy18-matriz-prod.csv` (1,945 filas, una por registro de cada lado). Clasificación aplicada con la regla de la épica: **coincidencia de nombre o de ID numérico NO confirma identidad por sí sola** — solo `odoo_ref` ya vinculado o coincidencia exacta de RNC/cédula cuentan como `equivalente_confirmado`.

### Proveedores (1,576 SGC + 1,632 Odoo)
| Estado | Cantidad | Qué significa |
|---|---|---|
| `equivalente_confirmado` | 0 | — |
| `ambiguo_duplicado` | 1,565 | El nombre coincide con un `res.partner`, pero **sin RNC capturado de ningún lado que lo confirme** — es el candidato más fuerte y más numeroso, pero requiere revisión (o una pasada con RNC real) antes de vincular. |
| `solo_sgc` | 11 | Proveedor en SGC sin ningún candidato por nombre en la exportación de Odoo. |
| `solo_odoo` | 84 | `res.partner` con `supplier_rank>0` sin candidato por nombre en SGC. |
| `diferencias` | 0 | — |
| `archivado_no_aplica` | 0 | — |

**Causa raíz de que no haya ningún `equivalente_confirmado`:** solo **3 de 1,576** proveedores de SGC tienen el campo `rnc` poblado. Sin identidad fiscal, ninguna coincidencia por nombre puede promoverse a "confirmada" bajo la regla de la épica (correcto: sería exactamente el error que #18 existe para evitar). **Esto es una recomendación de datos, no una acción tomada:** antes de homologar proveedores en #19, conviene una campaña de captura de RNC (o aceptar explícitamente un criterio de confirmación más débil para casos sin RNC — decisión de Xaviel, no tomada aquí).

### Artículos (285 SGC + 1,228 Odoo)
| Estado | Cantidad |
|---|---|
| `equivalente_confirmado` | 0 |
| `ambiguo_duplicado` (código coincide) | 0 |
| `solo_sgc` | 285 (100%) |
| `solo_odoo` (sin detalle fila-por-fila, ver resumen) | 1,228 |
| `archivado_no_aplica` | 0 |

Los catálogos de artículos **no comparten ningún identificador hoy** (ni `odoo_ref`, ni coincidencia de `codigo` SGC vs `default_code` Odoo). Homologar artículos (#19) va a requerir trabajo humano real — no hay atajo automático con los datos actuales. El nombre no se usó para proponer candidatos en artículos (a diferencia de proveedores) porque nombres de materiales de construcción son mucho más propensos a colisión ambigua ("CEMENTO GRIS", "VARILLA 3/8", etc.) — se dejó fuera de esta pasada a propósito; si se quiere, una siguiente iteración puede añadir fuzzy-matching por nombre + categoría + unidad como candidato débil (`ambiguo_duplicado`), nunca como confirmado.

### Categorías, unidades, bodegas (resumen — sin forzar 1:1)
| Entidad | SGC | Odoo | Candidatos por nombre | Nota |
|---|---|---|---|---|
| Categorías | 30 | 42 | 2 | Odoo las modela como árbol (`complete_name`); SGC es plano con `padre_id`. No se asumió correspondencia 1:1 de nodo. |
| Unidades/UoM | 33 | 41 (10 categorías) | 8 | Odoo tiene `category_id`+`factor`+`rounding`; SGC solo `codigo`/`nombre`. Conversión de unidad **no está resuelta** — es trabajo de #19, no de este diagnóstico. |
| Bodegas | 27 | 24 almacenes (154 ubicaciones) | 0 | **Confirmado: NO hay relación 1:1 bodega↔warehouse.** Ni una sola coincidencia de nombre. Un almacén de Odoo tiene múltiples ubicaciones internas (stock/tránsito/scrap); una bodega SGC probablemente mapea a una `stock.location` específica dentro de un `warehouse`, no al warehouse completo — **a confirmar con Xaviel/Odoo antes de diseñar #4**. |
| Proyectos | 19 | — | — | Esta pasada **no exportó** el módulo de proyectos/analítica de Odoo (no estaba en el alcance del extractor original). Queda **abierto**: si Odoo tiene `project.project` o cuentas analíticas activas, falta una pasada adicional antes de que #4/#24 puedan fijar "destino" por proyecto. |

### Órdenes de compra
Solo 5 OC en SGC prod, ninguna con referencia a Odoo (la columna `odoo_ref` no existe en `ordenes_compra`, solo en `articulos`/`proveedores`/`vehiculos`). Es consistente con que el piloto de #24 no ha empezado — no hay nada que reconciliar todavía en este lado.

## Totales — conciliación
- Proveedores: 1,576 (SGC) + 1,632 (Odoo) = 3,208 identidades de origen → 1,660 filas en la matriz de proveedor (1,576 del lado SGC + 84 solo-Odoo sin candidato; el resto de Odoo quedó absorbido como `id_odoo` dentro de las 1,565 filas `ambiguo_duplicado`). Sin ausencias sin explicar.
- Artículos: 285 (SGC) + 1,228 (Odoo) = 1,513 filas — mismo criterio, sin ausencias sin explicar.

## Contrato de referencias/cardinalidades (insumo para #3/#4/#19/#24)
1. **Proveedor ↔ `res.partner`:** cardinalidad 1:1 esperada, pero **la identidad debe confirmarse por RNC/cédula, nunca por nombre solo**. Acción recomendada antes de #19: decidir qué hacer con los 1,565 candidatos sin RNC (¿capturar RNC primero, o aceptar nombre+revisión manual puntual como confirmación explícita de una persona?). Esta decisión es de Xaviel — no se tomó aquí.
2. **Artículo ↔ `product.template`/`product.product`:** cardinalidad N:1 (variantes de Odoo → una plantilla); SGC hoy no tiene concepto de variante. Sin identificador compartido hoy — homologación #19 parte de cero, candidato débil por nombre+categoría+unidad si se quiere acelerar (no implementado en esta pasada).
3. **Bodega ↔ almacén/ubicación:** cardinalidad **no 1:1**, pendiente de mapeo manual contra la estructura real de `stock.location` (154 filas) antes de que #4 pueda fijar origen/tránsito/destino con confianza.
4. **Categoría/Unidad:** estructuras distintas (árbol vs. plano; con/sin factor de conversión) — no se puede copiar el ID de Odoo como si fuera equivalente a la fila SGC sin antes resolver la conversión (unidad) o el nivel del árbol (categoría).
5. **Orden de compra:** sin dato aún — el contrato se diseñará en la Fase A de #24 cuando haya al menos una OC real vinculada.

## CY4 — vínculos de stock (`sgc.odoo_vinculos_stock`, aplicada en dev)
`sql/2026-10-26-cy4-vinculos-stock-odoo.sql`. Tabla de vínculo (FKs reales a `entradas_inventario`/`salidas_inventario`/`conduces_externos`/`retiros_material`/`conteos_inventario`, exactamente una por fila) + tabla de renglón (`odoo_vinculos_stock_lineas`, FK real a `detalle_entradas`/`detalle_salidas`). Cardinalidad **N:N por diseño**, no 1:1:
- Un mismo documento Odoo (`stock.picking`/`move`/`scrap`) puede enlazar **varios** documentos SGC — recepción dividida: la entrada original y la(s) entrada(s) de pendiente (`entrada_origen_id`) comparten el mismo `odoo_id` con `etapa` distinta (`recepcion_compra` / `recepcion_parcial`).
- Un mismo documento SGC puede enlazar **varios** documentos Odoo en etapas distintas — ej. una salida y su entrada de traslado interno comparten el mismo `odoo_id` (`traslado_salida` / `traslado_entrada`), sin inventar dos movimientos.
- **Reintento no duplica**: único índice `(instancia, modelo, odoo_id, etapa, origen_sgc_tipo, origen_sgc_id)` — la pareja exacta no se repite, pero la misma entidad Odoo con otra entidad SGC (o la misma SGC con otra etapa) sí es una fila nueva legítima.
- **Origen borrado conserva historia**: `ON DELETE SET NULL` en las FKs + `origen_sgc_tipo`/`origen_sgc_id` (fijados por trigger al insertar, nunca recalculados) + `origen_borrado_en` (sellado por trigger cuando las 5 FKs llegan a null). El check de "exactamente 1 FK" se relaja a "0 FKs solo si `origen_borrado_en` ya está sellado" — error real encontrado y corregido en esta misma ronda (el primer intento de la migración no permitía ese estado final y el `ON DELETE SET NULL` fallaba).
- **Ubicación/unidad/compañía (criterio 5)**: `odoo_ubicacion_origen_id`/`_transito_id`/`_destino_id` (IDs nativos de `stock.location`, no texto libre), `unidad_notas` (texto libre para anotar conversión/caveat — sin tabla de conversión todavía, eso es CY19), `odoo_compania_id` con FK compuesta a `odoo_companias(instancia_id, odoo_id)` — todos nullables porque no toda etapa los tiene (una recepción de compra no tiene tránsito). Enviar material a obra **no se asume** como venta: `etapa` distingue explícitamente `traslado_*` de `recepcion_compra`.
- **No toca stock, no publica**: la tabla no tiene ningún trigger que lea/escriba `stock_por_bodega` ni tablas de saldo — es solo el vínculo. RLS activo, sin acceso `anon`/`authenticated` (solo `service_role`/RPC `SECURITY DEFINER`, a construir en F9/F10).
- Probado en dev con smoke transaccional (`scripts/smoke-cy4-vinculos-stock.mjs`, ROLLBACK): recepción dividida, salida+entrada del mismo traslado, reintento exacto rechazado, borrado del origen conserva el vínculo, 0 y 2 FKs de origen rechazados.

## CY19 — mecanismo de vinculación (parcial: criterio 1, aplicada en dev)
`sql/2026-10-26-cy19-homologacion-vincular.sql`. RPC `sgc.odoo_homologacion_vincular(p_vinculos jsonb, p_simular boolean default true)` — dada una equivalencia ya **confirmada** (fuera de esta RPC: la decide la matriz de CY18 o una revisión humana, nunca nombre/ID numérico solos), escribe el `odoo_id` en las columnas de identidad de F5. Solo `proveedores`, `categorias_inventario`, `unidades` (comparten exactamente las mismas 3 columnas); `articulos` (`odoo_product_id`/`odoo_template_id`) y `bodegas` (`odoo_location_id`/`odoo_warehouse_id`) quedan para una migración siguiente con el mismo patrón — su forma de columnas es distinta.

- **Simulación real**: `p_simular=true` (default) previsualiza sin escribir — probado que de verdad no escribe.
- **Idempotente**: vincular al mismo `odoo_id` ya vinculado → `ya_vinculado` (no-op); a un `odoo_id` **distinto** → `conflicto_existente`, bloqueado, nunca se sobrescribe en silencio.
- **Registro por fila**: `sgc.odoo_homologacion_log`, una fila por intento (simulado o real), incluye los rechazos (tabla no soportada, `odoo_id` inválido, instancia no habilitada, `sgc_id` inexistente) para auditoría.
- **Permiso**: solo `is_admin()` o `service_role` — un usuario sin admin es rechazado (`42501`), probado.
- Smoke transaccional (ROLLBACK) cubre los 6 escenarios de arriba.

**Explícitamente fuera de esta pieza** (criterios 2-3-7-8-9 de CY19 — altas y resolución de discrepancias): requieren **escribir en el Odoo real** (crear el proveedor/categoría/unidad que falte del lado Odoo), y la única cuenta técnica disponible hoy **no es de solo lectura confirmada en una base de pruebas** (D-08) — se construyen cuando exista esa base o una orden escrita de Xaviel para un caso concreto. Esta pieza tampoco ajusta saldos ni importa apertura (no los toca).

## CY6 — outbox transaccional (aplicada en dev)
`sql/2026-10-26-cy6-outbox-odoo.sql` (+ `cy6b-grant-service-role.sql`, fix de permisos encontrado probando el procesador). Enganche **a nivel BD**, no a nivel service Angular (la app escribe por RPC sin pasar por esos services) y, dentro de "a nivel BD", se eligió **trigger de tabla** en vez de editar el cuerpo de las 9 RPC que cita la issue — un trigger `AFTER INSERT/UPDATE` corre en la MISMA transacción que la escribió, así que el criterio 1 ("si la transacción revierte, no hay evento") se cumple sin tocar ninguna de las 9 RPC (menor riesgo que editar rutas de escritura en producción real).

**Inventario de las 9 rutas de escritura citadas en la issue** (tabla destino real, confirmado contra dev):
| RPC | Tabla(s) | ¿Tiene trigger de captura hoy? |
|---|---|---|
| `crear_articulo_app` | `articulos` (INSERT) | ✅ sí |
| `articulo_actualizar_app` | `articulos` (UPDATE) | ✅ sí |
| `crear_unidad_app` | `unidades` (INSERT) | ✅ sí |
| `crear_categoria_app` | `categorias_inventario` (INSERT) | ✅ sí |
| `entregar_conduce` | `salidas_inventario`, `detalle_salidas` (UPDATE) | ⏳ no — siguiente migración, mismo patrón |
| `confirmar_entrada_chofer` | `entradas_inventario`, `ordenes_compra` (UPDATE), `detalle_entradas` (INSERT) | ⏳ no |
| `crear_retiro_material` | `retiros_material`, `retiro_material_items`, `retiro_material_fotos` (INSERT) | ⏳ no |
| `aprobar_requisicion` | `solicitudes_compra`, `solicitud_compra_items` (INSERT), `salidas_inventario`, `solicitudes_material`, `solicitud_material_items` (UPDATE) | ⏳ no |
| `crear_solicitud_compra_app` | `solicitudes_compra`, `solicitud_compra_items` (INSERT) | ⏳ no |

Se capturaron los **4 maestros** (`articulos`, `categorias_inventario`, `unidades`, `proveedores`) esta ronda; las **5 rutas de stock/compra** (entradas, salidas, retiros, requisiciones, solicitudes de compra) quedan para una migración siguiente con el mismo patrón de trigger — no se tocaron hoy para no arriesgar flujos de stock en producción real sin tiempo de probarlos uno a uno.

**Mecánica (todo probado en dev, incluido contra la RPC real bajo rol `authenticated`, no solo con SQL directo):**
- `sgc.odoo_eventos`: un evento por `(instancia, agregado_tipo, agregado_id, revision)` — único, reintento no duplica. `revision` se autoincrementa por agregado (criterio 5).
- `sgc.odoo_v1_reclamar_eventos()`: `FOR UPDATE SKIP LOCKED` (un solo efecto entre consumidores concurrentes, probado), filtra por política habilitada + `es_prueba=false` (D-16) + **no adelanta una revisión si la anterior del mismo agregado no está `completado`** (dependencia de etapas, criterio 5).
- `sgc.odoo_v1_finalizar_evento()`: exige el `lease_token` vigente (si no, devuelve `false` sin tocar nada — mismo patrón defensivo de CY23).
- **Publicación apagada por defecto**: `sgc.odoo_publicacion_politica` empieza vacía — sin una fila `habilitada=true` para un `agregado_tipo`, `reclamar_eventos` nunca devuelve nada para él. Probado.
- **Guard anti-bucle (CY7 criterio 4)**: `set_config('sgc.odoo_importando', 'true', true)` antes de escribir hace que el trigger de captura se omita — listo para cuando exista un importador real "desde Odoo", que hoy no existe.
- `supabase/functions/odoo-sync/` (procesador, desplegado a dev): reclama con `service_role`, intenta publicar vía `_shared/odoo-inventario.ts::publicarMock` — **MOCK explícito, no toca Odoo** (D-15) — y finaliza. **Probado de punta a punta en dev real**: instancia+política+categoría reales → `curl` al edge → evento pasó de `pendiente` a `completado` con el resultado simulado, verificado en `sgc.odoo_eventos`/`sgc.odoo_intentos`, datos de prueba borrados después.
- **3 gotchas propios** detectados y corregidos en esta misma ronda: (1) `categorias_inventario_id_seq`/`unidades_id_seq` estaban desincronizadas en dev — hallazgo lateral preexistente (mismo patrón que `solicitudes_material_folio_seq` de otra ronda), corregido con `scripts/data-fixes/2026-10-26-cy6-resync-categorias-unidades-seq-dev.mjs`, dev-only; (2) `max(uuid)` no existe en Postgres — error real en la primera versión del trigger; (3) faltaba `grant execute ... to service_role` en 3 funciones (`odoo_homologacion_vincular` de CY19 incluida) — `grant ... to authenticated` NO cubre a `service_role`, son roles de Postgres distintos; encontrado recién al probar el procesador real contra PostgREST con la service role key.

## CY7 — matriz de autoridad por campo (propuesta, pendiente de aprobación de Xaviel)
Como pide la issue: **propuesta documentada**, no código — la matriz real la fija Xaviel.

| Campo/dato | Dueño propuesto | Por qué |
|---|---|---|
| Alias/nombre visible en SGC, imágenes, categorías internas de uso diario | **SGC** | Son decisiones operativas de la constructora, no del catálogo fiscal/contable de Odoo. |
| Código de producto, identidad fiscal (RNC/cédula), UoM — **una vez homologados** | **Odoo** | Son los campos "oficiales" que Contabilidad/Compras ya gestionan en Odoo; SGC los refleja, no los redefine. |
| Todo lo demás (ubicación física, stock, fotos de evidencia, firmas, bitácora) | **SGC**, siempre | Nunca estuvo en Odoo y la épica prohíbe dos maestros editables de stock. |

**Regla dura (ya aplicada en el código, no solo en la matriz):** nunca dos escritores sin regla — mientras la matriz no esté aprobada, `odoo_homologacion_vincular` (F8) solo **vincula** (nunca sobrescribe un campo ya distinto sin resolver el conflicto primero) y el outbox (F9) solo **publica si hay política explícita**. Nada en el código de hoy decide unilateralmente "quién gana" un conflicto de dato — eso es exactamente lo que esta matriz, una vez aprobada, va a resolver.

**Pendiente de construir cuando la matriz esté aprobada:** la lógica de "qué campo no se deja editar desde SGC una vez que Odoo es su dueño" (hoy no hay ninguna restricción de ese tipo — todos los campos siguen editables como siempre, intencionalmente, hasta que haya una matriz aprobada que lo justifique).

**Variante/conversión (criterio 2) y 1:1 bodega↔warehouse (criterio 5):** sin cambios de código esta ronda — ya documentado en la sección CY18 arriba (bodegas↔almacenes confirmado que NO es 1:1; variante de Odoo vs. SGC sin concepto de variante hoy) y queda para cuando se construya la homologación de `articulos`/`bodegas` (siguiente pieza de F8).

## Qué NO se hizo (a propósito, por alcance)
- No se creó ni modificó ningún registro en SGC ni en Odoo.
- No se exportó el módulo de proyectos/analítica de Odoo (abierto arriba).
- No se intentó fuzzy-matching de nombre para artículos (alto riesgo de falso positivo en materiales de construcción).
- No se promovió ningún `odoo_ref` — este documento es diagnóstico, no ejecuta altas.

## Pendiente de Xaviel (criterio 7 de la aceptación de CY18)
Esta matriz es la **propuesta técnica**, no la matriz aceptada — el criterio 7 de CY18 exige que el responsable (Xaviel) la revise y acepte, con foco en:
1. Los 1,565 proveedores `ambiguo_duplicado` (¿capturar RNC o aceptar revisión manual?).
2. Si Odoo tiene project/analítica activo (para proyectos).
3. El mapeo real bodega→ubicación (puede requerir una sesión con quien conoce la configuración de almacenes en Odoo).

Archivos de trabajo (no commiteados, datos de la empresa): `C:\developer\improvements\octubre 2026\imp 25102026\odoo-export\{RESUMEN.json, *.csv, sgc-snapshot-prod.json, cy18-matriz-prod.csv, cy18-resumen-prod.json}`.
