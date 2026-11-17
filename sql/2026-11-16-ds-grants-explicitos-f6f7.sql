-- DS-13/24/25/27-29: grants EXPLICITOS, uno por funcion (BM4: audit-rpc-grants no entiende `grant ... on function a(), b()`).
-- Idempotente y sin cambio de comportamiento: repite los grants que las migraciones ds13/ds24/ds25/ds27-29 ya dieron en lista.
-- Todas las funciones gatean por rol/modulo dentro de su cuerpo.

grant execute on function sgc.odoo_conciliar_cargar(uuid) to authenticated, service_role;
grant execute on function sgc.odoo_conciliar_saldos(uuid, text[]) to authenticated, service_role;
grant execute on function sgc.odoo_conciliar_marca(uuid) to authenticated, service_role;
grant execute on function sgc.odoo_conciliacion_estado() to authenticated;
grant execute on function sgc.solicitudes_vencidas_listar() to authenticated;
grant execute on function sgc.solicitudes_vencidas_cerrar(jsonb, text) to authenticated;
grant execute on function sgc.adopcion_entradas_con_oc(date, date) to authenticated;
grant execute on function sgc.proveedores_curacion_listar() to authenticated;
grant execute on function sgc.proveedores_duplicados(numeric) to authenticated;
grant execute on function sgc.proveedores_ratificar_lote(uuid[]) to authenticated;
grant execute on function sgc.proveedores_ids_selector() to authenticated;
grant execute on function sgc.odoo_ratificar_adr(integer, text) to authenticated;
grant execute on function sgc.odoo_fase_set(text, boolean, jsonb) to authenticated;
grant execute on function sgc.odoo_canary_permite(uuid) to authenticated, service_role;
grant execute on function sgc.odoo_canary_criterios() to authenticated;
grant execute on function sgc.odoo_ajuste_solicitar(uuid) to authenticated, service_role;
grant execute on function sgc.odoo_ajuste_decidir(uuid, boolean, text) to authenticated;
grant execute on function sgc.odoo_slo_publicacion() to authenticated, service_role;
grant execute on function sgc.odoo_corte_configurar(uuid, date, boolean) to authenticated;
grant execute on function sgc.odoo_corte_fuente_set(uuid, boolean) to authenticated;
grant execute on function sgc.odoo_contingencia_aprobar(uuid, text, integer) to authenticated;
grant execute on function sgc.odoo_movimiento_permitido(uuid, boolean) to authenticated, service_role;
