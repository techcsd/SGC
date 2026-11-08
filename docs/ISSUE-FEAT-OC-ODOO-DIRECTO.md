# feat: Órdenes de compra con productos desde Odoo (piloto) — crear, confirmar y cancelar en Odoo + alta de producto faltante

> Etiquetas sugeridas: `feat`, `odoo`, `compras`, `P1`. Épica: #2. Variante "acceso directo" de #8.

## Historia de usuario

**Como** encargado de compras, **quiero** armar la OC eligiendo productos que salen de Odoo y que la OC se cree, confirme y cancele en Odoo, **para** tener una sola OC real por compra sin catálogo duplicado; y **si el producto que necesito no existe en Odoo**, **quiero** pedir su alta desde la propia OC sin escribirlo a mano ni crear basura en el ERP.

## Contexto

- El PoC "Stock en Odoo" (PR #22, rama `claude/odoo-poc-stock-2f2362`) ya entrega el gateway `odoo-api` **solo lectura** con allowlist cerrada (`productos.buscar`, `ubicaciones.listar`, `stock.consultar`). Este issue es el **primer feature en uso** que se migra encima de ese gateway.
- Hoy la OC se crea con `crear_orden_compra` (`sql/2026-07-28-z6b-crear-orden-compra-rpc.sql`), invocada desde `ordenes-compra.service.ts:53` y, dentro del servidor, desde `aprobar_solicitud_compra` (`solicitudes-compra.service.ts:82`). El cambio de estado va por `actualizar_estado_orden` (`ordenes-compra.service.ts:78`). Son 3 puntos de entrada.
- **Hecho clave del código:** las líneas de OC admiten `articulo_id = null` ("Otro (texto libre)", `ordenes.ts:47-58`). La reconciliación de recepción sólo funciona por `articulo_id` (`ordenes.ts:198-220`, estado `sin_articulo`). Es el origen del edge case de este issue.
- Este issue **contrasta con #8** (modelo outbox con SGC como autoridad). Aquí el piloto usa el camino directo de `docs/EVALUACION-ACCESO-DIRECTO-ODOO-2026-10-16.md`: llamada síncrona vía gateway, sin cola obligatoria, con registro de cada comando para idempotencia. Hay que decidir si #8 se cierra o se reduce a lo que este issue no cubra (ver preguntas abiertas).

## Alcance (piloto)

1. Selector de producto de la OC alimentado por **Odoo** (`product.product`) para el alcance piloto.
2. Crear la OC en Odoo (`purchase.order` borrador + líneas) al guardarla; confirmar (`button_confirm`) y cancelar (`button_cancel`) desde SGC.
3. Edge case: **producto inexistente en Odoo** → flujo "Solicitar alta de producto" con bandeja de resolución.
4. Estado de publicación visible en la OC, reintento seguro y conciliación.

### Fuera de alcance
- Recepciones, stock, despachos, conteos: **siguen en SGC**. El botón "Marcar recibida" **no valida** nada en Odoo.
- Facturas y pagos. Crear la OC no crea factura.
- Crear productos en Odoo automáticamente desde SGC (queda como fase 2 detrás de la bandeja; ver Fase D).
- Alta de proveedores en Odoo (proveedor sin vínculo se **bloquea**; su alta va por #19).
- Quitar o migrar OC históricas. Las existentes no se tocan.

## Decisiones de diseño

**D1 — Origen del producto.** En el alcance piloto el selector consulta Odoo (acción `productos.buscar` ampliada), no `sgc.articulos`. Cada línea guarda `odoo_product_id` (bigint, viaja como cadena decimal en JS) más una *instantánea* (nombre, código, unidad Odoo) para mostrar la OC aunque Odoo no responda después.

**D2 — Puente con recepción legacy.** Como Entradas reconcilia por `articulo_id`, una línea Odoo necesita un `articulos` SGC enlazado. Regla: si ya existe un artículo con ese `odoo_product_id` (por #19) se usa; si no, el servidor crea un **artículo-sombra mínimo** (`origen = 'odoo'`, `odoo_product_id`, nombre/código/unidad copiados, sin stock ni alias) para no romper la recepción. Nunca se vincula por coincidencia de nombre. La unidad Odoo se copia como texto (`articulos.unidad` admite texto); si su categoría de UoM no coincide con una unidad SGC conocida, la línea queda marcada "unidad sin homologar" y bloquea la **confirmación**, no el borrador.

**D3 — Idempotencia de escritura.** Cada comando (crear, confirmar, cancelar) se registra con clave estable `instancia + OC uuid + acción + revisión` (reutilizando `odoo_eventos`/`odoo_intentos` de la ampliación `20261016112525`, ejecución síncrona, sin worker). La OC Odoo lleva `origin = 'SGC:<numero>:<uuid>'`. Ante timeout el estado es **incierto**: primero se busca por `origin` en Odoo y se reconcilia; **nunca** se reintenta a ciegas ni se reintenta una escritura automáticamente (consistente con #23).

**D4 — Orden de operaciones.** Crear: OC local (borrador, `odoo_sync_estado='pendiente'`) → edge `compras.crear` → registro de IDs. Confirmar/cancelar: **Odoo primero, SGC después**; si Odoo rechaza, el estado SGC no cambia. Si Odoo confirma y falla la escritura SGC, queda `incierto` y la conciliación lo repara leyendo `compras.obtener`.

**D5 — El edge nunca confía en el cliente.** `compras.crear` recibe sólo el `orden_id`; el edge relee cabecera y líneas de la BD con service role, valida y arma el payload. El navegador no envía modelo, método, dominio ni compañía.

**D6 — Feature flag en servidor.** Alcance piloto por proyecto/destino (tabla de política, no en el cliente). Fuera del alcance todo sigue por el camino legacy sin ningún cambio visible. Rollback = apagar la política; las OC ya publicadas conservan su vínculo.

**D7 — No cambiar firmas de RPC.** `crear_orden_compra` conserva su firma (acabamos de limpiar overloads ambiguos en el hotfix `aabf9f`). Las columnas Odoo se escriben después, con service role, mediante un RPC nuevo restringido.

## EDGE CASE: producto que no existe en Odoo

Principio: **una línea que va a Odoo siempre apunta a un `product.product` real**. No se usa un producto genérico "varios", no se mandan líneas de texto libre y no se crean productos a escondidas.

| # | Situación | Comportamiento esperado |
|---|---|---|
| E1 | El usuario busca y no hay resultados | Mensaje "No encontramos este producto en Odoo" + sugerencias (revisar ortografía/código) + botón **Solicitar alta de producto**. Antes de abrir la solicitud se muestra una nueva búsqueda por nombre y código; hay que confirmar "revisé y no existe" (anti-duplicado). |
| E2 | Existe pero está **archivado**, no es comprable (`purchase_ok=false`) o es de otra compañía | La búsqueda de compras filtra `active`, `purchase_ok` y compañía. Para compras **no** se limita a `type='product'` (el PoC sí, por ser de stock): los consumibles de obra no deben quedar invisibles. Si el rol puede, se avisa "existe pero no está habilitado para compras" en lugar de "no existe"; el detalle técnico sólo lo ve `es_desarrollador()` (BS2). |
| E3 | Línea de texto libre existente / OC que nace de una solicitud de compra con ítem sin producto Odoo | Se guarda la OC como **borrador local** con `odoo_sync_estado='pendiente_producto'`. No se publica ni se confirma hasta resolver todas las líneas. Se muestra qué líneas faltan. |
| E4 | Faltante de requisición (BH7, `ordenes.ts:371-377`) con `articulo_id` SGC que **no** tiene `odoo_product_id` | Se proponen candidatos de Odoo por código/nombre como *sugerencia*; un humano confirma el vínculo. Si no hay candidato, pasa al flujo de solicitud de alta con el artículo SGC precargado. |
| E5 | Solicitud de alta enviada | Se crea un registro en `odoo_producto_solicitudes` (estado `pendiente`) con nombre, código sugerido, unidad, categoría, justificación y OC/línea de origen. Notifica a los resolutores y suma al KPI/badge del dashboard. El solicitante ve el estado en su OC. |
| E6 | Resolución | El resolutor crea el producto en Odoo (fase inicial manual) y registra su ID, o marca `duplicado` (apuntando al producto existente) o `rechazado` (con motivo). Al resolverse, la línea de la OC se **re-vincula sola** y se notifica al solicitante. |
| E7 | El producto fue creado en Odoo entre el borrador y la publicación | Al publicar se **revalida** cada producto (`productos.obtener` por IDs): activo, comprable, misma categoría de UoM. Si cambió o desapareció, la OC pasa a `conflicto` y se indica qué línea. |
| E8 | Odoo no responde al buscar | No hay selector utilizable: mensaje traducido por rol, sin datos viejos disfrazados de frescos. Se puede abrir una OC borrador sólo con líneas ya vinculadas (instantánea). Sin fallback a `sgc.articulos`. |
| E9 | Proveedor sin `odoo_id` | Bloquea la publicación con mensaje claro; el alta se resuelve por #19. Mismo patrón de estado `pendiente_vinculo`. |
| E10 | OC de práctica / `es_prueba` | **Nunca** se publica a Odoo; el edge lo rechaza aunque el cliente lo pida. |

Reglas del flujo de alta: no se crea producto en Odoo desde el navegador; no se infiere equivalencia por nombre; el solicitante no puede aprobar su propia solicitud; todo dato enviado se puede ver (AT11).

## Cambios por capa

### Base de datos (migración nueva en `sql/`, dev primero; sin editar migraciones históricas)
- `ordenes_compra`: `odoo_sync_estado` (`no_aplica|pendiente|pendiente_producto|pendiente_vinculo|publicada|error|incierto|conflicto`, check), `odoo_state` (estado visto en Odoo), `odoo_nombre` (número de la OC en Odoo), `odoo_total`, `odoo_sync_error` (sanitizado). Nullable/con default `no_aplica` → filas viejas intactas.
- `orden_compra_items`: `odoo_product_id bigint`, `odoo_uom_id bigint`, `odoo_snapshot jsonb`.
- `articulos`: columna `origen` (default `'sgc'`) para distinguir artículos-sombra. Requiere confirmar que no rompe el wizard ni el importador.
- Tabla `odoo_producto_solicitudes` con RLS por rol/módulo, grants de esquema **y de secuencias** (regla 3), `es_prueba`, auditoría.
- RPC `registrar_publicacion_oc(...)` y `resolver_solicitud_producto(...)`: `SECURITY DEFINER`, sólo `service_role`/rol resolutor; los campos `odoo_*` ya están protegidos por los triggers de la fase 1.
- Prerrequisito: aplicar en dev la fase 1 (`20261016112524`, #3/#20) y, para D3, la ampliación (`20261016112525`).
- Verificar RPC/RLS/grants con `audit-rpc-grants.mjs` y `audit-notnull-sin-default.mjs`.

### Edge `odoo-api` (extiende el PoC #22)
- Lecturas: `productos.buscar` (variante compras), `productos.obtener`, `proveedores.obtener`, `compras.obtener`.
- Escrituras (allowlist): `compras.crear`, `compras.confirmar`, `compras.cancelar`. **Sin reintentos automáticos de escrituras**; timeout → `incierto` + reconciliación.
- Autorización en servidor: módulo `compras` + alcance de proyecto; rate limit por usuario (ya existe `odoo-limite.ts`); CORS por lista de orígenes (#21).
- Mapeo de líneas: producto, cantidad, `price_unit` (el precio capturado en SGC manda), unidad, impuestos del producto salvo `aplica_impuesto=false`, `date_planned` desde `fecha_entrega_esperada`, destino/almacén según `destino`.
- Tras crear: leer de vuelta `amount_total` y comparar con el total SGC; diferencia > tolerancia ⇒ `conflicto` visible (Odoo manda, SGC lee).

### Angular
- `src/shared/services/odoo-api.service.ts`: nuevas acciones tipadas; IDs como cadena decimal.
- `ordenes-compra.service.ts`: `create/updateEstado` ramifican según el flag; `getById` expone estado de sincronización.
- `solicitudes-compra.service.ts`: tras `aprobar_solicitud_compra`, dispara la publicación de la OC devuelta. Si falla o se cierra la pestaña, queda `pendiente` visible con botón **Publicar en Odoo** y acción masiva para el rol compras.
- `compras/ordenes/ordenes.ts`: typeahead de producto Odoo (debounce, mínimo 2 caracteres, cancelación de carreras como en el PoC), chip "Odoo", CTA **Solicitar alta**, badge de estado, reemplazo de "Otro (texto libre)" en el alcance piloto.
- Pantalla nueva: **Productos por dar de alta en Odoo** (solicitante y resolutor) con guard de módulo en las rutas, entrada en `shell.ts`, `t()` + claves en `public/i18n/en.json`, íconos SVG (AW12).
- Interconexión (regla 1): badge/KPI de "OC pendientes de publicar" y "solicitudes de producto pendientes" en el dashboard y notificaciones; la solicitud aparece donde trabaja el resolutor.
- Errores con `presentarError` (BS2); detalle técnico sólo para `es_desarrollador()`.
- Modo práctica: `PracticaClienteService` intercepta las acciones de escritura y registra la acción simulada; nunca llama a Odoo real.

### Documentación y versionado
- Actualizar `docs/DATOS-Y-TERCEROS.md` (nuevos datos hacia Odoo) y avisar que política de privacidad y formularios de tienda requieren revisión (CI13).
- Bump de versión + `release-notes.json` estructurado (Y1).
- Guía de QA en `qa/` y runbook de conciliación/rollback.

## Plan por fases (un PR por fase, `feature/*` → `dev`)

- **Fase A — Base y lectura de compras.** Migración de columnas y tabla de solicitudes; `productos.buscar` (compras), `productos.obtener`; selector Odoo detrás del flag; sin escrituras a Odoo. Valida E1, E2, E8.
- **Fase B — Alta de producto faltante.** Solicitud, bandeja, notificaciones, resolución manual, re-vínculo automático. Valida E3–E6, E9.
- **Fase C — Escritura de OC.** `compras.crear/confirmar/cancelar`, registro de comandos, idempotencia, conciliación, estados visibles, `solicitud → OC`. Valida E7, E10 y la matriz de fallos.
- **Fase D (opcional, después del piloto).** Acción `productos.crear` con aprobación humana previa, para que el resolutor no salga de SGC.

## Criterios de aceptación

- [ ] Con el flag apagado, el flujo de OC es idéntico al actual (sin diferencia visible ni de datos).
- [ ] Con el flag encendido, el selector sólo ofrece productos de Odoo y cada línea guarda `odoo_product_id`.
- [ ] Una OC directa crea **una** `purchase.order` borrador con sus líneas y guarda IDs de cabecera y líneas; reintentar no crea otra.
- [ ] Aprobar una solicitud de compra produce una sola OC Odoo; aprobar la solicitud **no** confirma la OC.
- [ ] Confirmar/cancelar actúa primero en Odoo; si Odoo rechaza, el estado SGC no cambia y se informa el conflicto.
- [ ] Una línea sin producto Odoo no se puede publicar ni confirmar y la OC indica cuáles faltan.
- [ ] "Solicitar alta" exige haber buscado antes (anti-duplicado), notifica a los resolutores y aparece en dashboard/badge.
- [ ] Al resolverse una solicitud, la línea se re-vincula y el solicitante recibe aviso; `duplicado` apunta al producto existente.
- [ ] Un producto archivado o no comprable se distingue de uno inexistente cuando el rol puede verlo.
- [ ] Un producto que cambia entre borrador y publicación se detecta (E7) y la OC pasa a `conflicto`.
- [ ] Timeout tras éxito en Odoo no duplica la OC: el estado queda `incierto`, la conciliación encuentra la OC por `origin` y la vincula.
- [ ] Diferencia de total SGC↔Odoo se muestra como conflicto; Odoo manda.
- [ ] "Marcar recibida" no valida ninguna recepción en Odoo; la recepción por Entradas sigue funcionando con líneas Odoo gracias al artículo-sombra.
- [ ] Una OC `es_prueba` no llega a Odoo aunque se fuerce desde el cliente.
- [ ] Permisos: sólo el módulo `compras` publica; el resolutor de solicitudes tiene permiso explícito; un usuario no puede resolver su propia solicitud.
- [ ] Todo dato enviado a Odoo es visible en el detalle de la OC (AT11).
- [ ] Ningún error técnico llega crudo a un usuario no desarrollador (BS2).

## Plan de pruebas

- **Deno** (edge): `normalizar` de cada acción, idempotencia (misma clave = mismo resultado, payload distinto = rechazo), timeout seguido de reconciliación, escrituras sin reintento, rechazo de `es_prueba`, autorización por módulo/alcance.
- **Vitest** (Angular): ramificación por flag, estados de la OC, re-vínculo tras resolver, carreras del typeahead.
- **QA en dev** (`dev.sgcconstructorasd.com` + base Odoo de pruebas): E1–E10; OC directa y desde solicitud; recepción parcial en Entradas sobre una OC publicada; cancelar antes y después de que exista recepción; Odoo caído; dos publicaciones concurrentes de la misma OC; pestaña cerrada entre crear y publicar.
- Conciliar contra Odoo: número, líneas, cantidades, unidades, impuestos y total; no basta con contar respuestas HTTP 200.
- `npm run build`, `npm test`, `audit-rpc-grants`, `audit-notnull-sin-default`, guards `verify-i18n`, `verify-dev-strings`.

## Riesgos

- **Dos dueños del estado.** SGC marca "recibida" mientras Odoo sigue "confirmada". Se muestra como estado SGC, no como estado Odoo.
- **Doble stock.** Confirmar la OC en Odoo genera una recepción pendiente. Si alguien la **valida en Odoo** mientras SGC también recibe, se duplica la existencia. Mitigación: `compras.obtener` trae el estado de las recepciones; si alguna pasa a `done` se marca `conflicto`; además se acuerda con el equipo que la recepción sigue en SGC durante el piloto. **Por verificar en la instancia** que una recepción pendiente no afecte `stock.quant`.
- **Catálogo en tres lugares** (Odoo, artículo-sombra, instantánea). Es transitorio y se justifica por no romper Entradas; debe retirarse al migrar recepciones.
- **Impuestos, moneda y redondeo** pueden diferir; Odoo manda.
- **Versión de Odoo.** La evaluación indica Odoo 17 (XML-RPC) y el mapa cita docs de 19. Los campos de tipo/almacenable cambian entre versiones; confirmar antes de fijar filtros.
- **Solicitudes de alta que se acumulan** si no hay resolutor con tiempo; definir responsable y métrica.
- **Fallo de Odoo sin fallback** (decisión vigente del diseño directo): el alcance piloto se limita a propósito.

## Dependencias

- PR #22 (gateway `odoo-api` PoC) mergeado a `dev`; #21 (CORS/env/CI de edges) y #23 (resiliencia) recomendados; #23 no debe reintentar escrituras.
- #3 / #20 (fase 1 de IDs Odoo) aplicada en dev; ampliación `20261016112525` para D3.
- #18 / #19 para el alcance piloto: proveedores y artículos ya usados con `odoo_id` / `odoo_product_id`.
- Relación con #8: este issue lo sustituye para el piloto o lo acota; decidir.

## Preguntas abiertas (necesitan decisión antes de la Fase A)

1. **Alcance del piloto:** ¿qué proyecto, destino o compañía entra primero?
2. **Base Odoo de pruebas:** ¿cuál y con qué usuario técnico? (no pegar credenciales en el issue).
3. **Resolutor de solicitudes de producto:** ¿Compras, Tecnología o un rol nuevo? ¿Con qué permiso?
4. **Artículo-sombra:** ¿se acepta como puente transitorio, o prefieren bloquear la recepción de líneas sin artículo SGC?
5. **Texto libre:** ¿se prohíbe totalmente en el piloto o se permite OC "solo SGC" para servicios sin producto?
6. **Si Odoo está caído:** ¿se bloquea la creación de OC o se permite borrador local con productos ya vinculados?
7. **#8:** ¿se cierra a favor de este issue o queda para la ruta outbox?
8. **Versión de Odoo** y filtro de tipo de producto para compras (consumible vs almacenable).

## Definición de terminado

- [ ] Implementación y pruebas con evidencia del resultado y de errores/reintentos.
- [ ] Cambios en `feature/*`; toda migración/edge/secret aplicada primero con `--env dev`, contrastada con el ledger de dev y validada en `dev.sgcconstructorasd.com` según `docs/ENTORNOS.md`. Nada a prod sin pasar por dev (BU1).
- [ ] UUID/FK, historial y evidencia SGC conservados; permisos de lectura y escritura comprobados.
- [ ] `docs/DATOS-Y-TERCEROS.md`, versión y `release-notes.json` actualizados.
- [ ] Publicar este issue no autoriza desplegar en producción ni eliminar tablas.
