-- Reversa de 2026-11-28-eb-cola-odoo-slo-alerta.sql (script de rollback: se registra, NO se ejecuta sin OK).
-- Quita lo nuevo; para recuperar la version anterior de odoo_canary_criterios() volver a correr
-- sql/2026-11-21-odoo-canary-slo-2min.sql.
begin;
select cron.unschedule('sgc-odoo-alertar-cola-atascada');
drop function if exists sgc.odoo_alertar_cola_atascada();
drop function if exists sgc.odoo_cola_estado();
delete from sgc.parametros where clave in ('odoo_alerta_cola_activa', 'odoo_alerta_cola_min', 'odoo_alerta_cola_horas', 'odoo_slo_muestras_min');
commit;
