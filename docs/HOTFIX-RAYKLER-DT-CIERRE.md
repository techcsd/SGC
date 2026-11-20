# Cierre del hotfix Raykler (PROMPT-150, DT1–DT6) — 20-nov-2026

Web 1.218.5 (PR #214) + 1.218.6 (este cierre) · App 2.71.2 (PR #48).

## Estado por ID
| ID | Estado | Nota |
|---|---|---|
| DT1 | Hecho (cliente) · **causa raíz sin confirmar** | App: el conteo sigue el estado real del outbox (Enviando / Pendiente / Falló + Reintentar), aviso de conteo atascado, existencias se refrescan tras el sync (ahora también la vista de almacén, caché `inv_almacen_`). Servidor: `registrar_conteo_app` crea la fila si el artículo no tenía stock (probado en dev). |
| DT2 | Hecho | Picker muestra «Sin existencia aquí» (no oculta); Artículos, Reportes y **Dashboard** excluyen stock de almacenes de prueba. Procedimiento: `PROCEDIMIENTO-REGULARIZAR-STOCK-PLYWOOD.md`. En conduce un artículo sin existencia sigue sin poder despacharse (no se puede sacar lo que no hay); el faltante va a compra al aprobar la requisición. |
| DT3 | Hecho | `sql/2026-11-19-dt3-…sql` + botón «Cambiar artículo» (web y app). **Verificar que esté en prod** (ver pendientes). |
| DT4 | Hecho | Web: miniaturas + lightbox + «Ver detalle» + reintento. App: tira de miniaturas (CE14) + aviso/reintento si la foto no carga. |
| DT5 | Hecho | Causa: deploy borra el chunk que el bundle abierto pide → Vercel responde 404 `text/html` → «not a valid JavaScript MIME type»; `sw_update: instalación falló` es el mismo origen (assets del build anterior). `vercel.json` ya sirve `index.html`, `ngsw.json` y `ngsw-worker.js` con `no-cache`. Fix: `UpdateService` repara y recarga ante `NavigationError` de chunk perdido; `VERSION_READY` ya activa y recarga solo (no hay prompt manual). |
| DT6 | Este documento | Build web y app verdes. |

## ⚠️ Hallazgo que cambia el diagnóstico (Odoo SÍ toca el stock desde el 17-nov)
El prompt asumía «Odoo no toca el inventario». Desde la ronda DS, **16/16 bodegas tienen Odoo como fuente del stock** (`odoo_corte_bodega.fuente_odoo`). Por `sql/2026-11-17-ds-adjust-stock-bodega-fuente-odoo.sql` y `…ds-apertura-bodega-fuente-odoo.sql`, en esas bodegas `adjust_stock` y `_aplicar_apertura` solo aplican una **proyección optimista**; el sondeo de Odoo (cada 5 min) manda y corrige. Consecuencias probables para Raykler:
- Un conteo en la app cambia el stock al instante y **vuelve al valor de Odoo** en ≤5 min si el conteo no se publicó a Odoo (política `conteo_inventario` apagada, artículo sin `odoo_product_id`, o publicación fallida) → «ajusté el conteo y no se actualiza».
- Plywood en 0 en los almacenes reales encaja con Odoo=0 para esos 7 artículos (CSD-02-014…020), no solo con entradas sin fila.
**Esto es hipótesis**: no se pudo consultar la base (ver pendientes).

## Pendientes que requieren a Xaviel
1. **F0 de solo lectura en prod/dev** — la sesión no tiene `SUPABASE_CSD_CONSTRUCTORA_TOKEN` en el entorno (y el uso de las llaves de `.env.local` fue denegado). Consultas: `odoo_corte_bodega` + política `conteo_inventario` activa; `odoo_product_id` de CSD-02-014…020; `odoo_vinculos_stock` / `odoo_eventos` de los conteos de Raykler (últimos 5 días, `sync_estado`/error); `stock_por_bodega` y cantidad en Odoo de esos artículos; `nivel_submodulo('inventario.conteos')` de sus 4 roles; fila de `migraciones_aplicadas` de `dt3` y `reemplazar_articulo_renglon_requisicion` en dev y prod.
2. Prueba humana de la app en teléfono (estados del conteo, auto-reparación de chunk, «Sin existencia aquí»).
3. OK para promover 1.218.6 (web) y publicar la app (sin bump todavía: esos cambios se suman al próximo release de la app).

## Qué decirle a Raykler
- Ya puede ver Recibo/Tablero/Bomba antes de aprobar una echada, y cambiar el artículo de un renglón de requisición que aún no se despacha.
- Para el plywood: contar físico y aplicar por conteo (ver procedimiento); si dice «Pendiente de sincronizar», conectarse y tocar Reintentar. Si el stock vuelve a su valor anterior a los minutos, avisar a Tecnología: no es culpa del conteo (probable diferencia con Odoo).

## Resultado del F0 (20-nov-2026, solo lectura en prod)
- **Política Odoo:** `conteo_inventario` y `ajuste_faltante` habilitadas; 16/16 bodegas con `fuente_odoo`.
- **Plywood:** los 7 artículos CSD-02-014…020 tienen `odoo_product_id` (no es falta de vínculo). Stock real hoy: **CSD-02-014 = 125**, los otros 6 = 0.
- **Conteos de los últimos 10 días:** solo 5 (todos `conteo_fisico` web de Xaviel, 17-nov, con evento Odoo `completado`; 7 eventos de conteo, 0 con error). **Ninguno desde la app y ninguno de Raykler** → los conteos de Raykler **nunca llegaron al servidor** (sin fila en `conteos_inventario`, sin ítems, sin outbox atascado registrado en `outbox_atascados`). Eso apunta a conteo atrapado en la cola del teléfono (bundle viejo / sync caído), que la pantalla anterior marcaba «guardado» al encolar — justo lo que corrige la 2.71.2.
- **Dos mecanismos distintos, no confundir:** (1) `registrar_conteo_app` llama `adjust_stock` directo y **no publica nada a Odoo**: en una bodega con fuente Odoo, ese ajuste es solo proyección optimista y el sondeo de Odoo (≈5 min) lo revierte. (2) El conteo físico web aplicado sí publica a Odoo (`inventory_quantity`). Conclusión: **el conteo de la app no es un camino fiable para corregir stock en bodegas Odoo; el que persiste es el conteo físico web** (o el que se publique a Odoo).
- **Pendiente de decisión (Xaviel):** que `registrar_conteo_app` cree un conteo físico aplicable/publicable a Odoo en bodegas con fuente Odoo (hoy no lo hace), o que la app dirija al conteo web. No se tocó nada.
- No verificado: permiso `inventario.conteos` de los 4 roles de Raykler (la consulta de roles no se pudo armar con el esquema actual) y respuesta de `nivel_submodulo` por rol.
