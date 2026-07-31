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
