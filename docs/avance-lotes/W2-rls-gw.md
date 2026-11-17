# Avance W2 · RLS (DS-46), arranque (DS-45), gateway de traslados y homologación (DS-07) — 16-nov-2026

Todo aplicado SOLO a dev con ledger (`sgc.migraciones_aplicadas`). Nada en prod. Sin commit/push. Sin Odoo real (solo lectura de staging para proponer categorías/unidades).

## 1. DS-46 #71 — RLS con `(select …)` (InitPlan): COMPLETO en dev
- Lotes 2 a 10 (además del 1) con `scripts/gen-rls-initplan-lote.mjs` + `scripts/smoke-ds-rls-initplan.mjs` (7 personas: admin, guarda_almacen, ingeniero_campo, chofer, sin rol, uid inexistente, anon; SELECT visible + UPDATE/DELETE permitidos por celda, cada intento deshecho).
- El generador gana `--listar` (tablas con cambios). Una verificación final del generador sobre las 377 tablas `sgc` da **0 políticas por reescribir** (841 políticas en total).
- Quedan **0** políticas con `auth.uid()` o funciones `sgc.*` estables sin argumentos de fila sin envolver (las llamadas con argumentos de fila no son envolvibles y no cuentan).
- El «184 políticas / 125 tablas» del lote 1 era un conteo solo de `auth.uid()` que además contaba las ya envueltas (el catálogo las muestra como `( SELECT … )`); incluyendo funciones `sgc.*` sin envolver, antes del lote 2 había 601 políticas en 299 tablas por reescribir.

| Lote | Tablas | Políticas | Reescritas | Llamadas envueltas | Smoke antes/después |
|---|---|---|---|---|---|
| 2 | 25 | 94 | 68 | 138 | 175/175 idénticas |
| 3 | 40 | — | — | — | 278/280 idénticas (2 difieren solo por filas nuevas: `auditoria` +24 y el ledger +1 por mi propia migración; mismos permisos y errores 42501/428C9) |
| 4 | 40 | 142 | 125 | 259 | 280/280 |
| 5 | 40 | 69 | 63 | 166 | 280/280 |
| 6 | 40 | 87 | 83 | 207 | 280/280 |
| 7 | 40 | 66 | 60 | 171 | 280/280 |
| 8 | 40 | 65 | 58 | 147 | 280/280 |
| 9 | 40 | 77 | 70 | 136 | 280/280 |
| 10 | 19 | 39 | 38 | 65 | 133/133 |

Celdas negativas (sin rol / uid inexistente / anon) verificadas en cada lote (120 por lote de 40 tablas). Archivos: `sql/2026-11-16-ds46-rls-initplan-lote{2..10}.sql` y reversas en `sql/_reversa/` (lote 1 incluido). Para prod: mismo smoke antes y después de cada lote (regla 18/19).
Limitación: la prueba mide visibilidad y permisos con las filas que hay en dev; en tablas vacías solo prueba que no cambia el error/permiso, no el filtrado por fila.

## 2. DS-45 #69 — arranque
- `sgc.mi_arranque()` (`sql/2026-11-16-ds45b-mi-arranque.sql`, SECURITY INVOKER, `anon` rechazado — probado): preferencias + conteo de firmas pendientes + conteo de entregas por confirmar en una llamada. Probado como admin en dev.
- Qué debe leer la app: `docs/ARRANQUE-APP-DS45.md` (`mi_arranque()` y la tabla `sgc.zonas_horarias` en vez de `pg_timezone_names`, con la consulta exacta).

## 3. Gateway `odoo-api`: acciones `traslados.*`
- `supabase/functions/odoo-api/acciones-traslados.ts` (+ cableado en `handler.ts` e `index.ts`) sobre `_shared/odoo-traslados.ts`.
- Lecturas (`traslados.obtener`, `traslados.listar`): módulo `inventario`, sin caché, solo pickings con origin `SGC-TRAS-…`.
- Escrituras (`traslados.crear/validar/cancelar/devolver`): módulo `inventario`; sin reintento automático (timeout → `odoo_reintentar` 504, el reintento del usuario es idempotente por `origin`); D5: `crear` recibe solo `salida_id`+`paso` y relee salida/líneas/almacenes de la BD y tránsito/tipo de operación de Odoo; las demás reciben `picking_id`, el edge comprueba que sea traslado SGC y deduce salida/paso del origin (un picking ajeno → 400 sin escribir). `crear` rechaza salida de prueba, anulada/rechazada, sin vínculo a Odoo o con almacén sin homologar.
- Política de escritura: `Deps.bloqueoEscrituraTraslados()` — en `index.ts` exige `ODOO_ESCRITURA_HABILITADA` **y** que el host pase `verificarHostEscritura` (guardia DS-02); sin esa dependencia no se escribe. Responde 403 `escritura_bloqueada` antes de tocar Odoo. La guardia del cliente sigue aplicando en cada write.
- Tests: `odoo-api/odoo-api-traslados.test.ts` (14). Suite Deno completa **426/426**. No desplegado (el deploy a dev de `odoo-api` queda para el coordinador).
- Nota: `deno check` de `odoo-api/index.ts` ya fallaba antes por tipos en `acciones-escritura.ts` e `index.ts:40/70` (5 errores previos, ninguno en archivos nuevos); la suite corre con `--no-check` como indica el flujo.

## 4. DS-07 — categorías y unidades en «Homologación con Odoo»
- `sql/2026-11-16-ds07b-homologacion-categorias-unidades.sql`: tabla `sgc.odoo_homologacion_maestros` (RLS lectura admin/compras/tecnología) + RPC `sgc.odoo_maestro_propuesta_decidir(p_id, p_aprobar)` (admin/compras; al aprobar escribe `categorias_inventario.odoo_id` / `unidades.odoo_id` por función definer; rechazar solo marca; rechaza duplicados 23505). Probado en rollback: aprobación vincula, usuario sin rol → 42501.
- `scripts/odoo-homologar-maestros.mjs` (lee staging SOLO lectura; dry-run por defecto): categorías 8 sin vincular → 3 propuestas (1 nombre, 2 similitud); unidades 33 → 14 (5 nombre, 9 sinónimo). **17 propuestas guardadas en dev, 0 vinculadas.**
- UI: dos secciones nuevas en Tecnología › Homologación con Odoo (tablas con Aprobar/Rechazar; muestra ruta/categoría de medida de Odoo), `t()` + claves en `public/i18n/en.json` y `ht.json` (12 por archivo). `OdooHomologacionService.propuestasMaestros/decidirMaestro`.
- No se aplica `unidades.odoo_factor` al aprobar (el factor de Odoo queda en `datos` como información; usarlo es decisión de producto).

## Verificación final
- `deno test --no-check --allow-env --node-modules-dir=none supabase/functions`: 426 pasan.
- `npm test`: 367 pasan (1 omitido). `npm run build`: OK (v1.218.0).

## Pendiente / decisiones
- Prod: ningún lote RLS, `mi_arranque` ni ds07b se aplicó; requieren el flujo dev→prod con smoke antes/después.
- Las 5 categorías y 19 unidades sin contraparte propuesta se resuelven a mano (o creando el maestro en Odoo).
- Notas de versión (Y1) y `graphify update .` los hace el coordinador; no hay terceros nuevos para `docs/DATOS-Y-TERCEROS.md` (solo lectura de staging, ya documentado).
