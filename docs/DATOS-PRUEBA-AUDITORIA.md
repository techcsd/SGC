# Auditoría transversal de datos de prueba (`es_prueba`) — AE1 (31/07/2026)

Tercera vez que aparece la misma clase de fuga (Z3 → AD1 → **AE1**). Esta vez se cierra
de forma transversal y se deja un **helper central** para que las vistas nuevas no puedan
olvidarlo.

## Cómo funciona `es_prueba`

- 24 tablas tienen la columna `es_prueba` (T2/Z1/Z5) con una **RLS restrictiva**
  `"es_prueba: oculta a no-admin"` (`not es_prueba or is_admin()`). Es decir: a los
  **no-admin** el servidor ya les oculta las filas de prueba; el problema es solo para el
  **admin**, que sí las recibe y cuyos KPIs las sumaban.
- Tablas SIN la columna (`asistencia`, `solicitudes_ausencia`, `empleado_documentos`,
  `tareas`, `contratos`, …) solo pueden excluir prueba **uniendo al padre** que sí la tiene.

## Helper central (nuevo) — úsalo SIEMPRE

`DatosPruebaViewService` (`src/shared/services/datos-prueba-view.service.ts`):

```ts
verPrueba = computed(() => userService.hasRole('admin') && ver());   // única fuente de verdad
visibles<T extends {es_prueba?}>(items): T[]                          // filtra listas/KPIs en memoria
```

- **KPI/lista en memoria**: base = `datosPruebaViewSvc.visibles(fuente())`. Nunca contar
  sobre el arreglo crudo.
- **Query servidor con columna**: `soloReales ? q.eq('es_prueba', false) : q` (patrón dashboard).
- **Sin columna (hijos)**: inner join filtrado al padre — `empleados!inner(es_prueba)` +
  `.eq('empleado.es_prueba', false)`; o excluir por el set de ids visibles del padre.
- **Regla dura**: los **badges/contadores** (notificaciones) NUNCA cuentan prueba, aunque
  el admin tenga el toggle activo (igual que los KPIs de proyectos).

## Checklist módulo → estado (tras AE1)

| Módulo / vista | Antes | Ahora | Cómo |
|---|---|---|---|
| **RRHH › Reportes** (activos, total, masa salarial, contratos, asistencia, deptos) | ✗ FUGA | ✅ | `visiblesEmp()` + `asistenciaVisible()` (excluye por empleado) |
| **RRHH › Empleados** (tarjetas total/contrato, selector de jefe) | ✗ FUGA | ✅ | `visibles(empleados())` |
| **RRHH › Asistencia** (resumen, tabla, selector) | ✗ FUGA | ✅ | `registrosVisibles()` por `empleado.es_prueba` + selector filtrado |
| **RRHH › Ausencias** (pendientes, lista, selector) | ✗ FUGA | ✅ | `solicitudesVisibles()` por `empleado.es_prueba` + selector filtrado |
| **Ausencias badge** (`countPendientes`) | ✗ FUGA | ✅ | inner join `empleados!inner(es_prueba)` (siempre excluye) |
| **Dashboard** (valor inventario, stock crítico, stock por categoría) | ✗ FUGA | ✅ | `sinPrueba(articulos)` |
| **Dashboard** (empleados activos, empleados por depto) | ✗ FUGA | ✅ | `sinPrueba(empleados)` |
| **Dashboard** (proyectos activos, por estado, presupuesto) | ✗ FUGA | ✅ | `sinPrueba(proyectos)` |
| **Dashboard** (asistencia hoy) | ✗ FUGA | ✅ | inner join a empleados (solo reales) |
| **Dashboard** (ausencias pendientes) | ✗ FUGA | ✅ | inner join a empleados (solo reales) |
| **Proyectos › Lista** (KPIs total/en progreso/completados/presupuesto) | ✗ FUGA | ✅ | `visiblesProy()` (helper central) |
| Inventario (artículos/activos/entradas/salidas/bodegas/conteos) | ✅ | ✅ | ya filtraban por lista |
| Flota (vehículos/conductores/estado/combustible/mant./rutas/checklists/accidentes) | ✅ | ✅ | ya filtraban |
| Proyectos › ranking (`kpi_proyectos`) | ✅ | ✅ | RPC ya excluye (`ad-proyectos-aislamiento`) |
| Compras (proveedores/órdenes) | ✅ | ✅ | sin KPI cruzado; gasto en dashboard filtra |
| Bitácora › Historial | ✅ | ✅ | ya filtraba |
| Tareas | n/a | n/a | `tareas` no tiene columna `es_prueba` |

## Con el toggle "Mostrar datos de prueba" (admin)

`visibles()` devuelve TODO (incluye prueba) cuando `verPrueba()` es true. Los datos de
prueba se distinguen visualmente por el badge/estilo de "dato de prueba" que ya pintan las
listas marcables (patrón Z5(d)). Los badges de notificación siguen excluyéndolos siempre.

## Regla para vistas NUEVAS

Cualquier KPI/reporte sobre una entidad con `es_prueba` **debe** partir de
`datosPruebaViewSvc.visibles(...)` (memoria) o del patrón `sinPrueba()`/inner-join
(servidor). Si la entidad no tiene la columna, filtra por el padre. No re-implementar
`esAdmin() && mostrarPrueba()` a mano — usar `verPrueba()`.
