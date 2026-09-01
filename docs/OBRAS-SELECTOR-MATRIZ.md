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
