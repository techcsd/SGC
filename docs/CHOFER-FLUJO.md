# Flujo del chofer — Transporte (AD6, 31/07/2026)

Objetivo: darle al chofer sus funciones de logística/inventario **dentro de
Transporte**, sin el módulo Inventario completo. SGC (padre) define el modelo y
los RPCs; la app (csd-app, PROMPT-16) los consume.

## Día a día real del chofer (research)

1. **Traslado de material entre obras / recepción** — recibe y mueve mercancía
   con conduce.
2. **Recibir conduces con firmas** — emisor y receptor firman (AC7).
3. **Ferretería / suplidor** — va a comprar o a retirar una compra ya hecha.
4. **Transporte de personal** — recorrido matutino repartiendo personal entre
   obras (no lleva carga).
5. **Traslado sin carga** — se mueve a otra obra vacío.
6. **Esperas / carga / descarga** — tiempos de ruta.

Referencia de prácticas: recepción en 2 pasos estilo Odoo (el chofer registra el
movimiento, **Almacén valida** antes de tocar stock) y prueba de entrega con firma
(ePOD) — que ya teníamos con `salida_firmas` (AC7). Tipos de viaje material vs.
traslado vacío (deadhead) vs. personal.

## Principio de integridad (antifraude)

El chofer **nunca sube stock por su cuenta**. Todo lo *inbound* (compra/recepción)
queda **PENDIENTE** hasta que Almacén lo confirma. Lo *outbound* (conduce) ya valida
stock en el servidor.

## Identidad y permisos

- El chofer es una fila de `sgc.conductores` ligada por `usuario_id`; entra por
  cédula+PIN (edge `conductor-login`). `sgc.es_chofer()` lo identifica.
- Módulo nuevo **`transporte`** (aditivo). Hoy el rol *Chofer / Transportista*
  (id 19) tiene `['flota','inventario','transporte']`. **PENDIENTE (PROMPT-16):
  quitar `inventario` una vez que la app tenga estas funciones** — no antes, para
  no dejar al chofer sin herramientas.

## Contrato de RPCs para la app (todos SECURITY DEFINER, gate por chofer)

### Ya existían (REUTILIZAR, no reimplementar)
| RPC | Para qué |
|---|---|
| `crear_conduce_transportista(p_id,p_fecha,p_bodega_id,p_proyecto_id,p_observaciones,p_vehiculo_id,p_ruta_id,p_items jsonb)` | Crear conduce (salida) — valida stock, idempotente. |
| `entregar_conduce(p_salida_id,p_items,p_receptor,p_firma_url,p_foto_url,p_notas)` | Cerrar la entrega (cantidades + firma + foto). |
| `firmar_conduce(p_salida_id,p_rol,p_nombre,p_firma_path,p_cedula,p_rol_desc,p_metodo,p_usuario_id)` | Firma emisor/receptor (AC7). |
| `confirmar_recepcion_salida(p_salida_id,p_items,p_notas,p_receptor,p_foto_path)` | Confirmar recepción; crea la entrada en la obra (T15). |
| `set_ruta_paradas(p_ruta_id,p_paradas jsonb)` | Reemplaza las paradas de una ruta. |
| `ruta_detalle_transporte(p_ruta_id)` | Conduces + notas de voz de una ruta. |

### Nuevos (AD6)
| RPC | Firma | Efecto |
|---|---|---|
| `chofer_crear_ruta` | `(p_id uuid, p_tipo text, p_fecha date, p_origen text, p_destino text, p_vehiculo_id uuid, p_destino_proyecto_id uuid, p_notas text, p_paradas jsonb)` → uuid | Crea ruta con `tipo` ∈ material\|personal\|traslado (estado `planificada`), resuelve el conductor por `auth.uid()`, usa el vehículo indicado o el asignado al chofer, y setea las paradas. Idempotente por `p_id`. |
| `chofer_registrar_compra_ferreteria` | `(p_id uuid, p_fecha date, p_bodega_id uuid, p_proveedor_id uuid, p_proyecto_id uuid, p_orden_compra_id uuid, p_referencia text, p_observaciones text, p_foto_path text, p_items jsonb)` → uuid | Crea una entrada **PENDIENTE** (`pendiente_confirmacion=true`, `origen_tipo='compra'`, `items_propuestos=p_items`) **sin mover stock**. Puede enlazar una orden de compra. Idempotente por `p_id`. Notifica a Inventario. |
| `confirmar_entrada_chofer` | `(p_entrada_id uuid, p_items jsonb)` → boolean | **Almacén/Inventario** confirma (opcionalmente ajusta `p_items`): materializa `detalle_entradas` (sube stock por el trigger), limpia el pendiente y, si venía de una OC, la marca `recibida`. Idempotente. |

### Tipos de ruta
`sgc.rutas.tipo text default 'material' check (tipo in ('material','personal','traslado'))`.
Una ruta `personal`/`traslado` **no exige carga**. `ruta_paradas` ya modela los
puntos de reparto (ubicación/lat/lng/proyecto/notas). *(Mejora futura: `personas`
por parada si se quiere headcount.)*

## Visibilidad en la web (padre)

- **Inventario › Entradas**: las compras de ferretería del chofer aparecen con el
  badge **"⏳ Por confirmar"** y un botón **Confirmar** (materializa stock).
- **Flota › Rutas**: chip del tipo de ruta (📦 Material / 👷 Personal / 🚚 Traslado)
  y selector de tipo en el alta/edición.
- **Compras › Órdenes**: al confirmar una entrada ligada a una OC, la OC pasa a `recibida`.
- Los conduces del chofer ya se ven en Inventario › Salidas/Conduces (RLS existente).

## Pendiente para PROMPT-16 (app)

1. Hojas del chofer en Transporte: "Recibir mercancía", "Conduces", "Compra/retiro
   en ferretería", "Crear ruta (tipo)" — todas offline/outbox.
2. Consumir los RPCs de arriba (los 3 nuevos + reutilizar los existentes).
3. **Coordinar el revert**: quitar `inventario` del rol chofer solo cuando estas
   hojas estén publicadas y probadas.

---

# AE5 — Rutas con carga: paradas ↔ conduces (31/07/2026 PM)

Extiende el flujo del chofer: una ruta de **material** puede llevar carga a varias
**paradas**, y cada parada puede tener un **conduce** (salida de material) atado. Al
entregarse la parada, el conduce queda **trazado**: en qué ruta viajó, a qué parada,
cuándo y quién recibió.

## Flujo objetivo (research del chofer de construcción)

1. **Planificar la ruta** (tipo `material`): el chofer define paradas ordenadas
   (`ruta_paradas`, AC13) — cada una con ubicación, obra destino opcional y notas.
2. **Asignar carga por parada**: por cada parada donde deja material, el chofer
   **crea o elige un conduce propio** (`crear_conduce_transportista`) y lo **vincula**
   a esa parada (`vincular_conduce_parada`). El conduce indica qué material va a esa
   parada. Un conduce puede quedar a nivel ruta (sin parada) o a una parada concreta.
3. **Ejecutar**: cada parada avanza `pendiente → en_camino → entregada` (`avanzar_parada`).
   - Si la parada tiene conduce, al **confirmar la recepción del conduce**
     (`confirmar_recepcion_salida` / `entregar_conduce`, con firma AC7 emisor+receptor
     y foto), un **trigger** marca la parada `entregada` automáticamente y copia la
     evidencia (foto/firma/receptor) a la parada. Traza cerrada.
   - Si la parada **no** tiene conduce (traslado/personal), el chofer la cierra con
     `avanzar_parada(estado='entregada', …)` (evidencia opcional).
4. **Tiempos**: `llegada_at` al pasar a `en_camino`, `entregada_at` al entregar.

## Modelo aditivo (aplicado en `sql/2026-08-01-ae5-ruta-parada-conduce.sql`)

- `ruta_paradas +=` `estado` (`pendiente|en_camino|entregada|omitida`), `llegada_at`,
  `entregada_at`, `entregado_a`, `foto_path`, `firma_path`, `notas_entrega`.
- `salidas_inventario += ruta_parada_id` (FK → `ruta_paradas`, `on delete set null`).
  Se conserva `ruta_id` (nivel ruta) — el vínculo a parada es adicional, no lo sustituye.
- `set_ruta_paradas` ahora **reconcilia por `id`** (no borra-todo): al re-planificar se
  conservan estado/evidencia de paradas ya en camino/entregadas; solo se borran paradas
  que ya no vienen **y** siguen `pendiente`. Retrocompatible con paradas sin `id` (insert).

## Matriz de visibilidad de conduces  ⚠️ (Xaviel valida)

Quién ve un conduce (`salidas_inventario`) y cómo — **ya implementada por RLS** (Z22 +
`2026-07-03-transporte-trazabilidad`); el vínculo a parada solo enriquece la traza, no
relaja la RLS:

| Actor | ¿Ve el conduce? | Cómo le aparece |
|---|---|---|
| **Admin** (`is_admin()`) | Todos | Inventario › Conduces/Salidas; detalle con ruta+parada. |
| **Almacén / Inventario** (`tiene_modulo('inventario')`) | Todos | Igual que admin; confirma recepciones. |
| **Emisor / creador** (`creado_por = auth.uid()`) | Los suyos | Sus conduces creados. |
| **Chofer asignado** (`conductor_id.usuario_id = auth.uid()`) | Los suyos/asignados | En su ruta: "pendientes de transporte"; puede vincular a parada y cerrar. |
| **Obra destino** (miembro de `proyecto_empleados` del `proyecto_id` del conduce) | Los dirigidos a su obra | Recepciones a su obra. |
| **Cualquier otro** | Ninguno | — |

> Nota: la visibilidad a la **obra destino** depende de `salidas_inventario.proyecto_id`.
> En una ruta multi-parada con obras distintas por parada, cada conduce lleva su propio
> `proyecto_id` (la obra de su parada), así que cada obra ve solo lo suyo.

## Contrato para la app (PROMPT-18 · FASE 4)

RPCs nuevos (SECURITY DEFINER; permiso = elevado / creador del conduce / chofer asignado
o creador/conductor de la ruta):

| RPC | Firma | Efecto |
|---|---|---|
| `vincular_conduce_parada` | `(p_salida_id uuid, p_ruta_parada_id uuid)` → void | Ata un conduce a una parada (y a su ruta). `p_ruta_parada_id = null` desvincula. |
| `avanzar_parada` | `(p_parada_id uuid, p_estado text, p_foto_path text, p_firma_path text, p_entregado_a text, p_notas text)` → void | Mueve la parada de estado con evidencia opcional (firma AC7-style). Estados: `pendiente\|en_camino\|entregada\|omitida`. |
| `conduce_ruta_info` | `(p_salida_id uuid)` → jsonb\|null | Ruta+parada de un conduce (para el detalle del conduce). |
| `ruta_detalle_transporte` | `(p_ruta_id uuid)` → jsonb | **Ampliado**: ahora devuelve `paradas[]` (con estado, evidencia y `conduce_id` vinculado) además de `conduces[]` (con `ruta_parada_id`/`parada_ubicacion`) y `notas_voz[]`. |

Reutilizar: `crear_conduce_transportista` (pasar `p_ruta_id`), `set_ruta_paradas`
(ahora acepta `id` por parada para preservar estado), `firmar_conduce`,
`confirmar_recepcion_salida`/`entregar_conduce` (dispara el auto-cierre de la parada).

UI app sugerida:
- **Crear ruta** (rediseño): paradas dinámicas; por parada un selector "Adjuntar conduce"
  (solo conduces propios/asignados **despachados**, sin ruta_parada). Botones **Iniciar**
  y **Cómo llegar** con estilo de botón real. Progreso por parada (chip de estado).
- El conduce transportado muestra en su detalle la ruta/parada (`conduce_ruta_info`).

## Estado web (padre, hecho en AE5)
- **Flota › Rutas › detalle**: paradas con chip de estado + obra + conduce vinculado +
  hora/receptor de entrega; cada conduce de la ruta muestra su parada.
- **Inventario › Conduce (detalle)**: bloque "Ruta de transporte" con enlace a la ruta
  (`?item=<ruta_id>`) y la parada donde viaja.
