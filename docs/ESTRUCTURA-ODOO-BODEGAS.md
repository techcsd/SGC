# Estructura propuesta en Odoo para replicar las bodegas de SGC

Estado: PROPUESTA (8-nov-2026). Medido en solo lectura contra SGC prod y el Odoo real (17.0+e). Nada de esto está aplicado.

## 1. Cómo están hoy
**SGC** (`sgc.bodegas`): lista plana de 29 bodegas (21 activas), sin jerarquía ni tipo. Una central (`es_central`), 27 con proyecto, una "principal de obra" por proyecto (trigger `trg_bodega_principal_obra_unico`). Ya tiene `odoo_instancia_id`, `odoo_compania_id`, `odoo_location_id` y `odoo_warehouse_id`. Un trigger normaliza el nombre. Nombres largos ("Almacén BLUEWAVE - Olea (Cap Cana)"). Fusión de duplicadas con `fusionar_almacenes`.
**Odoo**: 24 almacenes, todos con recepción de 1 paso y entrega `ship_only`. Cada uno trae 5 ubicaciones internas pero **solo una activa** (`X/Existencias`; en el principal `WH/Almacén principal`); Entrada, Salida, Control de calidad y Zona de empaquetado están archivadas. 24 tipos de operación activos de cada clase (recepción, interno, despacho). Códigos de hasta 5 caracteres, algunos con mayúsculas y minúsculas (`Olea`) y uno con espacio (`OF VC`). Ya existen ubicaciones de tránsito (`Physical Locations/Traslado entre almacenes`, `Virtual Locations/Inter-company transit`), de desecho (`Virtual Locations/Scrap`) y de ajuste de inventario (2). Solo 15 ubicaciones internas tienen stock (el principal, 371 productos).
Conclusión: en la práctica **una bodega = un almacén = una ubicación de stock**. El mapeo 1 a 1 ya es la convención de Odoo.

## 2. Estructura propuesta
1. **Una bodega de SGC = un almacén de Odoo.** La ubicación enlazada es `lot_stock_id` (la única activa). No se usan sububicaciones ni rutas de varios pasos.
2. **Se conserva la configuración actual:** recepción de 1 paso, entrega `ship_only`, sin reabastecimiento entre almacenes.
3. **Tres ubicaciones globales** (no por almacén), bajo una vista `SGC`:
   - **Tránsito:** reutilizar `Physical Locations/Traslado entre almacenes`. Solo si Contabilidad pide tránsito en dos pasos.
   - **Faltantes en recepción:** nueva, uso `inventory` (pérdida). Recibe los faltantes aprobados.
   - **Devoluciones SGC:** opcional, para devoluciones de obra.
4. **Código del almacén** (≤5 caracteres, único, sin espacios): se guarda en SGC en una columna nueva `bodegas.codigo_odoo`. Los 16 existentes conservan el código de Odoo. Los nuevos se proponen desde el nombre y se validan contra los códigos de Odoo.
5. **Identidad cruzada con el identificador externo estándar de Odoo** (`ir.model.data`, módulo `sgc`, nombre `bodega_<uuid>`) sobre el almacén y su ubicación. Permite buscar desde Odoo la bodega de SGC sin crear campos personalizados. Sin verificar: que la cuenta de integración tenga permiso para crearlos.
6. **Nombres:** se enlaza por id y no por nombre. SGC escribe el nombre solo al crear; después cada lado puede cambiarlo sin romper el vínculo.

## 3. Mapa de las bodegas existentes (por nombre de proyecto)
| Bodega SGC | Almacén Odoo |
|---|---|
| Bodega Central | `WH` (Almacén principal) |
| Torre Alpha | `TA` |
| Best In Pro - City Place | `CITY` |
| Asa - Residencial Romo | `RSR` |
| Batcon - Interplaza | `INT` |
| Bluewave - Olea | `Olea` |
| Bluewave - Volares | `VOLAR` (probable: "Volare") |
| Brisas City Center | `BCC` |
| Almacén Las Américas | `ALMA` |
| Noval - Poseidonia | `POSE` |
| Noval - Riviera Bay | `RIVI` |
| Rosch - Edif Adm 911 | `ADM11` |
| Torre Bolívar - Losa de Parqueo | `TRB` |
| Vista Cana - Monterezzo | `MONT` |
| Solhe Signature Condos | `SOLSC` |
| Villa Caleton #260 | `VC` (probable: "CALENTON") |
No se homologan: bodegas demo y de prueba (OBRA DEMO ×2, Proyecto Ejemplo 2, Saasasa, TEST) ni las 8 inactivas "fusionado" (apuntan al almacén de su sucesora). Almacenes de Odoo sin bodega en SGC: `CSJ`, `IMPRS`, `CITY2`, `DELMA`, `RM`, `COSMO`, `MCC` y `OF VC`.

## 4. Cómo se replica automáticamente
SGC es el origen del catálogo de bodegas nuevas; para las existentes se vincula (no se crea).
1. **Alta de bodega** en SGC → acción del gateway `almacenes.crear` (rol admin o inventario): busca el almacén por código (idempotente), si no existe crea `stock.warehouse` (nombre, código, 1 paso, `ship_only`), lee `lot_stock_id`, crea los identificadores externos y guarda `odoo_warehouse_id` y `odoo_location_id` en la bodega. El trigger `odoo_v1_proteger_campos` ya protege esas columnas.
2. **Desactivar** una bodega → archiva el almacén solo si su stock es 0; si no, queda marcada y se bloquea.
3. **Fusionar** (`fusionar_almacenes`) → traslado interno del stock del duplicado al canónico y luego archivar el duplicado.
4. **Vincular lo existente** → una pasada con `odoo_homologacion_vincular_bodega` en modo simulación, revisada por Contabilidad.
5. **Conciliación diaria:** almacenes de Odoo sin bodega en SGC y bodegas sin almacén se reportan como deriva.

## 5. Riesgos y decisiones
- Crear un almacén en Odoo genera de golpe ubicaciones, 5 tipos de operación y rutas (por eso hay 121 tipos). Es lo normal pero no es barato ni se borra; el alta debe pasar por dev/sandbox (D-08, BU1).
- El código de 5 caracteres puede chocar; `OF VC` tiene espacio y habría que decidir si se corrige.
- Los saldos iniciales no son estructura: hace falta una apertura por almacén (ajuste de inventario con fecha de corte) antes de que Odoo sea dueño del stock.
- Decisiones: (1) ¿reutilizar el tránsito existente o no usar tránsito?; (2) ¿se crean en SGC las bodegas de los 8 almacenes de Odoo sin contraparte?; (3) ¿se acepta el identificador externo `sgc.bodega_<uuid>` en lugar de campos personalizados con Studio?; (4) ¿quién autoriza crear almacenes en Odoo?
