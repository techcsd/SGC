# BG4 — Retiro de material dañado — contrato para la app (PROMPT-29 F4)

> El servidor (web/BD) ya está construido y aplicado en prod. La solicitud de retiro **nace en el teléfono del ingeniero** con fotos del material dañado. Este doc es el contrato de la app.

## Flujo (espejo de la requisición, en reversa)
`solicitud (obra, fotos OBLIGATORIAS) → aprobación (Raykler/almacén) → conduce de retiro (obra→almacén / obra→suplidor) → recepción (ver+foto+firma) → CUARENTENA (no despachable) → disposición (descarte/reparación/devolución)`

Estados: `pendiente → aprobada → en_retiro → en_cuarentena → dispuesta`, más `rechazada` y `cancelada`.

## Lo que hace la app (crear la solicitud)
Sube las fotos al bucket **`sgc-retiro`** (`<retiro_client_id>/dano/<uuid>.jpg`), luego llama:

```
sgc.crear_retiro_material(
  p_proyecto_id uuid,               -- obra (obligatorio)
  p_almacen_destino_id uuid,        -- opcional (se asigna al aprobar)
  p_motivo_dano text,               -- 'danado_obra' | 'defecto_fabrica' | 'vencido' | 'otro'
  p_motivo_dano_detalle text,       -- obligatorio si motivo='otro'
  p_notas text,
  p_items jsonb,                    -- [{articulo_id?, descripcion, cantidad, unidad?}]  (≥1)
  p_fotos jsonb,                    -- [{path, nombre?}]  (≥1 — OBLIGATORIO server-side)
  p_es_prueba boolean
) returns uuid
```
El servidor **rechaza** con `error_campo` (22023, categoría "dato" del outbox BG1) si falta obra, motivo, items o **fotos**. La foto es el corazón del control: material "dañado" sin evidencia es un hueco.

## Encolado en el outbox (BC3/BG1)
- `tipo_op: 'retiro_material'`. Reusa el outbox con las 3 categorías (transitorio/dato/sistema).
- **Idempotencia:** `crear_retiro_material` NO recibe hoy un id de cliente. **Follow-up:** para reintentos seguros, la app debería generar un `p_client_id uuid` y el server añadir la guarda `if exists(...) return` (mismo patrón que `crear_bitacora_app`). Mientras tanto, encolar-una-vez y no auto-reintentar en categoría "dato".

## Aprobación / transporte / recepción (management — web o app de almacén)
- `retiro_aprobar(p_id, p_almacen_destino_id?)` — gate `puede_gestionar_retiro()` (admin / módulo inventario / logística); no puede aprobar el propio.
- `retiro_rechazar(p_id, p_motivo)` / `retiro_cancelar(p_id, p_motivo)`.
- `retiro_generar_conduce(p_id, p_transporta_proveedor_id?, p_transporta_texto?, p_placa_foto_path, p_carga_foto_path?, p_emisor_firma_path?)` — reusa el wizard de conduce (tipo «retiro»); crea un `conduce_externo` de transporte SIN mover stock normal. Requiere foto de placa (BA4).
- `retiro_recibir(p_id, p_foto_path, p_firma_path, p_notas?)` — recepción canónica **ver+foto+firma** (BD2). Al recibir, el material entra a **cuarentena** (`stock_cuarentena`), NO al stock disponible.

## Disposición final (almacén / dirección / gerencia + roles elevados)
- `retiro_disponer(p_id, p_disposicion, p_nota?, p_proveedor_id?)` — `puede_disponer_retiro()`.
  - `descarte` → merma (sale de cuarentena, con traza en `stock_cuarentena_mov`).
  - `reparacion` → vuelve a stock disponible (`adjust_stock +`).
  - `devolucion` → sale con traza enlazada al proveedor (`p_proveedor_id` obligatorio).

## Visibilidad
- **Cuarentena** (columna propia): `inventario_cuarentena(p_bodega_id?)` — stock dañado por almacén, NO despachable (los selectores de despacho leen `stock_por_bodega`, así que lo ignoran por construcción).
- **Compa:** tool `material_en_cuarentena(query?)` — "¿cuánto material dañado hay en Bodega Central?" (requiere módulo inventario; filtra por bodegas visibles).
- **Informe semanal (BE1-5):** `resumen_retiros_semana(anio?, semana?)` — retiros de la semana por estado/disposición.
- **Listado/detalle:** `retiros_listado(estado?, solo_mios?, limite?)`, `retiro_detalle(id)`.

## Notas de despliegue (HELD para Xaviel)
- La tool `material_en_cuarentena` requiere **redeploy del edge `assistant`** para estar viva en Compa.
