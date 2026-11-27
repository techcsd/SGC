begin;
update sgc.agente_ingeniero_config set valor = 'false'::jsonb, descripcion = 'Pausa total de los agentes.', updated_at = now() where clave = 'agentes_pausa_total';
commit;
