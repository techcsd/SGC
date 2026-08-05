# AG15 — Tareas dinámicas: contrato backend para la app (PROMPT-6)

Estado: **backend aplicado en prod** (migración `sql/2026-08-05-ag15-tareas-dinamicas.sql`). Las tareas sin vínculo funcionan igual que antes (retrocompatible).

## Modelo (columnas nuevas en `sgc.tareas`)
| Columna | Tipo | Uso |
|---|---|---|
| `linked_tipo` | text | `conduce` \| `ruta` \| `mantenimiento` \| `cronograma` (null = tarea normal) |
| `linked_id` | uuid | id de la entidad vinculada; **null hasta crearla** (caso conduce: se crea al iniciar) |
| `linked_params` | jsonb | parámetros de pre-llenado que el asignador definió (ver abajo) |
| `auto_completada` | boolean | true si la tarea se completó por sincronización (no manual) |

## `linked_params` sugeridos por tipo (v1)
- **conduce**: `{ bodega_id, proyecto_id (obra destino), vehiculo_id?, items?: [{articulo_id, cantidad, talla?}] }`
- **ruta**: `{ vehiculo_id?, destino_proyecto_id?, tipo? }`
- **mantenimiento**: `{ vehiculo_id, motivo? }`
- **cronograma**: `{ proyecto_id, cronograma_tarea_id }`

## Flujo esperado en la app
1. **Asignar** (asignador): crea la tarea con `linked_tipo` + `linked_params`. `linked_id` queda null (salvo cronograma/ruta/mantenimiento ya existentes, que pueden pasar `linked_id` directo).
   - Web/app usan `TareasService.create({..., linkedTipo, linkedParams })`.
2. **Iniciar** (asignado, en la app): si `linked_tipo='conduce'` y `linked_id` es null → la app abre el flujo de conduce **pre-llenado** con `linked_params` y llama a `crear_conduce_transportista(...)`. Con el id devuelto:
   - `select vincular_tarea_entidad(p_tarea_id, 'conduce', <salida_id>)`.
   - (para ruta/mantenimiento: análogo con su RPC de creación + `vincular_tarea_entidad`).
3. **Completar la entidad**: cuando la entidad llega a su estado "hecho", un **trigger** completa la tarea sola (`estado='completada'`, `auto_completada=true`) y **notifica al asignador** (in-app + push):
   | tipo | entidad | estado que dispara |
   |---|---|---|
   | conduce | `sgc.salidas_inventario` | `entregado` / `entregado_incompleto` |
   | ruta | `sgc.rutas` | `completada` |
   | mantenimiento | `sgc.mantenimientos` | `completado` |
   | cronograma | `sgc.cronograma_tareas` | `completada` |

## RPCs
- `sgc.vincular_tarea_entidad(p_tarea_id uuid, p_tipo text, p_entity_id uuid)` → void. Guarda `linked_id`; si la entidad ya está hecha, completa la tarea al instante. Autoriza: asignado / asignador / admin.
- `sgc.sincronizar_tareas_vinculadas(p_tipo text, p_entity_id uuid)` → void. La llaman los triggers; normalmente la app no la llama directo.

## Notas de diseño
- La sincronización es **server-side** (triggers) → funciona sin importar por dónde se cierre la entidad (web, app, otra ruta). No depende de que la app "avise".
- El asignador siempre recibe la notificación de auto-completado (fuente única de verdad del estado).
- Extensible: agregar un tipo nuevo = ampliar el CHECK de `linked_tipo` + un trigger en la tabla de esa entidad que llame `sincronizar_tareas_vinculadas('<tipo>', NEW.id)`.

## Pendiente (no bloquea la app)
- **Web (padre)**: el drawer de asignar tarea (`/tareas` → gestión) puede exponer un selector de `linked_tipo` + campos de `linked_params`. El modelo y `TareasService.create` ya lo soportan; falta el formulario. La app (PROMPT-6) es el consumidor principal del flujo iniciar→crear→vincular.
