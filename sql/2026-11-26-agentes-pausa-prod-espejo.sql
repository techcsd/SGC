-- 26-nov-2026: pausa TOTAL de los agentes en PROD hasta que exista el espejo prod->dev.
-- Motivo: el runner (GitHub) usa la base de dev; las tareas de prod llegan con ids que no existen alli
-- (RPC ing_* -> tarea_no_existe) y se gasta IA sin resultado. Reversa: sql/_reversa/2026-11-26-agentes-pausa-prod-espejo.reversa.sql
begin;
update sgc.agente_ingeniero_config
   set valor = 'true'::jsonb,
       descripcion = 'PAUSA TOTAL (26-nov-2026): el runner no ve las tareas de prod hasta que exista el espejo prod->dev.',
       updated_at = now()
 where clave = 'agentes_pausa_total';
commit;
