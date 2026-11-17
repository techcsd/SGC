# Circuito 2 SGC → Odoo (DS-16…DS-22): mapeo, reglas y pasos físicos

Todo está **apagado**: el worker `odoo-sync` solo reclama eventos de tipos con fila `habilitada` en `sgc.odoo_publicacion_politica`, y la instancia debe tener `permitir_entrada` / `permitir_salida`. Nada de esto se ha encendido en dev ni en prod. Sin hosts, usuarios, claves ni ids de proyecto en este archivo (repo público).

## Mapa documento SGC → acción en Odoo

| Documento SGC | Qué se publica | Odoo | `origin` / marca (idempotencia) | Módulo |
|---|---|---|---|---|
| Entrada **con OC** confirmada (DS-16) | cantidades reales por línea; parcial = backorder | `button_validate` de la **recepción que generó la OC** (no se crea otra) | nota del picking `SGC-REC:<entrada>` | `_shared/odoo-recepciones.ts` |
| Entrada pendiente de confirmar / rechazada | **nada** (sin hecho físico no hay stock) | — | — | idem |
| Entrada sin OC (compra/sobrante/otro) | recepción libre proveedor → almacén | picking de recepción | `SGC-ENT-<entrada>` | idem |
| Entrada **ligada a una salida** (recepción en obra, devolución de obra con descuento) (DS-17/DS-19) | completa el paso B de ESA salida | picking tránsito → destino | `SGC-TRAS-<salida>-B` | `odoo-salidas.ts` (`entradaConfirmada`) |
| Devolución de obra **sin descuento** (`p_descontar=false`) | **no se publica**: no hay origen verificable (criterio #12.1); queda explicada en el documento | — | — | `odoo-recepciones.ts` |
| Salida / conduce (DS-10/DS-11, ya hecho) | A al despachar, B al llegar | 2 pickings internos vía tránsito | `SGC-TRAS-<salida>-A|B` | `odoo-salidas.ts` |
| Líneas añadidas **después** de publicar (material libre regularizado con movimiento, DS-20) | complemento por la diferencia | picking `…-A-C<huella>` / `…-B-C<huella>` | huella determinista del conjunto de extras | `calcularComplemento` en `odoo-salidas.ts` |
| Anulación (DS-19) | antes de validar: cancelar; después: devolución (también de los complementos) | `action_cancel` / picking inverso | `…-D<n>` | `odoo-salidas.ts` |
| Real → prueba **después** de publicar (DS-19) | compensación (devolución). Si una entrada ya validó una OC: **se bloquea con motivo** (Compras la revierte en Odoo) | picking inverso | `…-D1` | recepciones + salidas |
| Prueba → real | un solo efecto nuevo (nunca hubo vínculo de prueba) | como un documento normal | — | evento normal |
| Conduce externo (DS-18) | **nada propio**: logístico → no aplica; transporte de un retiro → lo publica el retiro; con salida/entrada → re-encola ESA salida/entrada | — | — | `_shared/odoo-externos.ts` |
| Retiro recibido (DS-21) | obra → **cuarentena** (sale del origen; no es material nuevo) | picking interno | `SGC-RET-<id>-IN` | `_shared/odoo-retiros.ts` |
| Retiro: descarte / devolución a proveedor / reparación | cuarentena → desecho (scrap) / proveedores / stock disponible | picking interno | `SGC-RET-<id>-DISP` | idem |
| Conteo físico **aplicado**, ajuste, ajuste real en lote (DS-22) | cantidad objetivo absoluta por artículo y ubicación | `stock.quant.inventory_quantity` + `action_apply_inventory` (nunca `quantity` directo) | nombre del movimiento `SGC-AJU-<conteo>` | `_shared/odoo-ajustes.ts` |
| Conteo borrador / contado | **nada** | — | — | idem |
| Deshacer conteo | compensación del **delta aplicado** (relativa al saldo actual; los movimientos posteriores se respetan) | ajuste `SGC-AJU-<conteo>-REV` | — | idem |
| Apertura / saldo inicial (`stock_apertura`) | **no se publica como ajuste**: sumaría el saldo inicial sobre la historia ya importada (criterio #15.4). Es el **corte** de DS-29 (fecha de corte + conciliación) | — | — | pendiente DS-29 |

### Las tres semánticas de ajuste, por qué no se equiparan
- **Ajuste / ajuste real**: corrige un saldo puntual → inventario de Odoo con objetivo absoluto (un solo efecto por línea).
- **Conteo físico**: SGC lo reconcilia por *apertura* (rebase); en Odoo se publica el mismo objetivo absoluto con la acción de negocio, y **solo** cuando está *aplicado*.
- **Apertura**: es un corte contable, no un movimiento: requiere fecha de corte y conciliación contra `quant` por artículo y bodega.

## Hechos medidos en staging (copia de prod)
- `action_apply_inventory` devuelve `None` → XML-RPC lo reporta como fault «cannot marshal None» **aunque sí aplicó**. El módulo lo trata releyendo el saldo (igual que `button_cancel` de la OC). Un intento sin ese manejo dejó un +1 que se revirtió.
- El nombre del movimiento de inventario = `inventory_name` del contexto → es la llave de idempotencia (`stock.move` por nombre + producto).
- Recepción parcial: `button_validate` con contexto `skip_backorder` crea el backorder; el backorder hereda la nota del picking pero no está hecho, por eso la marca `SGC-REC` solo cuenta en pickings `done`.
- El Odoo de CSD permite stock negativo: las salidas de la obra a cuarentena verifican existencias antes de validar.

## Base de datos (migración `2026-11-16-ds16-22-circuito2-odoo-sync.sql`, solo dev)
- Columnas `odoo_instancia_id/odoo_picking_id/odoo_sync_estado/odoo_sync_error/odoo_sync_en` en `entradas_inventario`, `retiros_material`, `conduces_externos`, `conteos_inventario` (protegidas por `odoo_v1_proteger_campos`).
- `bodegas.odoo_cuarentena_location_id` (protegida).
- Tipos de evento nuevos `conduce_externo`, `conteo_inventario` + captura al COMMIT.
- Trigger `odoo_v1_flip_prueba`: real → prueba genera evento de compensación (los eventos `es_prueba=true` nunca se reclaman).
- Trigger `odoo_v1_coalescer_evento`: **un único evento pendiente por documento** (DS-17); el publicador lee el estado vivo, así que los eventos extra de «aprobar requisición» + escritura posterior de destino se funden.
- RPC: `odoo_v1_marcar_documento_sync`, `odoo_v1_encolar_documento`, `odoo_reintentar_documento` (Tecnología/admin), `odoo_documentos_sync_listado` (Tecnología/admin).

## Pasos físicos (Xaviel / Chai / Inventario) antes de encender
1. **Ubicación de cuarentena por almacén** en Odoo (interna, fuera del stock disponible de WH) y enlazarla en `bodegas.odoo_cuarentena_location_id`. Sin ella los retiros quedan «pendiente» con el motivo; el material dañado nunca se manda al stock disponible. Crear ubicaciones es configuración de Odoo (la cuenta de integración no lo hace en prod).
2. Homologar los artículos de las entradas/retiros/conteos (`odoo_product_id`; ver DS-07) y las OC (publicadas **y confirmadas** en Odoo) que se van a recibir.
3. Encender por política, en este orden y solo en staging primero: `entrada_inventario` → `conduce_externo` → `retiro_material` → `conteo_inventario` (y `permitir_entrada`/`permitir_salida` de la instancia).
4. Decidir con Compras el procedimiento cuando una recepción de OC ya validada pasa a «prueba» (se bloquea; hay que revertir la recepción en Odoo).

## Pruebas
- Deno: `odoo-recepciones.test.ts` (14), `odoo-ajustes.test.ts` (7), `odoo-retiros.test.ts` (6), `odoo-externos.test.ts` (6), `odoo-salidas-circuito2.test.ts` (6). Suite completa del repo: 412 verdes.
- Contrato real contra staging con limpieza: `deno run --allow-env --allow-net --allow-read scripts/odoo-contrato-circuito2-staging.ts` (recepción parcial/completa/reintento/exceso, entrada libre y su compensación, salida + entrada ligada, complemento y compensación por prueba, conteo y deshacer, retiro → cuarentena → descarte y reversa). Deja en staging una OC de prueba confirmada (no se puede cancelar desde SGC) y una ubicación de prueba archivada; el saldo de stock queda igual al inicial.
