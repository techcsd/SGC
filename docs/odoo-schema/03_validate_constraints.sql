-- DDL opcional posterior a la instalación. Dev primero; no altera datos.
begin;
set local lock_timeout='3s';
set local statement_timeout='90s';
do $validate$
declare r record;
begin
  for r in select t.relname,c.conname from pg_constraint c
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='sgc' and c.conname like 'odoo_v1_%' and not c.convalidated
  loop
    execute format('alter table sgc.%I validate constraint %I',r.relname,r.conname);
  end loop;
end;
$validate$;
commit;
