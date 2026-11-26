-- Reversa: vuelve a apagar el auto-prod de los agentes.
begin;
update sgc.agente_ingeniero_config
   set valor = 'false'::jsonb,
       descripcion = 'EA-14: auto-prod APAGADO (decision de Xaviel: todo queda en dev hasta nueva orden).',
       updated_at = now()
 where clave = 'agentes_auto_prod';
commit;
