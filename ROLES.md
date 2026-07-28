# ROLES.md — Auditoría de roles y permisos (SGC)

> Documento vivo. Última actualización: **2026-07-28** (PROMPT-1 · Ronda IDs Y · FASE 3).
> Fuente: esquema `sgc` en producción (`jeeqhgccqefbqilntcpu`) + código Angular.

## 1. Modelo de permisos — ya es multi-rol

- Un usuario se vincula a **N roles** por la tabla puente `sgc.usuarios_roles (usuario_id, rol_id, asignado_por)`. **No** existe un campo `rol` único en `usuarios`; no hay que "convertir" nada.
- Los **módulos efectivos** de un usuario = **unión** de `roles.modulos` de todos sus roles (`UserService.modulos` en front; `sgc.tiene_modulo()` en RLS).
- **No hay concepto de "rol primario"** y no se introduce: el modelo N:N lo hace innecesario. Para mostrar en UI se listan todos los roles como chips.
- Reflejo de cambios: al asignar/quitar un rol, el usuario ve el cambio en su **próximo `ensureFreshProfile`** (máx. 5 min, `PROFILE_MAX_AGE_MS`) o de inmediato al **re-login**. Enforcement real = RLS + guards; la UI es conveniencia.

### Capas de control (defensa en profundidad)
| Capa | Dónde | Helper |
|------|-------|--------|
| Ruta Angular | `app.routes.ts`, `*.routes.ts` | `moduleGuard(modulo)`, `flotaElevadoGuard`, `tecnologiaGuard` (Y11) |
| Sidebar | `shell.ts` / `shell.html` | `hasModulo`, `hasRole('admin')`, `esFlotaElevado`, `esTecnologia` (Y11) |
| Datos (RLS) | políticas `sgc.*` | `sgc.is_admin()`, `sgc.tiene_modulo()`, `sgc.es_flota_elevado()`, `sgc.es_tecnologia()` (Y11) |

> Regla: cada predicado de front (`UserService`) debe tener espejo en SQL. `esTecnologia` ↔ `es_tecnologia()`; `esFlotaElevado` ↔ `es_flota_elevado()`.

## 2. Módulos disponibles (`sgc.roles.modulos text[]`)
`inventario · compras · rrhh · proyectos · flota · bitacora · documentos · plantillas · legal · tareas · tecnologia · direccion · admin`

(Mensajería y "Mis tareas" no requieren módulo — todo usuario autenticado.)
El módulo `tecnologia` gatea el **contenido** de Tecnología (guía, matriz, inventario TI). El **submódulo de plataforma** (versiones, reportes de errores, monitoreo) se gatea por **rol** (`admin | tecnologia`) vía `es_tecnologia()`, NO por el módulo — para no filtrarse a `encargado_tecnologia`.

## 3. Roles → módulos (BD, 2026-07-28)
| id | codigo | nombre | módulos |
|----|--------|--------|---------|
| 1 | `admin` | Administrador | inventario, compras, rrhh, proyectos, flota, bitacora, documentos, admin, legal, tareas, plantillas, direccion, tecnologia |
| 2 | `gerencia` | Gerencia | inventario, compras, rrhh, proyectos, flota, direccion |
| 3 | `logistica` | Logística y Transporte | inventario |
| 4 | `coord_compras` | Coordinador de Compras | compras, inventario |
| 5 | `jefe_rrhh` | Jefe de RRHH | rrhh |
| 6 | `gerente_proyectos` | Gerente de Proyectos | proyectos |
| 7 | `jefe_flota` | Jefe de Flota | flota (elevado) |
| 8 | `ingeniero_campo` | Ingeniero de Campo | bitacora |
| 12 | `abogado` | Abogado | legal, documentos, plantillas |
| 16 | `direccion` | Dirección General | inventario, compras, rrhh, proyectos, flota, bitacora, documentos, plantillas, legal, tareas, direccion |
| 17 | `encargado_tecnologia` | Encargado de Tecnología | tecnologia (solo contenido TI) |
| 18 | `ingeniero_oficina` | Ingeniero de Oficina | proyectos, documentos, compras, bitacora, tareas |
| 19 | `chofer_transportista` | Chofer / Transportista | flota (NO elevado; login por cédula+PIN) |
| 20 | `guarda_almacen` | Guarda-Almacén | inventario |
| **21** | **`tecnologia`** | **Tecnología** | **tecnologia + plataforma (Y11)** |

Roles "elevados" de flota (ven vehículos desactivados, gestionan todo): `admin, direccion, gerencia, jefe_flota` (`es_flota_elevado()`).
Roles de plataforma Tecnología (`es_tecnologia()`): `admin, tecnologia`.

## 4. Usuarios → roles (activos, 2026-07-28)
| Usuario | Roles |
|---------|-------|
| Xaviel Terrero | admin |
| Felipe Scheker | direccion |
| Sonia Castillo | gerencia, abogado |
| Eduardo NG | ingeniero_oficina, ingeniero_campo, gerente_proyectos, gerencia |
| Jonathan Roman | gerente_proyectos, ingeniero_campo, ingeniero_oficina |
| Manuel Guilamo | gerente_proyectos, ingeniero_campo, ingeniero_oficina |
| Ramon Cabrera | gerente_proyectos, ingeniero_oficina, ingeniero_campo |
| Socrates Rodriguez | gerente_proyectos, ingeniero_campo, ingeniero_oficina, guarda_almacen |
| Misael Encarnacion | jefe_flota, logistica |
| Raykler Peña | logistica, coord_compras, guarda_almacen, jefe_flota |
| Angelica | jefe_rrhh |
| Manolo | chofer_transportista |
| Papo | chofer_transportista |
| Xaviel Terrero Test | ingeniero_oficina |
| Test User 3 | ingeniero_campo, gerente_proyectos |

## 5. Hallazgos
1. **Multi-rol ya nativo** — varios usuarios ya tienen 2-4 roles y ven la unión de módulos (verificado: Misael/Raykler ven flota + inventario). El requisito Y13 (multi-rol) ya estaba cubierto por el diseño; esta ronda solo lo documenta y añade el rol `tecnologia`.
2. **Rol `tecnologia` (id 21) creado** — persona técnica con acceso al módulo Tecnología (contenido + plataforma) sin ser admin. Distinto de `encargado_tecnologia` (solo contenido TI): el plataforma-ops (versiones, reportes de errores, monitoreo) NO se filtra a `encargado_tecnologia`.
3. **UI de usuarios** — el drawer de **edición** ya asigna/quita múltiples roles (checkboxes). El drawer de **creación** asigna un solo rol inicial (por diseño; se completan más roles editando). El requisito "asignar/quitar múltiples roles" queda satisfecho por la edición.
4. **Backlog de limpieza RLS (no bloqueante)** — se observan políticas duplicadas/heredadas en varias tablas: dos capas de SELECT que mezclan `sgc.is_admin()`/`tiene_modulo()` (nuevas) con `'admin' = ANY(sgc.get_user_roles())` (viejas) en `usuarios`, `usuarios_roles`, `roles`, `salidas_inventario`, `entradas_inventario`, `detalle_*`. Funcionan (OR permisivo) pero convendría consolidar en un solo juego de políticas por tabla. Documentado para una futura ronda de higiene de RLS.

## 6. Checklist para agregar un módulo nuevo (recordatorio)
1. `MODULOS_DISPONIBLES` en `roles.service.ts`.
2. `moduleGuard('<mod>')` en las rutas.
3. Entrada en `shell.ts` (nav) con gating.
4. `array_append` del módulo al rol `admin` (gotcha recurrente).
5. Espejo del predicado en RLS si aplica.
