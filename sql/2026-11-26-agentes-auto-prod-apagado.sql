-- 2026-11-26 -- Auto-prod de los agentes APAGADO por decisión de Xaviel (hasta tener el token del bot y revisar las primeras tareas).
-- Con agentes_auto_prod=false toda tarea del Ingeniero se queda en dev; pasar a prod requiere activarlo a mano en
-- Tecnología › Agentes (o ing_config_guardar). Reversa: sql/_reversa/2026-11-26-agentes-auto-prod-apagado.reversa.sql
begin;
update sgc.agente_ingeniero_config
   set valor = 'false'::jsonb,
       descripcion = 'EA-14: auto-prod APAGADO (26-nov-2026, decision de Xaviel: todo queda en dev hasta nueva orden).',
       updated_at = now()
 where clave = 'agentes_auto_prod';
commit;
