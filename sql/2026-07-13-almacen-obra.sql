-- Almacén por obra: enlaza una bodega a un proyecto (almacén de obra) o márcala
-- como principal global. + Enciende la validación de equipo en requisiciones.
set search_path = sgc, public;

alter table sgc.bodegas
  add column if not exists proyecto_id uuid references sgc.proyectos(id),
  add column if not exists es_principal boolean not null default false;
create index if not exists idx_bodegas_proyecto on sgc.bodegas(proyecto_id);
comment on column sgc.bodegas.proyecto_id is 'Obra a la que pertenece este almacén (almacén de obra). Null = almacén general/global.';
comment on column sgc.bodegas.es_principal is 'true = almacén principal global (de donde salen los materiales hacia las obras).';

-- Encender la validación de equipo (solo el Residente/Responsable requisa).
update sgc.parametros set valor = 'true', updated_at = now() where clave = 'requisicion_validar_equipo';
