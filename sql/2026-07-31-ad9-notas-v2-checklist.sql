-- ============================================================================
-- AD9 — Ronda 31/07/2026 (PROMPT-15 FASE 6) — Notas v2
-- Checklists "de verdad" (estructurados) que pueden vincularse a una Tarea del
-- módulo Tareas: al completarse la tarea, el ítem se marca solo (trigger) y hay
-- una función de reconciliación al cargar la nota. El cuerpo formateado sigue en
-- `notas.contenido` (ahora HTML del editor). Reutiliza los helpers de permisos de
-- notas (AD2). Todo aditivo.
-- ============================================================================

create table if not exists sgc.nota_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  nota_id    uuid not null references sgc.notas(id) on delete cascade,
  orden      int  not null default 0,
  texto      text not null default '',
  done       boolean not null default false,
  done_auto  boolean not null default false,     -- true si lo marcó un objeto vinculado
  done_at    timestamptz,
  ref_tipo   text check (ref_tipo in ('tarea')), -- extensible (cronograma, etc.)
  ref_id     uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nota_checklist_items_nota_idx on sgc.nota_checklist_items(nota_id);
create index if not exists nota_checklist_items_ref_idx  on sgc.nota_checklist_items(ref_tipo, ref_id);

alter table sgc.nota_checklist_items enable row level security;

drop policy if exists nci_sel on sgc.nota_checklist_items;
drop policy if exists nci_ins on sgc.nota_checklist_items;
drop policy if exists nci_upd on sgc.nota_checklist_items;
drop policy if exists nci_del on sgc.nota_checklist_items;

create policy nci_sel on sgc.nota_checklist_items for select to authenticated
  using (sgc.puede_ver_nota(nota_id, auth.uid()));
create policy nci_ins on sgc.nota_checklist_items for insert to authenticated
  with check (sgc.puede_editar_nota(nota_id, auth.uid()));
create policy nci_upd on sgc.nota_checklist_items for update to authenticated
  using (sgc.puede_editar_nota(nota_id, auth.uid()))
  with check (sgc.puede_editar_nota(nota_id, auth.uid()));
create policy nci_del on sgc.nota_checklist_items for delete to authenticated
  using (sgc.puede_editar_nota(nota_id, auth.uid()));

grant select, insert, update, delete on sgc.nota_checklist_items to authenticated;

-- ── Auto-check: cuando una tarea se completa/reabre, sincroniza sus ítems ────
create or replace function sgc.trg_tarea_autocheck_nota()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if NEW.estado = 'completada' and OLD.estado is distinct from 'completada' then
    update sgc.nota_checklist_items
       set done = true, done_auto = true, done_at = now(), updated_at = now()
     where ref_tipo = 'tarea' and ref_id = NEW.id and done = false;
  elsif NEW.estado is distinct from 'completada' and OLD.estado = 'completada' then
    -- Al reabrir, solo desmarca lo que se había marcado automáticamente.
    update sgc.nota_checklist_items
       set done = false, done_at = null, updated_at = now()
     where ref_tipo = 'tarea' and ref_id = NEW.id and done_auto = true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tarea_autocheck_nota on sgc.tareas;
create trigger tarea_autocheck_nota
  after update of estado on sgc.tareas
  for each row execute function sgc.trg_tarea_autocheck_nota();

-- ── Reconciliación al cargar la nota (red de seguridad) ──────────────────────
-- Alinea los ítems vinculados con el estado ACTUAL de su tarea. No toca ítems
-- sin vínculo (esos los marca el usuario a mano).
create or replace function sgc.sync_checklist_nota(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_ver_nota(p_nota_id, auth.uid()) then
    raise exception 'Sin acceso a la nota';
  end if;
  update sgc.nota_checklist_items ci
     set done = (t.estado = 'completada'),
         done_auto = true,
         done_at = case when t.estado = 'completada' then coalesce(ci.done_at, now()) else null end,
         updated_at = now()
    from sgc.tareas t
   where ci.nota_id = p_nota_id
     and ci.ref_tipo = 'tarea' and ci.ref_id = t.id
     and ci.done <> (t.estado = 'completada');
end;
$$;

grant execute on function sgc.sync_checklist_nota(uuid) to authenticated;
