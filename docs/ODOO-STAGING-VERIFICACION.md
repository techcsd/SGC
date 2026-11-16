# Verificación de contrato — Odoo staging (DS-03, 16-nov-2026)

Medido en solo lectura con la clave de integración (autenticación por XML-RPC). Sin host, usuario, clave ni UUID en este archivo (repo público). Los ids numéricos de Odoo son de la instancia de staging: **nunca se copian entre instancias**; todo vínculo en SGC es por `odoo_instancia_id`.

## Resumen

Staging es una **copia fiel de producción**: misma versión, mismos 198 módulos, mismos almacenes y mismas cuentas analíticas con los mismos ids que midió Miranda en prod (8-nov). Sirve para probar de verdad. Dos diferencias relevantes: la base está neutralizada (no salen correos) y la cuenta de integración tiene permisos **totales** (ver DS-04).

| Medida | Staging | Nota |
|---|---|---|
| Versión | 17.0+e (Enterprise) | Igual que prod |
| Módulos instalados | 198 | Igual que prod |
| `account`, `account_accountant`, `account_asset` | instalados | `account.asset` legible → ver DS-23 |
| `stock`, `stock_account`, `purchase`, `purchase_stock`, `project`, `analytic`, `hr`, `sale`, `web_studio` | instalados | |
| `fleet`, `maintenance`, `mrp`, `stock_picking_batch`, `purchase_requisition` | **no instalados** | Equipos/flota no tienen contraparte en Odoo |
| `stock.immediate.transfer` | **no existe** | Confirma ADR 13: `button_validate` sin asistente inmediato |
| `stock.backorder.confirmation` | existe | Un parcial abre asistente de backorder: se rechaza en SGC con mensaje |
| `stock.allow_negative_stock` | desactivado | Un despacho sin existencias falla en Odoo (traducir por rol, BS2) |
| Ubicación de tránsito | 1: «Traslado entre almacenes» (compañía 1) | Origen del paso A / destino del B |
| Ubicaciones virtuales | Inventory adjustment, Scrap | Para ajustes (DS-22) y desecho (DS-21) |
| Tipos de operación | 24 entrada · 72 internos · 25 salida | |
| Compañías | 1 | |

## Almacenes (23, todos activos, 1 paso de recepción, `ship_only`)

`WH`, `ADM11`, `BCC`, `CSJ`, `IMPRS`, `CITY`, `CITY2`, `VOLAR`, `Olea`, `RIVI`, `INT`, `RSR`, `MONT`, `TA`, `POSE`, `TRB`, `ALMA`, `DELMA`, `RM`, `COSMO`, `MCC`, `OF VC`, `VC`, `SOLSC`.

Resoluciones para DS-05 (verificadas por nombre real):
- `VOLAR` = «VOLARE» → bodega Volares (ya no es «probable»).
- `VC` = «VILLA CALENTÓN #260» → bodega Villa Calentón. **No** es Vista Cana.
- `OF VC` = «OFICINA VISTA CANA» → almacén sin bodega SGC (no gestionado); su código lleva espacio: se guarda normalizado `OFVC` (≤5) y el original en `codigo_odoo_raw`.
- Sin bodega SGC (no gestionados): `CSJ`, `IMPRS`, `CITY2`, `DELMA`, `RM`, `COSMO`, `MCC`, `OF VC`.

## Cuentas analíticas (38, un solo plan «Projects») y proyectos

`project.project`: 15. Los ids de las 10 cuentas «seguras» del mapa de Miranda **coinciden en nombre** con staging: ROMO→23, OLEA→2, VOLARES→9, POSEIDONIA-NOVAL→33, RIVIERA BAY→16, EDIF. 911→15, MONTERREZZO→24, BRISAS CITY CENTER→11, VILLA CALETON #260→41, SOLHE SIGNATURE→42.

Las 4 dudosas, lo medible hoy:
- Interplaza: existe 21 «INTERPLAZA»; **28 no existe** en staging.
- City Place: existe 17 «CITY PLACE - BESTINGPRO»; **26 no existe**. (20 «PLAZA COMERCIAL Y COLEGIO» corresponde a CITY2.)
- Torre Alpha: existen 29 «TORRE ALPHA CORPORATIVA» y 37 «TORRE ALPHA ( ADICIONAL )» → candidatas a principal + adicional.
- Torre Bolívar: existe 44 «TORRE BOLIVAR- APUNT.».
Resolución final con evidencia de uso (líneas de compra) en F2.

## Catálogo

- `product.product`: 940 (935 con `purchase_ok`, 716 almacenables). Solo **1** tiene `default_code` → el nivel 1 de homologación (código exacto) casi no aporta; el peso recae en nombre normalizado y similitud (DS-07).
- Categorías: 42 · Unidades: 38.

## Volumen y actores

Pickings 859 · quants 1878 · OC 965 · proveedores 1652 · usuarios internos 7 · empleados 38.

## DS-04 — Identidad y permisos

La cuenta de la clave («Tecnología CSD», es_AR, zona America/La_Paz, sin 2FA) tiene lectura/escritura/creación/borrado sobre `stock.picking`, `stock.move`, `stock.warehouse`, `purchase.order`, `product.product`, `res.partner`, `ir.attachment`, `ir.model.data`, `account.analytic.account`, `stock.location`, y lectura/escritura/creación sobre `stock.quant`. Es decir, **mucho más de lo que SGC necesita**.

Para prod (ADR 9) el usuario dedicado «SGC Integración» debe tener solo: Inventario/Usuario y Compras/Usuario, sin Ajustes ni administración, con permiso de crear adjuntos (`ir.attachment`) y lectura de cuentas analíticas y productos. **Paso físico (Chai):** crearlo. Hasta que exista, prod no se enciende. En staging no se crean usuarios.

La guardia de host (DS-02) impide que esta cuenta escriba fuera de `ODOO_HOSTS_ESCRITURA`.

## DS-23 — Equipos / activos (decisión)

`account_asset` y `account.asset` existen y son legibles con la clave de integración; `fleet` y `maintenance` no están instalados. **Decisión: ningún vínculo** entre equipos/vehículos de SGC y activos de Odoo. Los activos de Odoo son contables (depreciación) y los equipos de SGC son operativos; mezclarlos no aporta y obligaría a mantener dos fuentes. Se revisa solo si Contabilidad lo pide.

## Hallazgos medidos con escrituras de prueba (staging)

- **Stock negativo permitido:** se validó un traslado de 9.999.999 unidades sin error → SGC verifica disponibilidad antes de validar.
- **`button_cancel` de `purchase.order` devuelve None:** XML-RPC lo reporta como fault «cannot marshal None» aunque la OC queda cancelada → el adaptador relee el estado.
- **`button_confirm` deja la OC en «done» (bloqueada)** → una OC confirmada ya no se puede cancelar desde SGC.
- **`analytic_distribution`** por línea (`{cuenta: 100}`) funciona.
- Un picking creado y fallido por falta de stock queda en borrador → el publicador lo cancela.

## Lo que no se midió aún

Escritura de prueba (crear/validar un picking con `origin` de prueba): se hace en F3 con limpieza (`SGC-TRAS-TEST-<run>`), no en esta verificación de solo lectura.
