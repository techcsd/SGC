# EA1 — Proveedores de tecnología

Nota de Xaviel: «Crear o tener en tecnología el módulo de proveedores de tecnología. Con toda su info, contactos, trabajos realizados, facturas por proveedor y todo.» (caso real: «el de las puertas / cerradura inteligente» y no recordaba el nombre).

- Migraciones: `sql/2026-11-24-ea1-tec-proveedores.sql` (+ `sql/2026-11-24-ea1b-conector-proveedores.sql`). Reversas en `sql/_reversa/`.
- Submódulo: `tecnologia.proveedores` (registrado en `roles.service.ts`, ruta `/tecnologia/proveedores`, menú Tecnología › Proveedores).
- Pantalla: `src/app/pages/tecnologia/proveedores/` (lista + buscador único) y `proveedor-ficha/` (Resumen · Contactos · Trabajos · Facturas · Cotizaciones y compras · Notas).

## Permisos (vinculante)

| Quién | Nivel | Cómo se logra |
|---|---|---|
| Rol con módulo `tecnologia` | operar | helper AG12 `nivel_submodulo` (módulo padre = operar) |
| Admin | operar | `is_admin()` en el helper AG12 (Xaviel es admin **y** Tecnología). Si se quisiera «admin solo ve», habría que sacar `is_admin()` del helper para este submódulo: decisión pendiente, ver HANDOFF |
| Rol con módulo `compras` (sin `tecnologia`) | ver | el paso 9 de la migración fusiona `{"tecnologia.proveedores":"ver"}` en `sgc.roles.permisos` |
| Resto | nada | RLS devuelve 0 filas; la ruta da 403; los RPC lanzan 42501 |

## Casos RLS por rol (sin harness SQL: se verifican a mano / con `scripts/smoke-*` tras aplicar)

Correr como el usuario afectado (`set local role authenticated` + `request.jwt.claims`). Esperado:

| Caso | tecnologia | compras (ver) | admin | otro rol |
|---|---|---|---|---|
| `select * from sgc.tec_proveedores` | filas | filas | filas | 0 filas |
| `insert into sgc.tec_proveedores` | OK | **42501 / RLS** | OK | RLS |
| `update` contacto/trabajo/factura | OK | RLS (0 filas) | OK | RLS |
| `delete` contacto/trabajo/factura | OK | RLS | OK | RLS |
| `delete from sgc.tec_proveedores` | **permission denied** (sin grant, a propósito: se desactiva) | idem | idem | idem |
| `rpc buscar_tec_proveedores('cerradura')` | filas | filas | filas | 42501 |
| `rpc tec_proveedor_crear_desde_cotizacion` | OK | **42501** | OK | 42501 |
| `rpc tec_proveedor_vincular/desvincular` | OK | 42501 | OK | 42501 |
| `storage tec-proveedores`: leer | OK | OK | OK | denegado |
| `storage tec-proveedores`: subir/actualizar/borrar | OK | denegado | OK | denegado |

## Backfill y «por revisar»

Normalización (`sgc.tec_normalizar_proveedor`, espejo en `src/shared/utils/proveedor-normalizacion.util.ts` con spec): sin tildes, MAYÚSCULAS, sin puntuación, sin sufijo SRL/SA/EIRL/SAS/LTD/LLC/INC/CORP/CXA/CIA.

Fuentes: `tec_cotizaciones.proveedor`, `solicitud_compra_adjuntos.proveedor` y `solicitud_compra_items.proveedor_sugerido` de compras tecnológicas (`solicitudes_compra.categoria='tecnologia'`), y `api_servicios.proveedor` (la tabla de «APIs y consumo»). Los grupos limpios crean proveedor (`origen='backfill'`) y vinculan `proveedor_id` (cotizaciones) / `proveedor_tec_id` (compras). **Dudosos no se tocan** (varios proveedores en un texto, muy cortos, solo números, o nombres que son prefijo de otro: «ALTICE» vs «ALTICE DOMINICANA») y salen en `sgc.tec_proveedores_por_revisar()` (botón «Por revisar» de la lista). Nada se borra; re-correr la migración es idempotente.

Nota de diseño: en `solicitudes_compra` la columna se llama `proveedor_tec_id` (no `proveedor_id`) para no confundirse con `sgc.proveedores` (catálogo de Compras/Odoo).

## Conector (MCP)

`listar_proveedores_tecnologia` y `detalle_proveedor_tecnologia` (solo lectura, canal `mcp`), en `supabase/functions/_shared/herramientas.ts`. Matriz: `supabase/functions/assistant/PERMISOS-TOOLS.md`. Test: `supabase/functions/_shared/herramientas-proveedores.test.ts`. Compa (canal `compa`) aún no consume el catálogo.

## Pendiente / paridad

La app móvil (csd-app): lectura + buscador + contacto con un toque → PROMPT-157. Sin tercero nuevo (no cambia `docs/DATOS-Y-TERCEROS.md`; las facturas se guardan en un bucket privado propio, igual que las cotizaciones).
