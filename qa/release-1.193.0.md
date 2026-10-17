# Release 1.193.0

- Equipo/tester: Claude Code (sesión autónoma, 4 agentes en paralelo sobre `feature/cq-ronda`) — SIN Xaviel todavía.
- Qué se probó (por SQL directo contra dev + build/tests — **sin navegador real esta ronda**, ningún agente tuvo sesión gráfica/Playwright disponible):
  1. **CQ3 error + CQ5 barrido** — reproducido el error real en PROD (`structure of query does not match function result type`, columna 4, `character varying(150)` vs `text`) antes de arreglar; verificado que el fix en dev ejecuta limpio como admin real (impersonación vía `set_config`+rollback). Barrido de las 32 funciones `plpgsql returns table` de `sgc`/`public`: `audit_log_listado` fue la ÚNICA con el defecto real (las 15 candidatas `LANGUAGE sql` que una heurística ingenua marcaba primero NO están rotas — Postgres sí les aplica coerción automática varchar→text).
  2. **CQ4 importar vehículos/choferes** — smoke SQL en dev: vehículo nuevo con 20+ campos nuevos (incl. número con coma "12.345") persiste bien; reimportar con celdas vacías NO borra; `cambios` jsonb solo refleja lo que de verdad cambió. Igual para choferes (`vehiculo_id` resuelto por placa, `tags` parseado, `activo`). 2 bugs reales encontrados y arreglados en el propio smoke (cast numérico con separador de miles; falso positivo de "cambió" en columnas NULL-antes-y-después).
  3. **CQ1 compras tecnológicas** — edge `leer-cotizacion` desplegada y confirmada viva en dev (v2). Migración aplicada y columnas nuevas confirmadas en `solicitudes_compra`/`solicitud_compra_adjuntos`.
  4. **CQ3 auditoría nueva** — smoke en dev: frases en lenguaje normal no vacías en varias tablas; tabla sin catálogo cae a genérico sin reventar; historia de un registro real (847 eventos) sale en orden cronológico correcto; búsqueda por código "REQ-000091" encuentra la fila real (bug real encontrado y arreglado en el propio smoke: no despojaba el prefijo antes de comparar). `EXPLAIN ANALYZE`: 8-16ms por consulta con ~41k filas, bien debajo de 1s.
  5. **CQ2 dev notes** — 19 tests de ida y vuelta Markdown↔TipTap + 7 de conversión a texto plano, todos verdes. Bug real de `tiptap-markdown` encontrado (listas mixtas viñeta+checkbox corrompían el parseo) y arreglado con test de regresión.
  6. **cp8c (foto de pizarra en reuniones)** — migración aplicada a dev; agregada una vista mínima en la web (subir/ver foto en "Tu nota" de una reunión) para que la app no sea la única superficie de ese dato (regla AT11).
  - Build completo (`npm run build`, con los 20 guards de `prebuild`) verde. `npm run test:unit`: 12 archivos, 71/71 tests verdes.
- Versión de origen: 1.192.3
- Resultado: **PENDIENTE — falta que Xaviel pruebe de verdad en `dev.sgcconstructorasd.com`** (ningún agente tuvo navegador disponible esta ronda; toda la verificación fue por SQL directo + build/tests). No se pide OK para prod todavía con este documento — es el registro de lo que SÍ se probó antes de pedirlo.
- Fecha: 2026-10-17

**OK de Xaviel**: (pendiente — sin esto, `release-check.mjs` fallará su primer check por diseño, correctamente, hasta que Xaviel pruebe o deje pasar 24h).
