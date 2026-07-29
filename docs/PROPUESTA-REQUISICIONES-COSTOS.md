# Análisis y propuesta — Requisiciones ↔ contabilidad / costos por obra (AA23) ⏸

> PROMPT-9 · FASE 7. **Requiere aprobación de Xaviel antes de implementar.** No hay módulo contable hoy. Este documento mapea el flujo real actual, señala dónde se pierde el costo y propone cómo costear los materiales por obra, priorizado en quick wins vs. estructural.

---

## 1. Flujo real actual (medido en el código)

```
Requisición de material            Aprobación (aprobar_requisicion)         Resultado
(solicitudes_material)      ──►     divide cada ítem:                 ──►    • en stock → SALIDA (salidas_inventario, proyecto_id)
  proyecto_id ✔                       - lo que hay en bodega                  • faltante → SOLICITUD DE COMPRA (solicitudes_compra)
  items (cantidad, unidad)            - el faltante                                        │
                                                                                           ▼
                                                                     aprobar_solicitud_compra ──► ORDEN DE COMPRA
                                                                                                  (ordenes_compra: subtotal/itbis/total,
                                                                                                   precio_unitario por línea, proveedor) ✔ costo
                                                                                                          │ recepción
                                                                                                          ▼
                                                                                          ENTRADA (entradas_inventario, orden_compra_id,
                                                                                          detalle_entradas.precio_unit) ✔ costo de compra
```

**Trazabilidad de cantidades:** completa y por proyecto. La requisición guarda `salida_id`, `solicitud_compra_id`, `bodega_id`; la solicitud de compra guarda `origen_requisicion_id` y `orden_compra_id`. Se puede seguir requisición → salida → obra y requisición → OC → entrada.

---

## 2. Dónde EXISTE el costo hoy

- **`orden_compra_items.precio_unitario` / `total`** + header `subtotal/impuesto/total` — el precio pactado con el proveedor (lo digita Compras al aprobar).
- **`detalle_entradas.precio_unit`** (nullable) — el costo unitario al recibir mercancía.
- **`articulos.precio_estimado`** — solo un estimado manual.
- **`kpi_proyectos.gasto_real`** = `Σ ordenes_compra.total` de OCs `aprobada`/`recibida` del proyecto — **el único agregado de dinero por obra hoy.**
- **`proyectos.presupuesto`** + **`porcentaje_pagado`** (manual) + vista `v_proyecto_avance` (compara % pagado vs % trabajado, todo en porcentajes, no en dinero).

## 3. Dónde SE PIERDE el costo (los gaps)

1. **Las salidas no llevan costo.** `detalle_salidas` tiene `cantidad`, no valor. En el momento en que el material se **consume contra una obra**, se pierde su valor monetario. → **Es el gap #1 para costear obra.**
2. **No hay valuación de inventario.** No existe `costo_promedio`/promedio móvil en `articulos` ni en `stock_por_bodega` (solo cantidad). `detalle_entradas.precio_unit` no se propaga a stock ni a las salidas.
3. **`gasto_real` cuenta OCs, no consumo real.** Incluye lo *ordenado* (no lo recibido/consumido), e ignora el material que salió de stock existente (esas salidas no tienen OC ni costo). No mide el costo del material realmente puesto en la obra.
4. **Las partidas no tienen costo unitario.** `proyecto_partidas` solo lleva cantidades planeadas/ejecutadas; no se puede valorizar el avance físico.
5. **Líneas de OC en texto libre.** `orden_compra_items.articulo_id` casi siempre null → el gasto de compra no se puede atribuir automáticamente a artículos del catálogo.

---

## 4. Propuesta (priorizada)

### Quick wins (bajo riesgo, aditivo, alto valor)

**QW1 — Valuación de inventario (costo promedio móvil).**
- Columna `articulos.costo_promedio numeric` (default null). Al registrar una **entrada** con `precio_unit`, recalcular el promedio móvil ponderado: `nuevo = (stock_actual·costo_actual + cantidad·precio_unit) / (stock_actual + cantidad)`.
- Retrocompatible: si nunca hubo precio, queda null y se cae a `precio_estimado`.

**QW2 — Estampar el costo en la salida (el gap #1).**
- Columna aditiva `detalle_salidas.costo_unit numeric`. En `registrar_salida_inventario`, al despachar, copiar el `costo_promedio` (o `precio_estimado`) vigente del artículo. Congela el costo del material en el momento del consumo.

**QW3 — Costo de material real por obra.**
- Vista `v_costo_material_obra` = `Σ(detalle_salidas.cantidad × costo_unit)` agrupado por `salidas_inventario.proyecto_id` (excluyendo `es_prueba`). Esto SÍ mide el material puesto en la obra (no lo ordenado).
- Agregarlo a `v_proyecto_avance` / `kpi_proyectos` como `costo_material_real`, junto al `gasto_real` de OCs (que se mantiene, pero ahora se distingue "comprado" vs "consumido en obra").

**QW4 — Reporte de costos por obra/periodo.**
- Página/consulta: por proyecto y rango de fechas, desglose de material consumido (por artículo, cantidad, costo), total, y comparación vs. presupuesto. Export a Excel (patrón `exportarExcel` ya existente).

### Estructural (más alcance; decidir si entra)

**E1 — Costo por partida.** Agregar `costo_unitario` / `presupuesto` a `proyecto_partidas` y enlazar salidas/requisiciones a una partida, para valorizar avance físico y comparar planeado-vs-real en dinero por partida.

**E2 — Atribuir OCs a artículos.** Empujar el uso de `orden_compra_items.articulo_id` (picker de artículo en vez de texto libre) para atribuir el gasto de compra a artículos y cerrar el círculo compra→entrada→consumo.

**E3 — Export contable.** Una vista/exportador con el formato que use la contadora (cuentas, centros de costo = obra, fecha, monto) para alimentar el sistema contable externo. Requiere definir el plan de cuentas con Xaviel/contabilidad. **No** construir un módulo contable interno todavía.

**E4 — Pagos reales.** Hoy `porcentaje_pagado` es manual. Si en el futuro se registran pagos/facturas, derivar el % pagado de transacciones reales (hoy explícitamente no existe esa fuente).

---

## 5. Recomendación de alcance para la 1ª iteración

**QW1 + QW2 + QW3 + QW4** — dan costeo de material real por obra de punta a punta (valuación → costo en la salida → agregado por obra → reporte), son 100% aditivos y no tocan el flujo de aprobación existente. E1–E3 quedan como fase 2 una vez Xaviel valide el enfoque y (para E3) defina el formato contable con la contadora.

## 6. Qué necesito de Xaviel

1. **Aprobar el alcance** (recomiendo QW1–QW4 en la 1ª iteración).
2. Confirmar el **método de valuación** (promedio móvil ponderado es lo estándar y lo que propongo; alternativa: último costo / FIFO).
3. Para E3 (futuro): qué **formato/plan de cuentas** usa la contabilidad externa.
