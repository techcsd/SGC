# Runbook de reversa — traslados SGC ↔ Odoo (DS-13)

Sin hosts, usuarios ni ids (repo público). Todo en **dev/staging** hasta que Xaviel dé el OK a producción.

## 1. Apagar la publicación (lo primero, siempre)
1. En `sgc.odoo_publicacion_politica` deja `habilitada=false` para `salida_inventario` (o borra la fila). El worker deja de reclamar eventos; los nuevos se siguen capturando y quedan `pendiente`.
2. Si hace falta cortar también las lecturas/escrituras OC: secret `ODOO_ESCRITURA_HABILITADA` ≠ `true` (la OC vuelve al simulador) y `sgc.odoo_instancias.permitir_salida=false`.
3. Cinturón de seguridad: quitar el host de `ODOO_HOSTS_ESCRITURA` bloquea TODA escritura a Odoo aunque algo siga encendido.

## 2. Qué quedó a medias
- Conduces con `odoo_sync_estado` en `error`/`incierto`/`pendiente`: Tecnología › Sincronización con Odoo, o el detalle del conduce.
- Pickings creados por SGC: `stock.picking.origin` empieza por `SGC-TRAS-<id de la salida>-A|B` (devoluciones: `…-D<n>`).

## 3. Deshacer un traslado
- **A o B en borrador/asignado:** cancelar (`action_cancel`). Lo hace solo el worker al anular un conduce.
- **A o B ya validado:** NO se cancela; se **devuelve** (traslado inverso con origen `…-D1`). Anular el conduce en SGC lo dispara solo (B primero, luego A).
- **Material en tránsito** sin paso B (> 72 h): revisar la parada de ruta; si el conduce nunca llegó, anularlo (devuelve A tránsito → origen).
- **Faltante real** (recibido < enviado): el faltante queda en tránsito a propósito; se resuelve con una solicitud de ajuste aprobada por el jefe de inventario/admin (ADR 5). No se corrige a mano en Odoo.

## 4. Adoptar pickings huérfanos
Un picking `SGC-TRAS-…` sin salida activa en SGC lo reporta el conciliador (`picking_huerfano`). Si la salida existe pero falló el vínculo, re-encolar con `odoo_v1_encolar_salida(<salida>)`: el worker lo **adopta por `origin`** (no crea otro). Si no existe salida, devolver/cancelar el picking en Odoo.

## 5. Stock negativo
El Odoo de CSD **permite stock negativo** (medido). SGC consulta lo disponible antes de validar; si alguien valida a mano fuera de SGC, aparece como `fuera_de_canal` en el conciliador.

## 6. Limpieza de pruebas en staging
Los scripts de contrato/soak usan `origin` `SGC-TRAS-TEST-<run>…` y revierten lo que crean. Si una corrida se corta, cancelar los borradores `SGC-TRAS-TEST-%` y devolver los validados.
