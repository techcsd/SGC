-- ============================================================================
-- CC8 (PROMPT-74 F1) — 🔴 "permission denied for table bitacora_orden_detalle"
-- ----------------------------------------------------------------------------
-- Nota de Xaviel (29-sep): «in the web the "ordenes de trabajo" we got an issue,
-- i think is the db. see the referenced image.» (captura: permission denied).
--
-- CAUSA (regla 3): `listar_ordenes_trabajo()` es SECURITY INVOKER (bw1, para
-- respetar la RLS de bitácora) y lee sgc.bitacora_orden_detalle /
-- bitacora_orden_firmas. Esas tablas nacieron en bn1 (2026-09-09) con RLS +
-- política `select` para `authenticated`, PERO SIN `grant select … to
-- authenticated`. Postgres revisa el GRANT ANTES que la RLS → 403 para TODO
-- usuario de la web (incluido admin). En dev/app no saltó: la app usa el RPC
-- definer `orden_trabajo_detalle`, y los smokes corrieron con service_role.
--
-- FIX: `grant` del comando que cada política ya declara `to authenticated`.
-- El GRANT es el interruptor grueso; la RLS es el filtro fino. Una política
-- `to authenticated FOR <cmd>` SIN su grant es un bug latente: el acceso ya
-- declarado hace 403 en silencio. Completar el grant realiza esa intención y
-- NO puede exceder el predicado de la política (RLS sigue filtrando).
--
-- ALCANCE (auditoría de esquema): además de las 2 tablas de OT, la auditoría
-- DB (scripts/audit-rls-tablas-nuevas.mjs, ampliada este round) halló 34 tablas
-- más con el mismo patrón (política `to authenticated` sin el grant del comando).
-- Se conceden todas aquí — verificado política por política que cada una está
-- gateada (is_admin / tiene_modulo / dueño / rol / EXISTS-padre / catálogo).
-- Los grants son idempotentes; en prod la mayoría son no-op salvo donde el
-- acceso estaba realmente roto (OT es el caso visible).
--
-- BU1 (regla 18): aplicar `--env dev` primero, probar, luego `--env prod --yes`.
-- ============================================================================

begin;

-- ── Órdenes de trabajo (CC8 — el bug visible en la captura) ──────────────────
grant select on sgc.bitacora_orden_detalle to authenticated;
grant select on sgc.bitacora_orden_firmas  to authenticated;

-- ── Resto de gaps de la auditoría de GRANT (misma clase, gateados por RLS) ───
-- Inventario / activos
grant select, insert, update, delete on sgc.activos               to authenticated;
grant delete                          on sgc.articulos             to authenticated;
grant delete                          on sgc.categorias_inventario to authenticated;
grant select, insert                  on sgc.historial_activos     to authenticated;
grant select, insert, update, delete  on sgc.conteos_inventario    to authenticated;
grant select, insert, update, delete  on sgc.conteo_items          to authenticated;
grant select                          on sgc.stock_cuarentena      to authenticated;
grant select                          on sgc.stock_cuarentena_mov  to authenticated;
grant select                          on sgc.retiros_material      to authenticated;
grant select                          on sgc.retiro_material_items to authenticated;
grant select                          on sgc.retiro_material_fotos to authenticated;

-- Compras
grant delete                          on sgc.solicitudes_compra     to authenticated;
grant update, delete                  on sgc.solicitud_compra_items to authenticated;
grant select, insert, update, delete  on sgc.gasto_categorias       to authenticated;
grant select, insert, update, delete  on sgc.gastos_directos        to authenticated;

-- Flota
grant insert, update, delete on sgc.checklist_foto_slots      to authenticated;
grant delete                 on sgc.checklist_plantillas      to authenticated;
grant delete                 on sgc.checklist_plantilla_items to authenticated;
grant insert, update, delete on sgc.licencia_categorias       to authenticated;
grant update                 on sgc.ruta_paradas              to authenticated;

-- Proyectos / cronograma
grant update on sgc.cronograma_tarea_bitacoras to authenticated;

-- RRHH
grant delete on sgc.empleados to authenticated;

-- Administración / usuarios / roles (gate is_admin en la política)
grant insert, update         on sgc.usuarios       to authenticated;
grant insert, update, delete on sgc.usuarios_roles to authenticated;
grant delete                 on sgc.cargos         to authenticated;
grant delete                 on sgc.parametros     to authenticated;
grant insert, update, delete on sgc.notif_tipo     to authenticated;

-- Importación de datos (CC4 se apoya en estas)
grant select                         on sgc.importaciones        to authenticated;
grant select, insert, update, delete on sgc.importaciones_mapeo  to authenticated;

-- Asistente / Tecnología / outbox
grant update, delete on sgc.assistant_acciones                 to authenticated;
grant delete         on sgc.assistant_idempotencia             to authenticated;
grant select, update on sgc.assistant_consultas_no_atendidas   to authenticated;
grant select         on sgc.resumen_operaciones_envio          to authenticated;
grant select, update on sgc.outbox_atascados                   to authenticated;
grant select         on sgc.outbox_fix_publicado               to authenticated;

commit;
