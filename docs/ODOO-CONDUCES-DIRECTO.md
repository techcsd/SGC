# Conduces y conteos directo con Odoo (#202)

Fecha: 21-nov-2026. Rama: `feat/odoo-directo-conduces-stock`. Base: `dev`.

## Decisión

Desde el 17-nov, las 16 bodegas homologadas tienen a **Odoo como fuente de existencias**. Validar contra `stock_por_bodega` al emitir un conduce era incorrecto: esa tabla es una proyección que el sondeo de 5 minutos puede revertir, y el outbox fallaba después en `exigirStockSiEsInterna`.

La autoridad, al crear el conduce, son los almacenes (`stock.warehouse` + `stock.location`) y las cantidades disponibles (`stock.quant`, cantidad menos reservado) leídas **en vivo** de Odoo. El outbox se conserva para publicar el traslado (paso A/B); no se sustituye por una escritura síncrona al emitir.

El conteo de la app (`registrar_conteo_app`) y el ajuste real, en almacenes con fuente Odoo, pasan a ser un **conteo físico aplicado y publicable** (la misma vía que la web: `inventory_quantity` + `action_apply_inventory`). Nacen con `odoo_sync_estado = pendiente` y no se consideran guardados en Odoo hasta que el worker confirma.

## Cómo funciona ahora

1. El formulario de salidas, en un almacén con fuente Odoo, muestra existencias vivas y el código del almacén en Odoo.
2. Al confirmar, el gateway `odoo-api` (`stock.validar_salida` / `salidas.emitir`) resuelve bodega→`odoo_location_id` y artículo→`odoo_product_id`, consulta Odoo sin caché de validez larga (TTL de stock: 15 s; la emisión fuerza lectura viva) y, si alcanza, registra el conduce.
3. Si falta stock, se rechaza con artículo, cantidad solicitada y disponible. El conduce no queda creado.
4. Si Odoo no responde: **se bloquea** con un mensaje claro, salvo que haya una contingencia vigente en ese almacén o el interruptor de emergencia (abajo). En ese caso se valida contra el stock local de SGC y se avisa.
5. El outbox publica después como siempre. El error de `sin_stock` ahora incluye producto y cantidades, para poder reintentar cuando logística confirme el inventario.
6. Tecnología › Sincronización muestra folio (`CND-…`), almacén y el error en la fila, y permite reintentar hasta 50 eventos a la vez. No se reintenta nada en automático.

## Interruptor y contingencia (Odoo caído)

- **Por defecto: bloquear la emisión.** No se crea un conduce que luego falle en el outbox.
- **Contingencia de almacén** (`sgc.odoo_contingencias` vigente, ya existente): se permite emitir validando stock local de SGC, con aviso.
- **Emergencia global:** secret/env `ODOO_CONDUCE_FALLBACK_SGC=true` en la edge `odoo-api`. Apagado por defecto. Solo Tecnología, y por poco tiempo. No sustituye a la contingencia por almacén.

No hay variables de entorno nuevas obligatorias. Siguen haciendo falta las de siempre (`ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY`, etc.). Opcionales: `ODOO_CACHE_TTL_S_ALMACENES_LISTAR`, `ODOO_CACHE_TTL_S_STOCK_DISPONIBLE`, `ODOO_CONDUCE_FALLBACK_SGC`.

## Apertura y ajuste real

- `set_apertura` / `set_apertura_lote`, en un almacén con fuente Odoo, **se rechazan**. La apertura no debe publicarse como ajuste (criterio 4 del publicador: duplicaría historia ya importada) y el sondeo revertiría el cambio a los minutos. Para corregir existencias: conteo físico o ajuste real.
- `ajuste_real_stock` / `ajuste_real_lote`, en fuente Odoo, crean un conteo físico publicable (un solo documento en el lote) y lo dejan pendiente hasta que Odoo confirme.

## Diagnóstico de los 24 conduces atascados

Script de **solo lectura**: `scripts/diagnostico-outbox-conduces-sin-stock.sql`. Agrupa por almacén y artículo, con folio y cantidad. Correrlo a mano. **No reencolar ni ajustar stock sin el OK de logística/Contabilidad.**

## Plan de salida (dev → prod)

1. Aplicar `sql/2026-11-21-odoo-conduces-stock-directo.sql` en **dev** (`--env dev`) y registrarla en el ledger.
2. Desplegar la edge `odoo-api` en dev.
3. Desplegar la web a `dev.sgcconstructorasd.com`.
4. Probar: emitir un conduce con stock suficiente en Odoo; rechazar uno sin stock; simular Odoo caído (debe bloquear); conteo de app / ajuste real en un almacén de prueba (queda pendiente, no “sincronizado”, hasta que el worker confirme). No escribir en el Odoo de producción desde este entorno.
5. Con OK, el mismo orden en prod (migración → edge → web). La app móvil (`csd-app`) ya lee `odoo_sync_estado` del conteo; este cambio de servidor es el que hace que ese estado exista de verdad. El conduce desde la app sigue yendo a `registrar_salida_inventario` (sin validar Odoo todavía): conviene un seguimiento en `csd-app`.
6. Los 24 atascados: correr el diagnóstico, confirmar con logística, y reintentar desde Tecnología › Sincronización (selección o lote). No se reintenta desde el código.

## Archivos clave

- Gateway: `supabase/functions/odoo-api/acciones.ts`, `acciones-conduces.ts`, `handler.ts`
- Biblioteca: `supabase/functions/_shared/odoo-stock-directo.ts`, `odoo-traslados.ts` (mensaje de faltantes)
- SQL: `sql/2026-11-21-odoo-conduces-stock-directo.sql`
- UI: `src/app/pages/inventario/salidas/*`, `src/app/pages/tecnologia/odoo-sync/*`
- Diagnóstico: `scripts/diagnostico-outbox-conduces-sin-stock.sql`

## Newsletter (texto para el equipo)

Desde ahora, cuando sacas un conduce el sistema mira las existencias **en Odoo en ese momento**, no las que SGC tenía guardadas. Si en Odoo no alcanza el material, el conduce no se crea y te dice qué artículo falta y cuánto hay. Si Odoo está caído, tampoco se crea (salvo que Tecnología haya abierto una contingencia para ese almacén).

Los conteos que haces en el teléfono, y el ajuste real en la web, en los almacenes que ya manda Odoo, **sí se publican en Odoo**. Hasta que Odoo lo confirme verás el conteo en pendiente, no como “ya quedó guardado”. Si a los minutos el número se devolvía solo, era porque el conteo de la app no llegaba a Odoo; eso es lo que se corrige.

Para cambiar la existencia ya no uses la pantalla de apertura en esos almacenes: usa un conteo físico o un ajuste real, que es lo que sí llega a Odoo.

En Tecnología › Sincronización ahora se ve el folio del conduce, el almacén y el error, y se pueden reintentar varios a la vez cuando logística confirme que ya hay stock.
