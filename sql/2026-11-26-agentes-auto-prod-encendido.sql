-- Enciende el auto-prod de los agentes (decision de Xaviel, 26-nov-2026): el Guardian aprueba y la promocion sube a prod
-- solo fuera de zona roja, con los frenos del diseno (max_prod_por_dia, pausa_total, reversion automatica).
-- Revierte sql/2026-11-26-agentes-auto-prod-apagado.sql. Reversa: sql/_reversa/2026-11-26-agentes-auto-prod-encendido.reversa.sql
begin;
update sgc.agente_ingeniero_config
   set valor = 'true'::jsonb,
       descripcion = 'EA-14: auto-prod ENCENDIDO (26-nov-2026, decision de Xaviel). Apagado = todo queda en dev.',
       updated_at = now()
 where clave = 'agentes_auto_prod';
commit;
