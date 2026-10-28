# Release 1.204.0

- Equipo/tester: Claude Code (sesión autónoma, ronda DA) + **Xaviel probó en vivo**
  en `dev.sgcconstructorasd.com` (ver "OK de Xaviel" abajo).
- Qué se probó (automatizado, contra dev real `sgc-dev`):
  1. **Base del inventario (F1)**: smoke transaccional (ROLLBACK) — código `TEC-####`
     único bajo inserciones concurrentes, historial se llena por trigger (ya no por el
     navegador), estado/condición rechazan un valor fuera del catálogo.
  2. **Kits (F3)**: smoke transaccional — subcódigos `TEC-####-NN` correctos, un
     componente no puede tener sus propios componentes (un solo nivel), mover el kit
     cascada SOLO a componentes presentes, borrar el kit no borra sus piezas.
  3. **Clave del equipo (F4)**: smoke HTTP contra la edge `equipos-clave` YA DESPLEGADA
     en dev — sin auth (401), sin el permiso granular (403, confirmando que NO hereda
     el módulo Tecnología completo), guardar/ver/quitar con un valor de PRUEBA
     (descifrado correcto, nunca en claro en la tabla, el historial nunca contiene el
     valor), la bandera no-secreta `tiene_clave` se actualiza sola.
  4. **Conector de Claude / lote (F6)**: smoke HTTP contra `claude-borrador` YA
     DESPLEGADA — confirmar solo las filas seleccionadas, una fila inválida no tumba
     las demás, reintentar un lote ya confirmado es idempotente (no duplica).
  5. **Permisos negativos (F8)**: 8 asserts transaccionales — incluye el más importante,
     que `tecnologia.claves_equipos` NO se abre por tener el módulo `tecnologia`
     completo (el atajo de compatibilidad de AG12 se evitó a propósito para esta pieza).
  6. 13/13 evals de Compa (`scripts/compa-evals.mjs`) — se tocó `assistant/index.ts`
     (capObj agrega `permisos` para el gate del Subadministrador) y sigue 100% verde.
  7. `npm run build`, 127/127 Vitest, todos los guards de `prebuild` (incluido
     `verify-boveda-fuera-de-ia.mjs` extendido para también vigilar la clave del
     equipo) — verdes.
  8. Carga real de datos: los 16 equipos del inventario tecnológico (+ kit DJI con sus
     6 componentes) registrados por Xaviel el 26-oct, con sus 68 fotos reales — subidas
     y verificadas (content-length igual al archivo local). La clave real del equipo 02
     (nota adhesiva) NUNCA se escribió en ningún archivo/script/commit.
- Migraciones en el ledger de dev, verificadas por objeto: `2026-10-27-da1-base-equipos.sql`,
  `da2-campos-equipos.sql`, `da3-kits.sql`, `da4-claves-equipos.sql`,
  `da5-conector-tecnologia.sql`. Edges nuevas desplegadas en dev: `equipos-clave`,
  `leer-especificaciones-equipo` (+ `mcp`/`claude-borrador`/`assistant` redeployadas con
  el registro de herramientas ampliado).
- Versión de origen: 1.203.0
- Resultado: OK — automatizado de punta a punta Y con repaso visual real de Xaviel.
- Fecha: 2026-10-28

**OK de Xaviel**: probó personalmente el inventario en `dev.sgcconstructorasd.com` y
confirmó "i test it, is good, continue working" (28-oct-2026). Tras preguntarle
explícitamente hasta dónde promover (PR a `dev` ya mergeado, versión, PR `dev→main`,
aplicar a prod), respondió **"Todo: bump + PR dev→main + aplicar a prod"** — el PR #30
(`feature/da-ronda → dev`) ya estaba mergeado con su OK de una ronda de preguntas
anterior en esta misma sesión.

Queda como tarea física suya (ya comunicada aparte): teclear la clave compartida real
del equipo 02 (TEC-0015) desde la ficha — nunca se escribió en ningún lado —, revisar/
corregir los responsables externos y cuál de los 2 drones está dañado/perdido, y
decidir quién recibe el permiso granular `tecnologia.claves_equipos` (nadie lo tiene
por defecto).
