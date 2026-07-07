-- Enable Supabase Realtime on the tables whose changes should reach clients
-- live (task state changes, new assignments, approval requests) so the UI
-- updates without a page refresh and can raise on-screen toasts. mensajes was
-- already added when Mensajería shipped. Guarded so re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'sgc' and tablename = 'tareas'
  ) then
    alter publication supabase_realtime add table sgc.tareas;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'sgc' and tablename = 'aprobaciones_legales'
  ) then
    alter publication supabase_realtime add table sgc.aprobaciones_legales;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'sgc' and tablename = 'solicitudes_ausencia'
  ) then
    alter publication supabase_realtime add table sgc.solicitudes_ausencia;
  end if;
end $$;
