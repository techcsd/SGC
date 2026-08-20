# AS4 — Rediseño de la pantalla de permisos (propuesta v1)

> Objetivo del apunte de Xaviel: "hacer los permisos por submódulo **más fáciles y entendibles**".
> El **backend ya funciona** (no se rehace): `sgc.roles.permisos jsonb` (`"modulo.submodulo" → "ver"|"operar"`), helper `sgc.nivel_submodulo`, espejo en `UserService`, y las herramientas de auditoría AN4 (`accesos_efectivos_*`, `usuarios_multi_rol`). Esto es **solo UX** sobre lo existente.

## Estado actual (verificado)
- Editor actual: `admin/roles/role-permisos-editor` — lista plana por módulo con checkboxes ver/operar y chip "Próximamente" para submódulos aún no gateados.
- **Gateados end-to-end:** `bitacora`, `compras`, `inventario`, `flota`, `proyectos`, `plataforma`, `obra.no_conformidades`.
- **"Próximamente" (se guarda pero no gatea):** todo `rrhh.*` y `obra.*` (salvo no_conformidades).
- Sin: búsqueda, tri-estado, presets, descripciones humanas, diff antes de guardar, auditoría de cambios de permiso.

## Propuesta de UI (matriz Rol × Módulo/Submódulo)
1. **Layout maestro-detalle.** Izquierda: lista de roles (con nº de usuarios y chips de módulos). Derecha: la matriz del rol seleccionado.
2. **Jerarquía expandible por módulo**, con **tri-estado** en el encabezado del módulo:
   - ✅ Todo (todos los submódulos en operar) · ➖ Parcial · ⬜ Nada.
   - Click en el tri-estado **cascadea** a los submódulos (todo→operar, nada→sin acceso).
   - Contador **"X de Y submódulos"** por módulo.
3. **Nivel por submódulo** = segmented control de 3 (Sin acceso / Ver / Operar), no dos checkboxes sueltos.
4. **Descripción en lenguaje humano** de una línea bajo cada submódulo ("Conduces — crear y ver conduces de sus obras"). Diccionario centralizado en `roles.service.ts` (`SUBMODULOS[k].descripcion`).
5. **Búsqueda** por nombre de módulo o de permiso (filtra la matriz en vivo).
6. **Chip "Próximamente"** se mantiene donde `enforced` sea falso (honesto: se guarda pero no gatea aún).
7. **Presets por cargo** (botón "Aplicar preset"): plantillas Chofer / Ingeniero de campo / Almacenista / Logística / Gerente. + "Copiar permisos de otro rol" (dropdown de roles → precarga la matriz).
8. **Diff antes de guardar** (modal de confirmación): lista "Gana: …" / "Pierde: …" comparando el estado actual vs el editado (reutiliza el cálculo de diff de AN4). Botón **"Ver la app como este rol"** (reusa `accesos_efectivos_rol`). Nada se guarda a ciegas.
9. **Guardado explícito** + toast, y **auditoría**: tabla nueva `sgc.roles_permisos_auditoria (rol_id, actor_id, cambio jsonb, at)` — registra qué permiso cambió, quién y cuándo (trigger o RPC de guardado).
10. **Multi-rol**: banner "Los permisos de varios roles se **suman**; se muestra el efectivo" + link a la vista de accesos efectivos del usuario (AN4).

## Alcance de construcción (si apruebas)
- **Frontend:** rediseñar `role-permisos-editor` (tri-estado, búsqueda, descripciones, presets, diff modal). Sin cambios de contrato de datos.
- **Backend (mínimo, aditivo):** tabla `roles_permisos_auditoria` + registrar en el guardado; diccionario de descripciones (front). Los presets son plantillas en el front (arrays de `"modulo.submodulo":"nivel"`).
- **Fuera de alcance v1:** activar el gateo real de los submódulos "Próximamente" (`rrhh.*`, `obra.*`) — eso es enforcement, no UX; se hace aparte cuando toque cada módulo.

## Decisiones que necesito de ti
- ¿Los **presets por cargo** te sirven con esas 5 plantillas, o prefieres otras?
- ¿Quieres la **auditoría de cambios de permiso** (tabla nueva) en v1, o la dejamos para después?
