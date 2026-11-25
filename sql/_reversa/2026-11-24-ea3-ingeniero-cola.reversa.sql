-- Reversa de EA3 parte A (sql/2026-11-24-ea3-ingeniero-cola.sql). Orden inverso.
-- ATENCION: borra la cola y la config del Ingeniero (los datos de agente_eventos/
-- agente_aprobaciones/uso_ia ya escritos se conservan; solo se quitan los agentes si no tienen eventos).
begin;

select cron.unschedule('agente-ingeniero-cola')      where exists (select 1 from cron.job where jobname = 'agente-ingeniero-cola');
select cron.unschedule('agente-ingeniero-despachar') where exists (select 1 from cron.job where jobname = 'agente-ingeniero-despachar');
select cron.unschedule('agente-ingeniero-barrido')   where exists (select 1 from cron.job where jobname = 'agente-ingeniero-barrido');

drop function if exists sgc.ing_tarea_admin_accion(uuid, text);
drop function if exists sgc.ing_config_guardar(text, jsonb);
drop function if exists sgc.ing_zona_roja_crear_aprobacion(uuid, text);
drop function if exists sgc.ing_evento_registrar(uuid, text, jsonb, numeric);
drop function if exists sgc.ing_tarea_actualizar(uuid, text, jsonb);
drop function if exists sgc.ing_tarea_leer(uuid);
drop function if exists sgc.ing_config_leer();
drop function if exists sgc.ing_estado_dia();
drop function if exists sgc.ing_transicion_valida(text, text);
drop function if exists sgc._ing_evento(text, text, text, text, jsonb);
drop function if exists sgc._ing_cfg(text);

drop trigger if exists trg_ing_tareas_sanear on sgc.agente_ingeniero_tareas;
drop function if exists sgc.ing_tareas_sanear_trg();
drop function if exists sgc.ing_sanear_texto(text);

drop table if exists sgc.agente_ingeniero_tareas;
drop table if exists sgc.agente_ingeniero_config;

-- Quita los agentes solo si no tienen eventos/aprobaciones colgando; si los tienen, quedan inactivos.
delete from sgc.agentes a where a.clave in ('ingeniero','guardian')
  and not exists (select 1 from sgc.agente_eventos e where e.agente_id = a.id)
  and not exists (select 1 from sgc.agente_hallazgos h where h.agente_id = a.id)
  and not exists (select 1 from sgc.agente_acciones x where x.agente_id = a.id)
  and not exists (select 1 from sgc.agente_aprobaciones p where p.agente_id = a.id);
update sgc.agentes set activo = false where clave in ('ingeniero','guardian');

-- Restaura el CHECK previo (DM2). NOT VALID: las filas ya desactivadas de ingeniero/guardian (si quedaron) no bloquean la reversa.
alter table sgc.agentes drop constraint if exists agentes_clave_check;
alter table sgc.agentes add constraint agentes_clave_check
  check (clave in ('vigia','capataz','soporte','auditor','escriba','cronista','pendientes')) not valid;

commit;
