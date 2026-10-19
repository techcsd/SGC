-- ============================================================================
-- CS2 (4A) — Grupos anidados tipo Notion para Dev notes / Notas. Regla 19: leí
-- la RLS viva de sgc.notas (notas_sel/notas_upd ya usan
-- sgc.puede_ver_nota/puede_editar_nota — no las toco) antes de añadir
-- `grupo_id`. CRUD de `nota_grupos` es directo (insert/update/delete + RLS),
-- igual que `sgc.notas` ya hace hoy desde notas.service.ts — sin RPCs nuevas
-- para lo que la RLS ya resuelve solo.
-- ============================================================================

begin;

create table if not exists sgc.nota_grupos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  parent_id uuid references sgc.nota_grupos(id) on delete restrict,
  nombre text not null,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_nota_grupos_usuario on sgc.nota_grupos(usuario_id);
create index if not exists idx_nota_grupos_parent on sgc.nota_grupos(parent_id);
comment on table sgc.nota_grupos is 'CS2 — carpetas anidadas (hasta 4 niveles) para organizar sgc.notas, por usuario dueño.';

alter table sgc.notas add column if not exists grupo_id uuid references sgc.nota_grupos(id) on delete set null;
create index if not exists idx_notas_grupo on sgc.notas(grupo_id);

alter table sgc.nota_grupos enable row level security;

drop policy if exists nota_grupos_sel on sgc.nota_grupos;
create policy nota_grupos_sel on sgc.nota_grupos for select using (usuario_id = auth.uid());
drop policy if exists nota_grupos_ins on sgc.nota_grupos;
create policy nota_grupos_ins on sgc.nota_grupos for insert with check (usuario_id = auth.uid());
drop policy if exists nota_grupos_upd on sgc.nota_grupos;
create policy nota_grupos_upd on sgc.nota_grupos for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
drop policy if exists nota_grupos_del on sgc.nota_grupos;
create policy nota_grupos_del on sgc.nota_grupos for delete using (usuario_id = auth.uid());
grant select, insert, update, delete on sgc.nota_grupos to authenticated;

-- ── Profundidad máxima 4 + sin ciclos ────────────────────────────────────────
create or replace function sgc.tg_nota_grupos_validar()
 returns trigger
 language plpgsql
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_profundidad int := 1;
  v_cursor uuid := new.parent_id;
  v_guard int := 0;
  v_max_desc int := 0;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Un grupo no puede ser su propio padre.' using errcode = '22023';
    end if;
    while v_cursor is not null and v_guard < 20 loop
      if v_cursor = new.id then
        raise exception 'No se puede mover un grupo dentro de sí mismo o de un descendiente suyo.' using errcode = '22023';
      end if;
      v_profundidad := v_profundidad + 1;
      select parent_id into v_cursor from sgc.nota_grupos where id = v_cursor;
      v_guard := v_guard + 1;
    end loop;
  end if;
  if v_profundidad > 4 then
    raise exception 'Los grupos admiten hasta 4 niveles de profundidad.' using errcode = '22023';
  end if;
  -- Al mover (UPDATE) un grupo con subárbol, que ninguno de sus descendientes quede a >4.
  if tg_op = 'UPDATE' then
    with recursive desc_depth(id, d) as (
      select id, 1 from sgc.nota_grupos where parent_id = new.id
      union all
      select g.id, dd.d + 1 from sgc.nota_grupos g join desc_depth dd on g.parent_id = dd.id
    )
    select coalesce(max(d), 0) into v_max_desc from desc_depth;
    if v_profundidad + v_max_desc > 4 then
      raise exception 'Mover este grupo dejaría a un subgrupo con más de 4 niveles.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists tg_nota_grupos_validar on sgc.nota_grupos;
create trigger tg_nota_grupos_validar
  before insert or update of parent_id on sgc.nota_grupos
  for each row execute function sgc.tg_nota_grupos_validar();

-- ── Borrar un grupo: sus subgrupos y notas SUBEN al nivel de arriba (no al raíz,
-- salvo que el borrado ya fuera de nivel 0) ──────────────────────────────────
create or replace function sgc.tg_nota_grupos_reparentar_antes_borrar()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  update sgc.nota_grupos set parent_id = old.parent_id where parent_id = old.id;
  update sgc.notas set grupo_id = old.parent_id where grupo_id = old.id;
  return old;
end;
$function$;

drop trigger if exists tg_nota_grupos_antes_borrar on sgc.nota_grupos;
create trigger tg_nota_grupos_antes_borrar
  before delete on sgc.nota_grupos
  for each row execute function sgc.tg_nota_grupos_reparentar_antes_borrar();

-- ── Auditoría (crear/renombrar/mover/eliminar) ──────────────────────────────
create or replace function sgc.tg_nota_grupos_auditoria()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into sgc.audit_log (actor_id, action, metadata)
    values (new.usuario_id, 'nota_grupo_creado', jsonb_build_object('id', new.id, 'nombre', new.nombre, 'parent_id', new.parent_id));
  elsif tg_op = 'UPDATE' then
    if new.nombre is distinct from old.nombre then
      insert into sgc.audit_log (actor_id, action, metadata)
      values (new.usuario_id, 'nota_grupo_renombrado', jsonb_build_object('id', new.id, 'de', old.nombre, 'a', new.nombre));
    end if;
    if new.parent_id is distinct from old.parent_id then
      insert into sgc.audit_log (actor_id, action, metadata)
      values (new.usuario_id, 'nota_grupo_movido', jsonb_build_object('id', new.id, 'de_parent', old.parent_id, 'a_parent', new.parent_id));
    end if;
  elsif tg_op = 'DELETE' then
    insert into sgc.audit_log (actor_id, action, metadata)
    values (old.usuario_id, 'nota_grupo_eliminado', jsonb_build_object('id', old.id, 'nombre', old.nombre));
  end if;
  return null;
end;
$function$;

drop trigger if exists tg_nota_grupos_auditoria on sgc.nota_grupos;
create trigger tg_nota_grupos_auditoria
  after insert or update or delete on sgc.nota_grupos
  for each row execute function sgc.tg_nota_grupos_auditoria();

-- ── Integridad: notas.grupo_id solo puede apuntar a un grupo DEL MISMO dueño
-- (notas_upd/notas_ins ya exigen permiso sobre la nota, pero no sabían nada de
-- grupos — sin esto, alguien podría apuntar su nota al grupo de otro usuario). ──
create or replace function sgc.tg_notas_grupo_mismo_dueno()
 returns trigger
 language plpgsql
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if new.grupo_id is not null and not exists (
    select 1 from sgc.nota_grupos g where g.id = new.grupo_id and g.usuario_id = new.owner_id
  ) then
    raise exception 'Ese grupo no es tuyo.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists tg_notas_grupo_mismo_dueno on sgc.notas;
create trigger tg_notas_grupo_mismo_dueno
  before insert or update of grupo_id on sgc.notas
  for each row execute function sgc.tg_notas_grupo_mismo_dueno();

commit;
