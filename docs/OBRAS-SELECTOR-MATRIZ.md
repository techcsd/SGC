# Matriz contexto × rol — selectores de obras (BF7)

El selector de obras **no tiene una regla global**. Cada selector declara un **contexto**
y la política decide qué obras se muestran. Esto evita que arreglar un rol (AY4: "el
ingeniero ve sus obras") rompa a otro (BF7: el chofer se quedó sin obras y no podía crear
conduces — "No hay opciones").

## Fuente única
- **`sgc.directorio_proyectos(p_contexto text default 'conduce')`** — RPC `SECURITY DEFINER`,
  desacoplada de la RLS de `proyectos`. Web: `ProyectosService.getDirectorio(contexto)`.
  App (csd-app): `directorio_proyectos()` (sin arg → contexto `conduce`).
- Gemela para contextos scoped en la app: `sgc.proyectos_pickables()` (bitácora/requisición
  de la app) — ya trae la red AW1.

## La matriz

| Contexto | Selectores | Política |
|---|---|---|
| **WIDE** — `conduce`, `ruta`, `despacho`, `personal`, `admin`, `gestion` | Obra destino/origen de conduce (interno **y** externo BA4), destino de ruta, despacho, registro de Personal de obra, selectores de administración | **Todos** ven **todas las obras activas**. Un chofer entrega donde lo manden; almacén/logística despachan a cualquier obra; RRHH registra personal en cualquier obra. |
| **SCOPED** — `requisicion`, `orden_compra`, `bitacora` | Crear requisición, orden de compra, bitácora de obra | El **ingeniero** ve **sus** obras (responsable/empleado). **Admin** y módulos amplios (`proyectos`/`inventario`/`compras`/`direccion`) ven **todas**. |

### Reglas transversales (todos los contextos)
- **Obras cerradas** (`activo = false`, p.ej. Brisas AT20) → **excluidas** siempre.
- **es_prueba** → oculto a no-admin, salvo que el usuario logueado sea de prueba
  (`usuario_actual_es_prueba()`, regla 3-vías BA1).
- **AW1 (vacío ≠ mudo)** → en contexto SCOPED, un usuario **sin ninguna obra ligada** ve
  **todas** (nunca un selector vacío por scoping). Si de verdad no hay obras activas, el UI
  muestra un mensaje ("No hay obras activas registradas"), no un desplegable mudo.

## Roles y su contexto típico
- **Chofer** (`transporte`): contexto `conduce`/`ruta` → **todas las obras activas**. (Era el bug BF7.)
- **Almacén / logística**: `conduce`/`despacho` → todas las activas.
- **Ingeniero de campo**: `requisicion`/`orden_compra`/`bitacora` → **sus** obras.
- **Admin / dirección**: todo → todas.

## Cómo agregar un selector nuevo
1. Elige el contexto por lo que el selector hace (¿entrega a cualquier obra = WIDE?
   ¿pertenece a la obra del ingeniero = SCOPED?).
2. Web: `getDirectorio('<contexto>')`. App: pasar `p_contexto` al RPC.
3. Si un contexto puede dar vacío legítimo, muestra el mensaje (vacío ≠ mudo).

## Pantallas de LISTADO (no dropdowns) — BJ5

Las pantallas que **listan/joinean obras** (no un dropdown de selección) leen la tabla
directo: `ProyectosService.getAll()` → `.from('proyectos')`, gobernado por la **RLS de
`sgc.proyectos`** (política `"proyectos: select"`), no por un contexto. Esa RLS **debe
concordar con `proyectos_pickables()`** (BA1): módulos amplios (proyectos/inventario/
compras/direccion/transporte/flota) + submódulo `proyectos.obras` + `es_responsable` +
`es_capataz` + `proyecto_empleados` + red **AW1** (sin obra ligada → ve todas). La
RESTRICTIVE `"es_prueba: oculta a no-admin"` aplica encima (AND, 3-vías BA1).

- **Historia del bug (5 veces):** AX3→AY4→BA1→BF7 arreglaron **dropdowns**; la RLS de la
  tabla quedó atrás → los listados salían vacíos para ingeniería (`tiene_modulo` NO matchea
  el grant de submódulo `proyectos.obras`, con el que están sembrados los roles de
  ingeniería). Cierre en `sql/2026-09-05-bj5-proyectos-select-rls-alinear.sql`.
- **Al tocar la RLS de proyectos:** re-alinéala con `proyectos_pickables()` — son gemelas.
  Si divergen, algún listado se rompe para algún rol.

| Superficie | Loader | Regla |
|---|---|---|
| **21 pantallas de listado** — bitácora historial/nueva/solicitudes-compra/solicitudes-material · documentos generar · flota combustible · inventario activos/bodegas/entradas/movimientos · legal contratos/expedientes · obra avance/checklists/informes/no-conformidades/plan-dia/subcontratistas · tareas gestión · **proyectos lista** · proyectos historial | `ProyectosService.getAll()` → `.from('proyectos')` | **RLS `"proyectos: select"`** (= pickables). Ingeniero ve las suyas; admin/módulos amplios/submódulo `proyectos.obras`, todas; sin obra ligada, todas (AW1). |
| Órdenes de compra (obra) | `getDirectorio('orden_compra')` (ya migrada por este bug) | contexto SCOPED. Las otras 20 **no** se migran: el fix es la RLS. |

- **`es_prueba` en listados:** lo cubre la RESTRICTIVE. Si `saasasa` (u otra) sigue saliendo
  a un rol real, es que **la obra no está marcada `es_prueba`** (deuda de datos AT26/AT14),
  no un fallo de la política. Marcarla en Proyectos → Gestión.
- **Botón "+ Nuevo proyecto":** deriva de `puedeGestionarProyectos` (espejo de
  `sgc.puede_gestionar_proyectos()`), no del array de roles del perfil.
