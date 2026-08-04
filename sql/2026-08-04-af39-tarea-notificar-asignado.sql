-- AF39 — Notificar (in-app + push) al asignado cuando se le crea/reasigna una
-- tarea. `sgc.notificar` ya espeja push (AF7). Cubre web y app. Aditivo.

create or replace function sgc.tg_tarea_notificar_asignado()
returns trigger
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and new.asignado_a is distinct from old.asignado_a) then
    if new.asignado_a is not null and new.asignado_a <> coalesce(new.asignado_por, new.asignado_a) then
      perform sgc.notificar(
        new.asignado_a, 'info', 'Nueva tarea asignada',
        format('Te asignaron: %s', new.titulo),
        '/tareas'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tarea_notificar_asignado on sgc.tareas;
create trigger trg_tarea_notificar_asignado
  after insert or update of asignado_a on sgc.tareas
  for each row execute function sgc.tg_tarea_notificar_asignado();
