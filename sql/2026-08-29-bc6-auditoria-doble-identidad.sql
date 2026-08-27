-- ============================================================================
-- PROMPT-21 (BC) FASE 2 — BC6/AZ10: auditoría de DOBLE IDENTIDAD por escritura.
--   La impersonación universal (AZ10) ya está viva (banner, límite 1 h, audit_log
--   de inicio/fin, candados). Faltaba lo que el prompt subraya: que CADA escritura
--   hecha durante una sesión impersonada quede atribuida como "por admin X como
--   usuario Y", no sólo el inicio/fin de la sesión.
--
--   La sesión impersonada se abre con un magic-link DESPUÉS de marcar al objetivo
--   con app_metadata.impersonated_by = <admin>. Ese claim viaja en el JWT → es
--   legible en SQL. Se estampa en el change-log (sgc.auditoria) por cada fila.
--
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-29-bc6-auditoria-doble-identidad.sql
-- ============================================================================
set search_path = sgc, public;

-- ── 1) Columna nueva en el change-log ───────────────────────────────────────
alter table sgc.auditoria
  add column if not exists impersonado_por uuid;
comment on column sgc.auditoria.impersonado_por is
  'BC6/AZ10 — si la escritura ocurrió en una sesión impersonada, el admin real que actuó "como" el actor_id. NULL en operación normal.';

-- FK con nombre explícito (el embed PostgREST del panel de Auditoría lo usa).
do $$ begin
  alter table sgc.auditoria
    add constraint auditoria_impersonado_por_fkey
    foreign key (impersonado_por) references sgc.usuarios(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ── 2) Helper: admin impersonador leído del JWT (bulletproof) ───────────────
-- Corre en CADA escritura vía fn_auditoria; cualquier claim malformado devuelve
-- NULL en vez de tumbar el INSERT.
create or replace function sgc.impersonado_por()
returns uuid
language plpgsql
stable
as $function$
declare
  v uuid;
begin
  select nullif(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb
             -> 'app_metadata' ->> 'impersonated_by', '')::uuid
    into v;
  return v;
exception when others then
  return null;
end;
$function$;
grant execute on function sgc.impersonado_por() to authenticated, service_role;

-- ── 3) fn_auditoria estampa impersonado_por en cada fila ────────────────────
create or replace function sgc.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_imp   uuid := sgc.impersonado_por();
  v_old   jsonb;
  v_new   jsonb;
  v_cambios jsonb := '{}'::jsonb;
  k text;
  v_skip constant text[] := array['updated_at','actualizado_en','search','tsv','fts','embedding','search_vector'];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, datos_despues)
      values (tg_table_name, coalesce(v_new->>'id',''), 'INSERT', v_actor, v_imp, v_new);
    return new;

  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      if k = any(v_skip) then continue; end if;
      if (v_new->k) is distinct from (v_old->k) then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k));
      end if;
    end loop;
    if v_cambios <> '{}'::jsonb then
      insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, cambios)
        values (tg_table_name, coalesce(v_new->>'id',''), 'UPDATE', v_actor, v_imp, v_cambios);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, datos_antes)
      values (tg_table_name, coalesce(v_old->>'id',''), 'DELETE', v_actor, v_imp, v_old);
    return old;
  end if;
  return null;
end;
$function$;
