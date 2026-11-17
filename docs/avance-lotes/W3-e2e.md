# W3 — Integración ENCENDIDA y probada de punta a punta (dev contra STAGING de Odoo), 16-nov-2026

Repo público: sin hosts, usuarios, claves ni ids. Todo en **dev**; Odoo = **staging** (copia de prod). Nada en prod, nada en el Odoo real. Runbook de producción (solo preparado): [`docs/ODOO-PASO-A-PROD.md`](../ODOO-PASO-A-PROD.md).

## Qué quedó ENCENDIDO en dev
- 15 ubicaciones «Cuarentena SGC <código>» creadas en staging (`scripts/odoo-cuarentena-staging.mjs`, idempotente, con guardia de host) y enlazadas en `bodegas.odoo_cuarentena_location_id` (`scripts/data-fixes/2026-11-16-ds-cuarentena-dev.mjs`, resuelve ids en vivo, sin ids en el repo).
- `scripts/data-fixes/2026-11-16-ds-encender-dev.mjs` (`--apagar` revierte): instancia de staging con `permitir_entrada/salida=true`; política habilitada para `salida_inventario`, `entrada_inventario`, `retiro_material`, `conduce_externo`, `conteo_inventario`, `ajuste_faltante`; fases **canary + expansion** ON (canary: par WH→TA, 4 artículos homologados con existencias en Odoo, usuario QA admin; 5 ratificaciones ADR de dev). **`corte` y `contraccion` siguen apagadas.**
- Scheduler del worker: cron `sgc-odoo-sync` cada minuto (migración nueva, ver bugs). `odoo-sync` v25+ y `odoo-conciliar` desplegados en dev.

## Resultado E2E real (script `scripts/odoo-e2e-dev-staging.ts`, 35/35 comprobaciones)
`deno run --no-check --allow-env --allow-net --allow-read --allow-sys scripts/odoo-e2e-dev-staging.ts --env dev` — crea documentos reales en dev con RPC como QA admin, deja que el worker (edge de dev) publique a staging y verifica en Odoo (pickings, estados, saldos). Todo lleva la marca `E2E-<run>`.

| Flujo | Resultado en Odoo staging |
|---|---|
| Conduce despachado | picking A WH→tránsito hecho, cantidad exacta; sync «sincronizado» |
| Entregado completo | B tránsito→TA hecho; saldos WH −5, TA +5, tránsito intacto; reproceso no duplica |
| Entregado incompleto (4 de 6) | B con lo recibido; nace UNA solicitud de faltante (2) |
| Faltante aprobado | baja desde tránsito; tránsito vuelve a su saldo |
| Faltante rechazado | devuelto a origen en Odoo y en SGC (+3) |
| Anulado tras despachar | devolución A (`-D1`); saldos vuelven |
| Artículo fuera del piloto | el canary lo retiene (nada en Odoo) |
| Entrada con OC | parcial 6/10 → backorder → 2.ª entrada 4 cierra; reintento no suma; entrada libre +3; pendiente de confirmar no mueve |
| Conduce externo | ligado a salida: publica ESA salida; logístico: nada |
| Retiro | solicitado: nada; recibido: obra→cuarentena (−2/+2); descarte: scrap |
| Conteo | borrador/contado: nada; aplicado: Odoo = objetivo; repetido: un efecto; deshacer: compensa |
| Conciliador (diaria + sondeo) | HTTP 200, 0 deriva sobre los conduces del E2E, 0 inciertos, 0 `fuera_de_canal`/`saldo_distinto` |
| Limpieza (pasar a prueba = compensación DS-19) | conduces/retiros/conteos revertidos; las 2 entradas que ya validaron OC quedan **bloqueadas con motivo** (se esperaba); saldos finales = iniciales |

Residuos en staging: la OC `E2E-*` (confirmada, recibida y devuelta a mano; SGC no puede cancelarla), las ubicaciones de cuarentena (se quieren) y movimientos de inventario de neto cero. El script restaura el stock de SGC dev de los artículos piloto. La baja por faltante aprobado es una pérdida real y no se revierte sola: el script la repone con una limpieza manual **declarada** en su salida.

## Bugs reales hallados y corregidos
1. **Nadie ejecutaba el worker** (`odoo-sync` sin cron/trigger): los eventos solo se publicaban a mano. Migración `sql/2026-11-16-w3-odoo-sync-cron-backoff.sql`: cron `sgc-odoo-sync` (solo llama si hay eventos reclamables) y la edge pasa a `verify_jwt=false` con autorización que **falla cerrado** (`_shared/odoo-sync-auth.ts`, 4 tests).
2. **Backoff ignorado**: `odoo_v1_finalizar_evento` descartaba `p_reintentar_en` y el evento volvía a «pendiente» al instante (martilleo a Odoo; un evento fuera de canary se reclamaba en cada pasada). Nueva columna `proximo_intento_en`, honrada al reclamar; «Reintentar» manual la limpia (trigger).
3. **Stock fantasma al compensar un conduce con faltante ya resuelto** (real→prueba tras aprobar/rechazar el faltante): se devolvía el A completo y se duplicaba lo ya dado de baja/devuelto. Ahora `faltanteResuelto` se descuenta del A (`restarFaltante`; 2 tests).
4. **Retiro real→prueba no compensaba nada** (el publicador devolvía «es_prueba» sin tocar Odoo): quedaba material en cuarentena/scrap en Odoo mientras SGC lo revertía. Ahora devuelve disposición y recepción (idempotente; 2 tests).
5. **Conciliador: falsos `picking_huerfano`** para pickings legítimos de salidas anuladas/de prueba (devoluciones `-D`, complementos `-C`, faltantes `-F`): ahora solo es huérfano el que ninguna salida de SGC reclama (1 test). Las 7 huérfanas que siguen son pickings de pruebas de contrato anteriores sin id de salida.
6. Script: una devolución manual de dos recepciones con el mismo `origin` se reutilizaba (solo revertía la primera) — error del propio script, corregido.

## Qué NO se pudo probar
- **Entrada ligada a una salida** (recepción en obra / devolución de obra con descuento) y **devolución de obra**: se probaron solo en tests Deno y en contrato, no por documento real en dev.
- **Reparación y devolución a proveedor** de un retiro (solo descarte por documento real).
- **PDF firmado como adjunto** (falta el cliente que sube el PDF; sin PDF no hay adjunto).
- **Fase `corte`** (apertura y proyección de stock): apagada a propósito.
- **Comparación de saldos del conciliador** (`odoo_bodegas_piloto` vacío): el stock sintético de SGC dev no coincide con el de Odoo staging; los saldos se verificaron en el script, no con el conciliador.
- **Dos semanas de sombra real**, usuario dedicado de integración, y cualquier cosa contra el Odoo real o prod.
- `npm run build` queda detenido por una guarda ajena a W3: `docs/avance-lotes/W3-ui.md` cita una migración con puntos suspensivos («w3c-…») y la guarda CD10 no la encuentra.
