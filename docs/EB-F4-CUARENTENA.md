# EB F4 — Retirar la «cuarentena de stock» (estado y decisión pendiente)

Fecha: 28-nov-2026. Sin secretos ni hosts.

## Verificado en prod (solo lectura)
- `stock_cuarentena`: 1 fila, **saldo 0**; `stock_cuarentena_mov`: 4; 16 bodegas con `odoo_cuarentena_location_id`.
- `retiros_material`: 2, ambos `dispuesta` (descarte y reparación, 17-nov). **Ninguno en cuarentena.**

## Lo que ya se hizo (aditivo)
`sql/2026-11-28-eb-cuarentena-deprecacion.sql` (+ reversa): parámetro `inventario_cuarentena_activa`, `comment on` de deprecación en las 2 tablas y la columna, y la vista de solo lectura `v_cuarentena_auditoria`. Aplicada **solo a dev**. No cambia el flujo.

## Por qué NO se apagó el flujo todavía
1. **«Cuarentena» tiene dos significados en el código.** El del stock dañado (retiros, `odoo-retiros.ts`, `inventario_cuarentena`) y el de **incentivos** (incidencias del chofer «en cuarentena» hasta que se decide: `incentivos.ts`, `incentivo-semanal`). **El segundo no se toca**: quitar todo por texto lo rompería.
2. **El retiro de material dañado depende de la cuarentena**: `retiro_recibir` mete el material a cuarentena y la pestaña «Cuarentena» es donde se hace la disposición (descarte / devolución / reparación). Ocultar la pestaña dejaría retiros nuevos sin salida; apagar `retiro_recibir` sin reemplazo rompe el flujo.

## Decisión que necesito de Xaviel
Cómo debe ser el retiro de dañado sin cuarentena (propuesta por defecto, Regla A):
- `recibido` → el material sale de la obra y **se da de baja directo** (desecho en Odoo: obra → ubicación de desecho), sin quedar en cuarentena.
- **Devolución a proveedor**: obra → ubicación de Proveedores de Odoo (conecta con F3).
- **Reparación**: sale como devolución a proveedor/taller y vuelve por una entrada normal (no se «regresa» desde cuarentena).
Si dices «ok a la propuesta», el siguiente paso es: (1) migración de `retiro_recibir`/`retiro_disponer`, (2) `odoo-retiros.ts` con los mapas nuevos, (3) quitar la pestaña y el RPC `inventario_cuarentena`, (4) quitar la herramienta `material_en_cuarentena` del conector, (5) `inventario_cuarentena_activa=false`.

## Para Chai (cuando el saldo siga en 0 y se apruebe el cambio)
Archivar en Odoo las **16 ubicaciones «Cuarentena SGC <código>»**. La integración no tiene `unlink` en prod.
