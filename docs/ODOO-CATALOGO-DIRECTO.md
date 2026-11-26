# Catálogo de productos, unidades y categorías directo de Odoo

**Estado:** listo en esta rama, sin aplicar a dev ni a prod. Va apilado sobre [#231](https://github.com/techcsd/SGC/pull/231) (conduces y existencias en vivo). Hay que retargetear este PR a `dev` cuando #231 se fusione.

Odoo es el catálogo maestro (ADR 15, issue #206). SGC deja de crear artículos, categorías o unidades por su cuenta. `sgc.articulos` queda como **proyección** única por `(odoo_instancia_id, odoo_product_id)`: guarda extras de SGC (talla, alias, foto, empaque, propiedad, entrega en mano, min/max, es_prueba) y un *snapshot* de lo último leído en Odoo.

## Cómo funciona ahora

1. **Al crear un conduce**, el usuario elige primero el almacén. La búsqueda de artículos consulta `product.product` en Odoo (`productos.buscar`, sin filtro `purchase_ok`) y, en cada resultado, muestra la **existencia viva** de esa bodega (`stock.quant`: cantidad − reservada). Al elegir, SGC hace upsert de la proyección. Si Odoo no responde, no se busca en el catálogo local: se avisa y se bloquea (salvo contingencia del almacén).
2. **`/articulos`** lista el catálogo ligado a Odoo. Nombre, código, unidad y categoría son de Odoo. Lo que se edita aquí son solo los extras de SGC. Un artículo nuevo se pide en **Productos por dar de alta**.
3. **`/categorias` y `/admin/unidades`** se leen de `product.category` y `uom.uom`. Son solo lectura.
4. **Alta de un producto que no existe:** se abre una solicitud en la bandeja. Contabilidad (rol `contabilidad`, Dirección, Gerencia o admin) la aprueba. Recién entonces el gateway `productos.crear` escribe un `product.product` en Odoo y proyecta el artículo en SGC. `crear_articulo_app` y `crear_articulo_desde_libre` ya no crean artículos solo en SGC.
5. **Movimientos nuevos** (salidas, entradas) exigen `odoo_product_id`, salvo datos de prueba.
6. **Reposición min/max → orderpoint:** si alguien editó la regla en Odoo después de la última escritura de SGC, SGC **no la pisa**.

## Gateway

| Acción | Uso |
|---|---|
| `productos.buscar` / `productos.listar` / `productos.obtener` | Inventario (type=`product`, no `purchase_ok`). Caché 60 s. |
| `productos.buscar_compra` | Compras (sigue filtrando `purchase_ok`). |
| `categorias.listar` / `unidades.listar` | Solo lectura. Caché 10 min. |
| `stock.disponible_productos` | Existencia viva por IDs de Odoo y bodega SGC. Sin caché. |
| `productos.crear` | Escritura. El cliente solo manda `solicitud_id`. Exige solicitud `aprobada` y `ODOO_ESCRITURA_HABILITADA`. |

## Migración y despliegue (dev primero, luego prod)

No aplicar nada desde este PR.

1. Fusionar y aplicar antes [#231](https://github.com/techcsd/SGC/pull/231) (conduces y conteos).
2. Aplicar `sql/2026-11-21-odoo-catalogo-directo.sql` al ledger de **dev** (`apply-migration.mjs --env dev`).
3. Desplegar la edge `odoo-api` (y `odoo-conciliar`) en **dev**.
4. Promover el front de esta rama a `dev`.
5. Probar en `dev.sgcconstructorasd.com`:
   - Crear un conduce: al buscar un artículo, los resultados salen de Odoo y muestran la existencia de la bodega elegida.
   - Pedir un alta, aprobarla con un rol de Contabilidad y crear el producto en Odoo (sandbox o escritura habilitada).
   - `/articulos`, `/categorias` y `/admin/unidades` leen de Odoo; si Odoo se cae, se ve la proyección con su antigüedad y no se puede despachar ni crear.
   - Un movimiento con un artículo sin `odoo_product_id` debe rechazarse.
6. El mismo orden en prod, con OK explícito.

## Flags y roles

- Secretos Odoo existentes de `odoo-api`. `ODOO_ESCRITURA_HABILITADA=true` hace falta para `productos.crear` real (si no, el adaptador es mock).
- Rol nuevo `contabilidad` (módulo `compras`). También pueden aprobar `direccion`, `gerencia` y `admin`. Hay que asignar el rol a las personas de Contabilidad.
- El de emergencia de #231 (`ODOO_CONDUCE_FALLBACK_SGC`) no habilita un fallback del *catálogo* local.

## Paridad con la app

La app (`techcsd/csd-app`) aún emite salidas con `registrar_salida_app` / `crear_conduce_simple`, sin validar existencias vivas ni buscar el catálogo en Odoo. Este PR no cambia ese repo: `amirandap` solo tiene lectura, no se puede abrir un PR ahí desde esta sesión.

## Cómo se revierte

- Frente: volver el picker de conduces al `app-articulo-picker` local.
- SQL: las columnas y el rol son aditivos; los triggers `trg_detalle_*_exige_odoo` se pueden quitar si hace falta un parche de emergencia. Las funciones de alta se pueden restaurar desde la migración anterior.
