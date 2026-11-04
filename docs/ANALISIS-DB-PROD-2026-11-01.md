# Análisis de DB prod (csd-core) — 2026-11-01

Solo lectura (SELECT) vía Management API con el token de Doppler `amp/prd`. Script: `scripts/diagnosticos/2026-11-01-db-antipatrones.mjs`. Salida cruda: `qa/db-antipatrones-prod.md` (gitignored).

## Veredicto
La DB es pequeña (238 MB, 335 tablas, 868 índices, 753 políticas RLS, 1150 funciones, 180 triggers), con cache hit 100 % y sin bloat. **El cuello de botella dominante es Realtime (ver abajo); el resto es menor.** Los riesgos son de corrección (cron rotos), de escala futura (RLS, FKs sin índice, tablas de crecimiento) y de mantenibilidad (complejidad).

## Bugs activos (arreglar primero)
1. `sgc-requisiciones-vencidas` falla todos los días (7/7 en 7 d): `requisiciones_vencidas_avisar()` referencia `es_prueba`, columna que no existe. Las requisiciones vencidas no avisan a nadie.
2. `sgc-vehiculos-sin-echada` falló 4/7 días: inserta `tipo='vehiculo_sin_echada'` en `avisos_flota` y viola `avisos_flota_tipo_chk`.
Ambos requieren migración en `sql/` + ledger, primero en dev (reglas BU1/CD10).

## Cuellos de botella / crecimiento
- `chofer_posiciones`: 77 MB, 262 k filas (el 32 % de la DB), 456 seq scans que leyeron 45 M filas. Falta índice en `vehiculo_id`; el purgado diario existe, revisar retención.
- `auditoria`: 41 MB, 47 k filas; 3 de sus índices tienen 0 usos (~7.7 MB) y 2 índices son duplicados (`idx_auditoria_actor_creado` = `ix_auditoria_actor_fecha`). Se escribe en cada cambio, así que cada índice sobrante encarece la escritura.
- `rutas`: 57 k seq scans (25 M filas leídas) con 3 FKs sin índice (`creado_por`, `conductor_id`, `vehiculo_id`) y RLS que evalúa `mis_conductor_ids()`.
- `bitacora_archivos` (27 k seq vs 10 k idx) y `proveedores` (3.4 k seq vs 1.5 k idx): faltan índices en sus filtros habituales.
- `salidas_inventario`: 13 triggers, 11 FKs sin índice y 6 políticas SELECT permisivas (igual `detalle_salidas`). Es la tabla más cara de escribir y de leer bajo RLS.
- `cron.job_run_details`: 71 k filas / 18 MB sin purga.

## Antipatrones
- **RLS**: ~40 políticas usan `auth.uid()` sin `(select auth.uid())`, así que se reevalúa por fila (p. ej. `solicitudes_material`, `reportes_usuario`, `rutas`, `empleados`, `tarea_comentarios`). `is_admin()` (435 usos) y `tiene_modulo()` (400) aparecen en casi todas; tampoco están envueltas. Se pagan por fila al crecer los datos.
- Múltiples políticas permisivas sobre el mismo comando: `detalle_salidas` 6, `salidas_inventario` 6, `usuarios` 5, `articulos` 4.
- 38 FKs sin índice (concentradas en `salidas_inventario`, `registros_combustible`, `rutas`, `avisos_flota`, `incentivo_semana`).
- `proveedor_transporte_map` sin RLS.
- Conexiones `idle` de hasta 30 días (9); no hay `idle in transaction`.

## Redundancias
- Índices duplicados exactos (se elimina el no-constraint): `stock_por_bodega` (pkey = `…articulo_bodega_key`), `vehiculo_entregas` (`uq_entrega_recepcion_abierta` = `uq_ve_abierta`), `fuel_prices`, `obra_avance_snapshots`, `incentivo_informe_version`, `bitacora_orden_detalle`, `auditoria`.
- Índices sin uso: `auditoria` ×3, `domain_checks.type`, `notas.ix_notas_dev_fts`, `articulos.idx_articulos_nombre_trgm`. Ojo: las estadísticas pueden haberse reseteado; confirmar `stats_reset` antes de borrar.
- Cron: 4 jobs de recordatorio/aviso del reporte semanal (`sgc-recordatorio-reporte-semanal-noche/dia`, `sgc-preaviso-…`, `sgc-reporte-semanal-dia`) parecen solapados (no verifiqué sus funciones); `sgc-huecos-tracking` corre cada 5 min a 90 ms de media.

## Consultas por tiempo total (pg_stat_statements, schema `extensions`)
| Consulta | Llamadas | Total | Media |
|---|---|---|---|
| Realtime `list_changes` (wal->>type…) | 11.8 M | 92 831 s | 7.9 ms |
| `pg_timezone_names` (PostgREST/cliente) | 3 687 | 3 306 s | 897 ms |
| `detectar_huecos_tracking()` (cron 5 min) | 24 456 | 2 202 s | 90 ms (máx 2.3 s) |
| RPC `mis_entregas_por_confirmar()` | 13 135 | 2 077 s | 158 ms (máx 6.3 s) |
| vista `v_reporte_semanal_cumplimiento` | 20 299 | 1 811 s | 89 ms |
| `salidas_inventario` (select REST) | 17 955 | 1 504 s | 84 ms |
| `mis_preferencias()` | 16 102 | 1 230 s | 76 ms |
| `stock_por_bodega` (select REST) | 1 034 | 956 s | **924 ms** |
| `mis_firmas_pendientes()` | 30 001 | 903 s | 30 ms |

**El cuello de botella nº 1 es Realtime**: ~70 % del tiempo total de DB. Más de 11 M polls de `list_changes` y 200 k consultas a `pg_publication_tables` indican demasiadas tablas/suscripciones en la publicación `supabase_realtime`. Otros: `pg_timezone_names` a 897 ms por llamada (viene de un cliente que la pide en cada carga), RPCs de arranque de sesión (`mis_preferencias`, `mis_firmas_pendientes`, `mis_entregas_por_confirmar`) llamadas decenas de miles de veces, y `stock_por_bodega` con 924 ms de media (RLS + `tiene_modulo`).

## Orden recomendado
1. Arreglar los 2 crons (bug activo).
2. Reducir Realtime: auditar `pg_publication_tables` (quitar tablas sin suscriptor), filtrar suscripciones por columna y evitar `pg_timezone_names` en el cliente.
3. Cachear/unificar las RPC de arranque (`mis_*`) y optimizar `stock_por_bodega`/`mis_entregas_por_confirmar`. Migración de índices: crear los de FKs calientes (`rutas`, `salidas_inventario`, `chofer_posiciones.vehiculo_id`), borrar duplicados y sin uso.
4. Reescribir RLS con `(select auth.uid())` y envolver `is_admin()`/`tiene_modulo()`; consolidar políticas permisivas de `salidas_inventario`/`detalle_salidas`.
5. Purga de `cron.job_run_details` y revisión de retención en `chofer_posiciones` y `auditoria`.
