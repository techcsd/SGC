-- Reversa de sql/2026-11-26-agentes-auto-prod-apagado.sql: vuelve a encender el auto-prod.
begin;
update sgc.agente_ingeniero_config
   set valor = 'true'::jsonb,
       descripcion = 'EA-14: auto-prod ENCENDIDO (decision de Xaviel). Apagado = todo queda en dev.',
       updated_at = now()
 where clave = 'agentes_auto_prod';
commit;
