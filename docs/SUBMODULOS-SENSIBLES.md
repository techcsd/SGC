# Submódulos sensibles — matriz de gate real (CZ4, 26-oct-2026)

> Documento vivo (DZ-21). Para cada submódulo marcado como sensible en el ronda CZ,
> esta tabla dice el gate REAL en 3 capas (ruta Angular, menú lateral, RLS/RPC del
> servidor) — no lo que debería ser, lo que **es** hoy, verificado archivo:línea.
> Xaviel ajusta quién ve qué desde **Administración › Roles** (permisos granulares,
> AG12) o reasignando módulos; este documento solo dice dónde está el candado.

## Cómo leer esta tabla

- **Ruta**: el guard de Angular (`canActivate`) en la ruta o en su contenedor padre.
- **Menú**: la condición que usa `shell.ts` para mostrar/ocultar el ítem (debe
  coincidir con la ruta — si no coincide, alguien ve un ítem que le da 403, o
  navega a mano a algo que el menú le escondía).
- **RLS/RPC**: la autoridad real en el servidor (lo único que de verdad protege el
  dato — las dos capas de arriba son conveniencia/UX, regla 16 del checklist).
- **✅ coincide** / **⚠️ hallazgo** (gating más débil que su sensibilidad, o
  inconsistente entre capas) / **🔧 corregido en CZ4** (ya arreglado en esta ronda).

## 1. Todo `/admin/*`

| Capa | Gate real |
|---|---|
| Ruta (padre `/admin`) | `moduleGuard('admin')` — `app.routes.ts:159-161` |
| Ruta (hijas: usuarios, roles, auditoria, parametros, compa-conversaciones, claude, usuarios-test, importar, …) | **Ninguna** — `admin.routes.ts` no pone `canActivate` en NINGUNA hija; heredan 100% del padre |
| Menú | `modulo: 'admin'` en el item "Administración" de `shell.ts` |
| RLS/RPC | Varía por pantalla (ver abajo) |

**⚠️ Hallazgo (arquitectura, no específico de CZ):** las ~17 hijas de `/admin` —
incluidas Usuarios, Roles, Auditoría, Parámetros, **Compa conversaciones** y el
**conector de Claude** — dependen ENTERAMENTE de que el usuario tenga el módulo
`admin`. Hoy eso es seguro porque **solo el rol `admin` tiene ese módulo**
(`ROLES.md` §3) — ninguna otra fila de `sgc.roles` lo incluye. Pero si algún día
alguien le agrega el módulo `admin` a otro rol (por error o por necesidad puntual),
esa persona vería TODO `/admin/*` de un golpe, sin que cada pantalla re-valide su
propio gate. Por eso el Vault **no puede colgar de este módulo** (DZ-08) — usa un
guard de **rol** estricto en su lugar (sección 2). No se corrige en CZ4 (fuera de
alcance: tocar 17 pantallas sin necesidad real hoy); queda documentado para una
futura ronda de higiene si se decide exigir rol estricto en todo `/admin/*`.

**Verificado para el Subadministrador:** NO tiene el módulo `admin` (DZ-20) → el
guard del padre lo bloquea antes de llegar a ninguna hija. ✅.

### 1.1 Auditoría (`/admin/auditoria`)
RPC `sgc.puede_ver_auditoria()` = `is_admin() OR tiene_modulo('auditoria') OR
es_tecnologia()` (`sql/2026-09-30-cd2-auditoria-filtros.sql:26`). El módulo
`'auditoria'` no existe en `MODULOS_DISPONIBLES` (no es asignable desde la UI) —
rama muerta/defensiva. En la práctica: `is_admin() OR es_tecnologia()`. **⚠️
Hallazgo:** esto es MÁS ESTRICTO que el gate de ruta (que solo exige el módulo
`admin`) — hoy coincide 1:1 porque solo `admin` tiene ese módulo, pero es la misma
familia de riesgo que 1. arriba.

### 1.2 Conector de Claude / Compa conversaciones
Sin gate propio de ruta ni de RPC más allá de `is_admin()` dentro de sus RPCs
(no verificado línea por línea en esta pasada — fuera del foco de CZ, que es el
Subadministrador y el Vault). Igual de protegido que el resto de `/admin/*` por
la razón de 1.

## 2. Vault (CZ3/F4 — próxima fase de esta misma ronda)
**No existe todavía** (se construye en F4 de este mismo prompt). Su diseño ya
decidido (DZ-08) es precisamente la corrección al patrón de la sección 1: un guard
de **rol** estricto (`hasRole('admin')`, no `moduleGuard`), oculto del menú a quien
no sea admin, y `sgc.puede_ver_vault()` = `is_admin()` como única fuente en RLS/RPC/edge.

## 3. Tecnología de plataforma (`tecnologiaGuard` — `es_tecnologia()`)

APIs y consumo, Odoo-sync (distinto de "Stock en Odoo" de Inventario, ver 3.1),
monitoreo de infraestructura, envíos automáticos, outbox atascado, consultas de
Compa, QA, Issues, Dev notes, Sistema de diseño, Estadísticas, Reportes de errores,
Versiones de la app — todas en `tecnologia.routes.ts` con
`canActivate: [tecnologiaGuard]` (o `moduleGuard('tecnologia')` para
APIs-y-consumo/Homologación/Matriz).

| Capa | Gate real |
|---|---|
| Ruta | `tecnologiaGuard` → `userService.esTecnologia()` |
| Menú | `soloTecnologia: true` → `userService.esTecnologia()` (mismo predicado) |
| RLS/RPC | `sgc.es_tecnologia()` = rol `admin,tecnologia,gerencia,direccion,desarrollador` (lista de roles, `sql/2026-09-23-bx1b-es-tecnologia-incluye-desarrollador.sql`) |

**⚠️ Hallazgo (preexistente, no introducido por CZ):** `UserService.esTecnologia()`
(`user.service.ts:102-111`) es **más permisivo** que la función SQL: además de los
5 roles, hace `|| this.hasModulo('tecnologia')`. La función SQL **no** tiene ese OR
(solo mira roles). Hoy el único rol con el módulo `tecnologia` que NO está en la
lista SQL es **`encargado_tecnologia`** (`ROLES.md` fila 17) — esa persona, en el
cliente, ve/puede navegar a `/tecnologia/monitoreo`, `/tecnologia/odoo-sync`, etc.
(el guard de ruta lo deja pasar), pero el servidor (`es_tecnologia()` real) se lo
niega → paneles vacíos/errores de permiso, **no una fuga de datos** (la RLS real
sigue protegiendo), pero sí una UX rota y una inconsistencia cliente/servidor que
viola la regla 14 ("un gate vive en UN predicado, todos lo llaman"). **No se
corrige en CZ4** (fuera de las notas de Xaviel de esta ronda; tocar
`esTecnologia()` afecta otras ~15 pantallas fuera de este alcance) — reportado
para que una futura ronda decida si `encargado_tecnologia` debe entrar a
`es_tecnologia()` en el servidor, o si el cliente debe dejar de mirar el módulo.

**Verificado para el Subadministrador:** DZ-20 decide explícitamente NO darle el
módulo `tecnologia` — así que ni el hueco de arriba lo afecta. `esTecnologia()`
= false para él (ni rol ni módulo) → bloqueado en las 3 capas. ✅.

### 3.1 Tecnología de CONTENIDO — Inventario TI, Compras tecnológicas, Cotizaciones, Guía
**🔧 Corregido/construido en CZ4.** Antes de esta ronda, "Inventario tecnológico" y
"Compras tecnológicas" solo aceptaban `moduleGuard('tecnologia')` (ruta) /
`modulo: 'tecnologia'` (menú) / `is_admin() OR tiene_modulo('tecnologia')`
(RLS/RPC) — sin forma de dar acceso sin el módulo completo. Ahora:

| Pantalla | Ruta | Menú | RLS/RPC |
|---|---|---|---|
| Inventario tecnológico | `submoduloGuard('tecnologia.inventario')` | `submodulo: 'tecnologia.inventario'` | `tec_equipos_all`/`tec_hist_all`: `is_admin() OR tiene_modulo('tecnologia') OR puede_ver/operar_submodulo('tecnologia.inventario')` |
| Compras tecnológicas (+nueva/editar) | `submoduloGuard('tecnologia.compras')` | `submodulo: 'tecnologia.compras'` | `crear_solicitud_compra_tec`: + `puede_operar_submodulo('tecnologia.compras')` (el resto de sus RPC ya gatean por dueño/aprobador/admin, sin módulo) |
| Cotizaciones (CZ1) | `submoduloGuard('tecnologia.cotizaciones')` | `submodulo: 'tecnologia.cotizaciones'` | `tec_cotizaciones`/RPCs: `puede_ver/operar_submodulo('tecnologia.cotizaciones')` |
| Guía de herramientas | Sin gate (pública, `tecnologia.routes.ts:8-13`) | **🔧 corregido**: antes tenía `modulo: 'tecnologia'` en el menú (ocultaba un ítem que la ruta ya dejaba navegar a cualquiera) — se quitó, el menú ahora coincide con la ruta | `tec_herramientas`: `for select using (true)` |

**🔧 Hallazgo + fix en la MISMA fase (DZ-21):** el contenedor `/tecnologia`
(`app.routes.ts`) exigía `hasModulo('tecnologia') || esTecnologia()`
(`tecnologiaContenedorGuard`) — **sin** la opción de un permiso granular suelto.
Eso significaba que, aunque las 3 pantallas de arriba ya aceptaran el permiso
granular, el Subadministrador nunca llegaba a ellas: el contenedor padre lo
bloqueaba primero con 403. Corregido: el contenedor ahora usa
`moduloOSubmoduloGuard('tecnologia', u => u.esTecnologia())` (mismo patrón que
Inventario/Flota/Proyectos), que además acepta cualquier permiso granular
`tecnologia.*` registrado en `SUBMODULOS['tecnologia']` (`roles.service.ts`).
`tecnologiaContenedorGuard` (ya sin llamadores) se eliminó.

Homologación y Matriz puesto × herramienta **se quedan solo con el módulo
completo** (decisión de alcance DZ-20 — no están en la lista de "contenido" que
Xaviel aprobó para el Subadministrador).

### 3.2 "Stock en Odoo" (Inventario) — NO se trata como sensible
`/inventario/stock-odoo` usa `moduleGuard('inventario')` (gate normal de
Inventario, no de Tecnología) — es una vista de solo lectura de existencias,
parte del módulo operativo de Inventario que el Subadministrador ya tiene por
diseño (DZ-20). Se distingue a propósito de "Homologación con Odoo" y
"Sincronización con Odoo" (sección 3), que SÍ son herramientas técnicas y se
quedan fuera de su alcance.

## 4. Legal, RRHH, Dirección
`moduleGuard('legal')` / `moduleGuard('rrhh')` / `moduleGuard('direccion')` en sus
respectivos padres (`app.routes.ts:187-203`), sin hijas con guard propio adicional
(heredan del padre, igual que Admin). **Verificado:** ninguno de los 3 módulos está
en la lista de partida del Subadministrador (DZ-20) → bloqueado. ✅.

## 2.1 Clave del equipo (DA4/DA6 — ronda DA, 27-oct-2026)
Tabla nueva `sgc.tec_equipo_claves` (clave de acceso de un equipo del inventario
TI — ej. laptop en stock con PIN compartido). Mismo patrón de fondo que el
Vault (AES-256-GCM, `BOVEDA_MASTER_KEY`), pero **fuera** de él: gate y tabla
propios.

| Capa | Gate real |
|---|---|
| UI (botón "Mostrar"/bloque "Clave del equipo") | `userService.puedeVerClavesEquipos()` (`user.service.ts`) |
| RLS | `tec_equipo_claves` **sin ninguna política para `authenticated`** (`revoke all ... from authenticated`) — ni metadata |
| Edge `equipos-clave` | `sgc.puede_ver_claves_equipos()` = `is_admin() OR` permiso granular directo `tecnologia.claves_equipos` |

**A propósito NO usa el helper AG12** (`puede_ver_submodulo`/`puede_operar_submodulo`,
ni su espejo cliente `nivelSubmodulo`/`puedeVerSubmodulo`): ese helper da
`'operar'` a cualquiera con el **módulo padre completo** (`tiene_modulo('tecnologia')`
en el servidor, `hasModulo('tecnologia')` en el cliente) como regla de
compatibilidad — si `tecnologia.claves_equipos` usara ese camino, **cualquier
rol con el módulo Tecnología completo vería las claves sin que nadie se lo
diera a propósito**, exactamente lo que Xaviel pidió evitar. El predicado
(`sgc.puede_ver_claves_equipos()` / `UserService.puedeVerClavesEquipos()`) mira
el permiso granular **directo**, sin el atajo de módulo.

**Por defecto, nadie lo tiene** — ni el Subadministrador (su fila de permisos,
`sql/2026-10-26-cz3-rol-subadmin.sql`, no incluye `tecnologia.claves_equipos`).
Xaviel lo asigna a mano desde Administración › Roles a quien decida (paso
físico, pendiente).

**Fuera de Compa/MCP/el conector de Claude** (DA-17): `scripts/verify-boveda-
fuera-de-ia.mjs` ahora también busca `equipos-clave`/`tec_equipo_claves` además
de `boveda`.

## 5. Resumen — Subadministrador (verificado con `scripts/smoke-cz-permisos-negativos.mjs`, F4)
| Sensible | ¿Lo ve? |
|---|---|
| `/admin/*` (Usuarios, Roles, Auditoría, Parámetros, Compa conversaciones, Claude) | ❌ No — sin módulo `admin` |
| Vault (F4) | ❌ No — guard de rol estricto `admin` |
| Tecnología de plataforma (Odoo-sync, monitoreo, APIs, QA, Issues, Dev notes, diseño) | ❌ No — sin módulo `tecnologia` ni en `es_tecnologia()` |
| Inventario TI / Compras tecnológicas / Cotizaciones / Guía | ✅ Sí — permiso granular (DZ-20) |
| Legal / RRHH / Dirección | ❌ No — módulos no otorgados |
| Inventario, Compras, Proyectos, Flota, Bitácora, Documentos, Plantillas, Tareas | ✅ Sí — módulos de partida |
| Clave del equipo (DA4) | ❌ No — permiso granular `tecnologia.claves_equipos` aparte, nadie lo recibe por defecto |

## 5. Pagos de obra (DB4 — ronda DB, 29-oct-2026)

`sgc.pagos_obra` / `pagos_obra_lineas` guardan **montos pagados al personal** — dato
sensible. Reglas (db15):
- **Pantalla**: submódulo `ingenieria.pagos` (sembrado: `operar` a ingeniero_campo /
  gerente_proyectos / jefe_ingenieros; `ver` a abogado / gerencia / direccion).
- **Datos**: gates PROPIOS `puede_ver_pagos` / `puede_operar_pagos` — a propósito NO
  usan `nivel_submodulo` (su atajo regala 'operar' a todo el que tenga el módulo
  `ingenieria` completo, lección DA F4). Operar exige además `puede_ver_proyecto`
  de ESA obra. Escrituras solo por RPC SECURITY DEFINER.
- **Fuera de IA**: `verify-boveda-fuera-de-ia.mjs` también falla el build si
  `pagos_obra` aparece en Compa/MCP/assistant. El PDF va solo a
  `pagos_descargo_correos(+_extra)` (Legal/Eduardo/Yonairis).
- Enviado = cerrado; solo admin reabre (`pagos_obra_reabrir`, con rastro).
