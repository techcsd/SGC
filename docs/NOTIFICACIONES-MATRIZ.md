# Matriz de notificaciones — SGC (AT23)

Fuente única de la verdad de "quién recibe qué". Toda notificación in-app + push
pasa por **5 helpers SQL** en el esquema `sgc`; el correo de requisiciones va aparte
por edge function. Los destinatarios de los eventos con matriz son **configurables
por parámetro** (`sgc.parametros`) sin tocar código.

> Ronda AT (20/08/2026). Decisión de diseño: **no** se reescribe todo en una tabla
> matriz única (riesgo alto, poco beneficio) — la infraestructura ya está unificada
> en los 5 helpers y el único evento con fuga (conduce por confirmar) ya estaba
> centralizado y parametrizado. Se hizo el **fix puntual de AT17** + esta doc.

## Helpers (canal in-app + push)

| Helper | A quién llega | Notas |
|---|---|---|
| `notificar(usuario,…)` | UN usuario | + push. Uso: avisos dirigidos (firma, ruta asignada, incentivo, etc.) |
| `notificar_modulo(modulo,…)` | usuarios cuyo rol tiene ese módulo (o admin) y **no** son `es_operativo` | + push. Uso: alertas de flota, material no catalogado |
| `notificar_rol(rol,…)` | usuarios con `roles.codigo = rol` | + push. Uso: bitácora chofer, aviso vehículo, solicitud de movimiento |
| `notificar_flota_elevado(…)` | `admin,direccion,gerencia,jefe_flota` (hardcoded) | ⚠️ no incluye `logistica` (inconsistente con `es_flota_elevado()`) |
| `notificar_todos(…)` | todos los activos | admin-gated |

## Eventos → destinatarios

| Evento | Helper / matriz | Destinatarios | Configurable |
|---|---|---|---|
| Conduce firmado por despachante | `notificar` | chofer (`creado_por`) | — |
| **Entrega por confirmar** | `confirmadores_de_conduce(salida)` | ver abajo (ramas A–F) | **sí** (params) |
| Firma pendiente / completada | `notificar` | firmante designado / ambos | — |
| Ruta asignada | `notificar` | chofer | — |
| Requisición creada | edge `notificar-solicitud` + `usuarios_destinatarios_requisicion()` | módulo inventario + gerente_produccion/proyectos + jefe_ingenieros | RPC |
| Requisición aprobada/rechazada | edge `notificar-solicitud` | solicitante | — |
| Material no catalogado (en conduce) | `notificar_modulo('inventario')` | inventario + admin (no operativos) | — |
| Material declinado (AT11) | `notificar` | el que lo reportó | — |
| Echada / consumo anómalo | `notificar_modulo('flota')` | flota + admin (no operativos) | — |
| Aviso de vehículo (voz/video) | `notificar_rol` × `aviso_vehiculo_roles` | jefe_flota,logistica,admin,gerencia | **sí** (param) |
| Solicitud de movimiento | `notificar_rol` × lista | jefe_flota,logistica,coord_compras,guarda_almacen,gerencia,direccion | **sí** |
| Incentivo aprobado/declinado (AT3) | `notificar` | el chofer (a "Mi rendimiento") | — |
| Informe de incentivo (lunes) | email + push por módulo `incentivos` | Logística, Gerencia, Admin | rol/módulo |
| Bitácora (alertas) | `notificar_rol` / `notificar_flota_elevado` | chofer_transportista / elevados | — |

## `confirmadores_de_conduce(salida)` — la matriz del "por confirmar"

Unión de ramas, menos el actor/emisor/entregador:

- **A** — `proyecto_responsables` de la obra destino (activos)
- **B** — `firma_pendiente_usuario_id` (receptor designado — **AT16**: aquí cae el receptor elegido)
- **C** — `can_confirm_reception` vinculado a esa obra
- **D** — roles `confirmacion_roles_obra` **si están ligados a la obra** → `capataz,ingeniero_campo,gerente_produccion`
- **E** — roles `confirmacion_roles_globales` (company-wide, sin vínculo) → **`admin,logistica`** ⬅ *AT17: se redujo de 7 roles a estos 2*
- **F** — si hay `destino_almacen_id`: roles `confirmacion_roles_almacen` → `almacenista,jefe_almacen,encargado_almacen,logistica,gerente_proyectos`

### Parámetros tunables (`sgc.parametros`)
```
confirmacion_roles_globales = admin,logistica         (AT17 — antes: admin,direccion,gerencia,gerente_proyectos,jefe_flota,logistica,ingeniero_oficina)
confirmacion_roles_obra     = capataz,ingeniero_campo,gerente_produccion
confirmacion_roles_almacen  = almacenista,jefe_almacen,encargado_almacen,logistica,gerente_proyectos
aviso_vehiculo_roles        = jefe_flota,logistica,admin,gerencia
```
Cambiarlos ajusta a la vez **quién recibe** el aviso y **quién puede confirmar**
(la bandeja `mis_entregas_por_confirmar` y `es_confirmador_de_conduce` leen la misma
función), así que Gerencia/Dirección/Jefe de ingenieros **ven** todo por sus vistas
de supervisión pero ya **no** reciben un push por cada conduce.

## El "9+" del campanario
`notificaciones` no tiene columna `es_prueba` ni filtro de alcance al leer — el
contador = filas no leídas que la RLS deja ver. Se infla precisamente por la rama E
company-wide; con el fix de AT17 el volumen baja a lo que de verdad le corresponde
a cada usuario.

## Pendientes / mejoras futuras
- `notificar_flota_elevado()` hardcodea 4 roles y **omite `logistica`** — candidato a
  volverlo parametrizable (no se tocó ahora para no cambiar el alcance de bitácora/
  traspasos sin pedirlo).
- **AT16** — selector de receptor al crear el conduce: backend listo
  (`receptores_disponibles(proyecto,bodega)` + rama B por `firma_pendiente_usuario_id`);
  falta la UI (principalmente en la app, crear-conduce del transportista).
