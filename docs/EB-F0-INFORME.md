# EB — Informe F0 (solo lectura) — 28-nov-2026

Sin secretos ni hosts. Todo contra prod fue SELECT; contra Odoo real, `fields_get`/`search_read`. No se escribió nada en prod ni en Odoo.

## Entorno
- `origin/main` = 1.225.1; `origin/dev` = 1.225.0 (dev va 3 commits por detrás de la release; falta sincronizar `main → dev` antes de las ramas de trabajo).
- Worktree propio `SGC-eb` (rama `feature/eb-f0-informe` desde `origin/dev`); el árbol de Xaviel no se tocó.
- `graphify update .` corrido (20378 nodos).

## Odoo real (19.0+e) — `fields_get`
| Modelo | Hallazgo |
|---|---|
| `stock.picking` | `move_ids` existe; **`move_ids_without_package` NO existe**. `note`, `origin`, `company_id`, `picking_type_id`, `location_id`, `location_dest_id`, `partner_id` OK. |
| `stock.move` | `quantity`, `product_uom`, `product_uom_qty`, `location_*`, `picking_id` OK; **`name` NO existe** (revisar si SGC lo envía). |
| `uom.uom` | Campos: `name, sequence, relative_factor, relative_uom_id, related_uom_ids, rounding, active, factor, parent_path, product_uom_ids, fiscal_country_codes, package_type_id, route_ids`. **No existen `category_id`, `uom_type`, `factor_inv`.** |
| `stock.location` | `usage, location_id, complete_name, parent_path, warehouse_id, active, name, barcode` OK. |
| `stock.quant` | `product_id, location_id, quantity, reserved_quantity, inventory_quantity` OK. |

## Cola de Odoo (prod)
- Cron `sgc-odoo-sync` (cada minuto): 2879 corridas OK en 48 h, 1 fallida (27-nov 21:21 UTC). **El cron no es la causa.**
- **Causa de los «0 intentos» (2 mecanismos, en `odoo_v1_reclamar_eventos`):**
  1. El claim hace `join` con `odoo_publicacion_politica ... habilitada`; **`solicitud_compra` no tiene fila de política** → 12 eventos (8 crear + 4 actualizar, desde 18-nov) nunca se reclaman.
  2. Un evento previo de la misma entidad en `error` bloquea las revisiones siguientes (`previo.estado not in (completado, cancelado)`): `articulo` «actualizar» (bloqueado por «crear» en error: «TIES 80CM» sin homologar) y `salida_inventario` «actualizar» pendiente (bloqueado por su «crear» en error).
- Errores (28): 24 `sin_stock` del 18-nov (EB12); 2 `salida_inventario crear` por `move_ids_without_package` (25-nov y 27-nov); 1 artículo «TIES 80CM» sin homologar; 1 categoría «Odoo» sin homologar (creada 26-nov 14:40 UTC; nombre sospechoso de basura/prueba — confirmar con Xaviel antes de archivar).
- Hay 230 eventos `articulo` completados marcados `es_prueba=true` (nunca publican; no afectan).

## EB8 — caso ARNES WADFOW (ODOO-743)
| Fuente | Dato |
|---|---|
| Odoo `stock.quant` | 26 en `WH/Almacén principal` (loc 8) · 4 en `TA/Existencias` (loc 102) |
| SGC `stock_por_bodega` | Bodega Central **26** · Torre Alpha **4** |
| `bodegas` | Bodega Central → loc 8 / wh 1 · Torre Alpha → loc 102 / wh 16 |

**La proyección de stock es correcta; la hipótesis `child_of` queda descartada para este caso.** El «Stock: 4 u» es el de Torre Alpha: el modal está leyendo el stock de otra bodega (o una selección de almacén/artículo equivocada), no un error de datos. El PR #304 del Ingeniero (preselección de `articulo_despacho_id`) sigue abierto con **G2 en FAILURE**; no se probó que, solo, arregle el «4». Pendiente de confirmar en dev al reproducir el modal.

## EB3 — Agentes
- Tarea `fd8c603d` (reporte R-01): estado **`necesita_humano`**, 3 intentos, zona roja, costo IA 1.88; PR #304 abierto, G2 falló. Es la única en `necesita_humano`. Tablas de tareas: 5 rechazadas, 5 propuestas, 1 necesita_humano.

## EB20 — Cuarentena
- `stock_cuarentena`: 1 fila, **saldo total 0**; `stock_cuarentena_mov`: 4; bodegas con `odoo_cuarentena_location_id`: **16**; retiros de material no cerrados: **2** (por revisar antes de F4 — no se pudo listar su estado por nombre de columna distinto).
- Saldo 0 ⇒ F4 puede seguir, resolviendo primero esos 2 retiros.

## Notas 1–4
- **EB1:** búsqueda de cerradura/puerta/acceso/keypad/CanPro/RFID/token en cotizaciones, compras, herramientas, trabajos y facturas de proveedor: **0 candidatos reales** (solo ruido de `tec_equipos` por «accesorio»). Hueco de datos confirmado, no de código.
- **EB2:** smoke con imágenes sintéticas **NO hecho** en esta pasada.
- **EB3:** ver arriba.
- **EB4:** en prod existen las políticas `admin upload/update/delete empresa` y `leer empresa` en `sgc-avatars`, y la migración EA4 está en el ledger. Repro con Playwright **NO hecho**. Conclusión provisional: pedir Ctrl+F5 (captura de build anterior).

## No hecho en F0 (honesto)
- Fotos de reportes R-01…R-08: el conector no devuelve URLs de las fotos (`fotos_count` solo); EB9/EB12/EB13/EB15 siguen como hipótesis.
- `proponer_mantenimiento` (EB13): no se siguió la `url` (requiere vehículo real; solo genera borrador).
- Smoke EB2 y Playwright EB4.
- Categoría 33: origen exacto no investigado más allá de la fecha de creación.

## Tabla de estado
| EB | Estado | Siguiente paso |
|---|---|---|
| EB-01 traslados | **Confirmado** | F1: `move_ids`, simulador, test; revisar `name` en `stock.move` |
| EB-02/EB6 unidades | **Confirmado** (sin `category_id`/`uom_type`) | F1: adaptar `acciones.ts` y UI |
| EB-03/EB21 errores de edge | Por hacer | F1 handler común |
| EB-04…07 cola | **Causa hallada** (sin política `solicitud_compra` + bloqueo en cabeza) | F2: política/migración aditiva, backoff por evento, alerta, SLO |
| EB8 | Hipótesis `child_of` **descartada**; defecto en modal | F3/F5: reproducir en dev, decidir sobre PR #304 |
| EB20 | Saldo 0 | F4 tras resolver 2 retiros |
| EB1 | Hueco de datos | Pedir a Xaviel el nombre/teléfono del proveedor |
| EB4 | Ya hecho en prod (provisional) | Ctrl+F5 |
| EB2, EB9, EB12–15 | Sin verificar | Fotos y smoke |
