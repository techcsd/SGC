-- BL5 — Personal de obra: (1) "quién lo subió" siempre relleno; (2) base para
-- deduplicar por documento normalizado (el caso Edward Mota: 4022685801-3 vs
-- 402-2685801-3 = dos strings distintos → dos filas).
--
-- Aditivo. La FUSIÓN de duplicados existentes y el índice ÚNICO quedan como §E
-- (tocan data real y requieren decisión) — aquí sólo la columna normalizada + un
-- índice NO único que habilita la deduplicación, y el trigger de autoría.

begin;

-- (1) registrado_por se rellena solo (el formulario manual no lo mandaba → NULL;
--     los importadores y la app sí). Trigger BEFORE INSERT, robusto a todo camino.
create or replace function sgc.tg_personal_obra_registrado_por()
returns trigger language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if NEW.registrado_por is null then NEW.registrado_por := auth.uid(); end if;
  return NEW;
end;
$function$;
drop trigger if exists trg_personal_obra_registrado_por on sgc.personal_obra;
create trigger trg_personal_obra_registrado_por
  before insert on sgc.personal_obra
  for each row execute function sgc.tg_personal_obra_registrado_por();

-- (2) Documento normalizado (sólo dígitos) — columna generada. Alimenta dedupe e
--     índice. NULL si no hay dígitos (para no colisionar filas sin documento).
alter table sgc.personal_obra
  add column if not exists documento_numero_norm text
  generated always as (nullif(regexp_replace(coalesce(documento_numero, ''), '\D', '', 'g'), '')) stored;

create index if not exists ix_personal_obra_doc_norm
  on sgc.personal_obra (proyecto_id, documento_numero_norm);

commit;
