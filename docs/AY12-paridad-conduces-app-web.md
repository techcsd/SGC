# AY12 — Paridad de Conduces app → web (checklist)

> Regla madre **⭐ AY12**: todo lo que la app puede hacer, la web también. Este es el
> inventario del ciclo de vida del conduce en la web vs la app (csd-app), base para
> cerrar la brecha o marcar excepciones explícitas de Xaviel.
> Estado a 2026-08-23 (PROMPT-29).

| Capacidad | App | Web (antes) | Web (ahora) | Evidencia / Nota |
|---|---|---|---|---|
| Emitir/crear conduce clásico (bodega+items, transporte, destino, foto, es_prueba) | ✅ | ✅ | ✅ | `salidas.ts` → `registrar_salida_inventario` |
| Adjuntar items libres (material no catalogado, AU4) al crear | ✅ | ✅ | ✅ | `salidas.ts` `agregar_items_libres_conduce` |
| Confirmar / recibir entrega (doble parte) | ✅ | ✅ | ✅ | `bitacora/entregas.ts` → `confirmar_recepcion_salida` |
| Registrar entrega (chofer cierra: receptor+firma+foto+cantidades) | ✅ | ✅ | ✅ | `conduce.ts` → `entregar_conduce` |
| Firma emisor / receptor (canónica) | ✅ | ✅ | ✅ | `conduce.ts` → `firmar_conduce` |
| Firma del despachante (bandeja "por firmar") | ✅ | ✅ | ✅ | `por-firmar.ts` → `conduce_firmar_despachante` |
| Recordar al despachante que firme | ✅ | ✅ | ✅ | `conduce.ts` → `conduce_recordar_despachante` |
| Anular / eliminar conduce (soft-delete + repone stock) | ✅ | ✅ | ✅ | `conduce.ts` → `anular_conduce` |
| PDF / imprimir | ✅ | ✅ (print) | ✅ | `conduce.ts` `imprimir()` = `window.print()` (contrato único `conduce_detalle_app`) |
| **es_prueba en conduces (AY4)** — propagación + banner + exclusión KPIs/kardex | ✅ | parcial | ✅ | Trigger `trg_heredar_es_prueba` (hereda de conductor/proyecto/bodega) + RLS restrictiva + kardex `not es_prueba` (ap3) + badge en listado + **banner nuevo en el detalle** |
| **"Conduces por implementar" (AY13)** | (contrato) | ✘ | ✅ | Nueva página + RPC `conduces_por_implementar` + badge; vincular con opción per-case de movimiento (`vincular_item_libre_articulo` 3-arg) |
| Ver listado/filtros de conduces (Activos/Pendientes/Por confirmar/Histórico) | ✅ | ✅ | ✅ | `conduces.ts` → `conduces_web_listado` |
| "Mis confirmaciones" (historial propio) | ✅ | ✅ | ✅ | `confirmaciones.ts` (AL8, cerrado en 1.84.0) |

## Estado actualizado (PROMPT-29, cerrado en esta ronda)

2. **Transferir conduce (ofrecer)** — ✅ hecho: botón "Transferir" en el detalle (`ofrecer_transferencia_conduce`, picker de chofer). La ACEPTACIÓN es del chofer receptor (app).
3. **Iniciar ruta desde el conduce** (`conduce_iniciar_ruta`) — ✅ hecho: botón "Iniciar ruta" en el detalle (picker de vehículo).
4. **Worklist "Pendientes de entrega"** — ✅ cubierto por la pestaña "Pendientes de entrega" del listado `/inventario/conduces` (`conduces_web_listado`).

## Brecha residual (única abierta)

1. **Crear conduce "como chofer/transportista"** (`crear_conduce_simple` / `crear_conduce_transportista`) — el asistente iniciado-por-chofer con despachante. La web YA crea conduces vía `registrar_salida_inventario` (flujo de almacén, con despachante e items libres), que cubre el caso de oficina. El asistente idéntico al del chofer (despacho remoto) queda como mejora opcional. **Esfuerzo: M.** *Método `crearConduceSimple` ya existe en el servicio.*

> El ciclo de vida del conduce en la web ya cubre: crear, confirmar/recibir, firmar
> (emisor/receptor/despachante), **iniciar ruta**, **transferir**, anular, PDF, es_prueba
> y "por implementar". Ver PROMPT-30 para el lado app.
