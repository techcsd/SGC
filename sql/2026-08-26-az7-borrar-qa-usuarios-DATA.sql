do $$
declare qa uuid[]; n int;
begin
  select array_agg(id) into qa from sgc.usuarios where (nombre ilike 'QA %' or nombre ilike 'QA%') and es_prueba=true;
  -- Desvincula los 2 refs NO ACTION (test) para no bloquear el borrado.
  update sgc.conductores set usuario_id=null where usuario_id = any(qa);
  update sgc.personal_obra set usuario_id=null where usuario_id = any(qa);
  -- Borra los perfiles (cascada limpia roles/notificaciones/notas/etc.).
  delete from sgc.usuarios where id = any(qa);
  -- Borra las cuentas de auth.
  delete from auth.users where id = any(qa);
  get diagnostics n = row_count;
  raise notice 'auth borradas: %', n;
end $$;
select count(*) as qa_restantes from sgc.usuarios where (nombre ilike 'QA %' or nombre ilike 'QA%');
