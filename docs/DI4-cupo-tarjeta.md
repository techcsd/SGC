# DI4 — Cupo de tarjeta de combustible (Ronda DI, PROMPT-134/135)

Decisión de Xaviel: **"Solicitud manual + cupo opcional por tarjeta"** — el sistema no conoce el
límite real de la tarjeta (vive en TotalEnergies); Flota lo anota si quiere, y el chofer pide más
cupo manualmente cuando lo necesita.

## Tablas (`sql/2026-11-03-di4-tarjeta-cupo.sql`)

- `sgc.combustible_tarjeta_map` gana `cupo_gal`, `cupo_monto`, `cupo_dia_corte` (nullables — sin
  cupo anotado no hay barra ni alertas, nunca se inventa un límite).
- `sgc.combustible_solicitudes_cupo` — una fila por solicitud del chofer. Único índice parcial
  `(codigo_tarjeta, solicitante_id) where estado='pendiente'`: reenviar devuelve la pendiente
  existente, no duplica.
- `sgc.combustible_tarjeta_alertas` — idempotente por `(codigo_tarjeta, periodo, umbral)`: el aviso
  de 80%/100% se dispara una sola vez por período.

## RPCs

| RPC | Quién | Qué hace |
|---|---|---|
| `solicitar_cupo_tarjeta(codigo, vehiculo_id?, galones?, monto?, motivo, nota?, foto?)` | chofer | crea/devuelve la solicitud pendiente, avisa a Flota |
| `mi_tarjeta_vehiculo(vehiculo_id)` | chofer/app | solo lectura: tarjeta mapeada a ese vehículo + consumo del período. Sin mapeo → 0 filas (el chofer escribe los 4 últimos dígitos a mano) |
| `atender_solicitud_cupo(id, 'ampliada'|'rechazada', respuesta?, nuevo_cupo_gal?, nuevo_cupo_monto?)` | Flota (`es_flota_elevado()`) | responde; si amplía con un cupo nuevo, lo escribe en el mapa |
| `cancelar_solicitud_cupo(id)` | chofer (mientras pendiente) | — |
| `mis_solicitudes_cupo()` | chofer | sus propias solicitudes |
| `combustible_solicitudes_cupo_listado(estado?)` / `combustible_cupo_tarjetas_listado()` | Flota | bandejas con nombres/placas resueltos |
| `editar_cupo_tarjeta(codigo, cupo_gal?, cupo_monto?, cupo_dia_corte?)` | Flota | anota/borra el cupo sin pasar por una solicitud |
| `tarjeta_periodo_rango(dia_corte, fecha)` / `tarjeta_consumo_periodo(codigo, fecha)` | interno | calculan el ciclo de facturación (mes calendario si no hay día de corte) y el consumo acumulado |

## Alerta 80%/100%

Enganchada **dentro de `registrar_combustible_app`** (no hay cron nuevo): cada vez que se registra
una echada con `p_tarjeta`, si esa tarjeta tiene cupo anotado se recalcula el % del período y, si
cruza 80% o 100% por primera vez, se notifica a Flota y al dueño de la echada (`tarjeta_cupo_alerta`).

## Bandeja web

`/flota/cupos-combustible` (`flotaElevadoGuard`) — pestañas "Solicitudes de cupo" / "Cupos de
tarjetas", ambas paginadas (`app-paginador`, DI8). CSS pendiente de aprobar el board DI4 (ver
`// CSS tras OK` en el componente).

## Pendiente (app, PROMPT-135 F6)

Botón "Pedir más cupo" en Registro de combustible y en el detalle del vehículo/uso → hoja con
motivo/galones/foto → `solicitar_cupo_tarjeta`. Mostrar "te quedan ~N gal" con `mi_tarjeta_vehiculo`.
