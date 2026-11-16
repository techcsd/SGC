# Avance W2 — UI pendiente de la ronda DS (16-nov-2026)

Solo web + RPC aditivas, aplicadas SOLO a dev (ledger). Nada en prod. Build y `npm test` (367) verdes.

Migración: `sql/2026-11-16-w2-odoo-estado-documento-y-cuenta-oc.sql` (dev, ledger): `odoo_documento_sync_estado(tipo, id)` (Tecnología/admin), `proyecto_cuentas_analiticas_para_oc(proyecto)` y `oc_elegir_cuenta_analitica(orden, cuenta)` (Compras/admin; valida que la cuenta pertenezca a la obra).

## Hecho
1. **Estado de sync + «Reintentar»** (DS-16/18/19/21/22): componente `src/shared/ui/odoo-sync-estado` (solo Tecnología/admin; reintenta con `odoo_reintentar_documento`, solo en error/incierto). Puesto en: detalle de entrada (`entradas.html`), detalle de retiro (`retiros.html`), detalle de conteo/ajuste (`conteos.html`) y ficha de conduce externo. Servicio: `OdooSyncService.estadoDocumento/reintentarDocumento`; tipos en `odoo-sync.model.ts`.
2. **Selector de cuenta analítica al crear OC** (DS-06): `compras/ordenes` — aparece solo si la obra tiene más de una cuenta; se guarda tras crear la OC (un fallo avisa pero no bloquea; queda la principal).
3. **KPI solicitudes atascadas** (DS-33): tarjeta en Dashboard con `solicitudes_material_kpi()`; enlaza a `/inventario/pendientes-cierre`; se oculta si la RPC devuelve `{}` (sin acceso).
4. **Salud de combustible** (DS-37): banda en `flota/combustible` con `flota_salud_combustible()` (importación caída / al día, última echada, km pendientes, registros 30 d).
5. **Métrica «entradas con OC»** (DS-35/38): en `/admin/adopcion` con `adopcion_entradas_con_oc()`.
Todo con `t()`, 15 claves nuevas en `en.json` y `ht.json`, SVG (sin emojis), tokens CSS.

## No hecho / notas
- El selector de cuenta analítica no está en `compras/ordenes-odoo` (flujo CY24 separado) ni en la aprobación de solicitud de compra (rama `solicitudesCompraService.aprobar`): ahí no se guarda la elección.
- Las cuentas analíticas se muestran como `#id` (la tabla no guarda nombre de Odoo).
- Sin prueba en navegador con sesión real (solo build/tests y SQL aplicada a dev); no hay filas de sync de prueba que ver en las pantallas.
- Los retiros/conteos no se re-listan en `/tecnologia/odoo-sync`; no se tocó.
- Notas de versión (Y1), `DATOS-Y-TERCEROS.md` (sin datos/terceros nuevos) y `graphify update .`: coordinador.
