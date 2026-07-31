-- ============================================================================
-- AC4 — Módulo "Notas" (personales + compartidas, estilo ClickUp) (30/07/2026)
-- ----------------------------------------------------------------------------
-- Módulo GENERAL accesible por todos (como Mensajes). Notas personales; el dueño
-- comparte con usuarios registrados con permiso ver|editar. RLS estricta. v1 sin
-- tiempo real carácter-a-carácter: última edición gana (updated_at) con detección
-- de conflicto. Sin comentarios ni versiones en v1.
-- ============================================================================

set search_path = sgc, public;

create table if not exists sgc.notas (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references sgc.usuarios(id) on delete cascade,
  titulo     text not null default '',
  contenido  text not null default '',        -- texto con formato básico + checklists (markdown-ish)
  color      text,                            -- etiqueta de color opcional
  pinned     boolean not null default false,
  archivada  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notas_owner on sgc.notas(owner_id) where not archivada;

create table if not exists sgc.nota_compartidos (
  id         uuid primary key default gen_random_uuid(),
  nota_id    uuid not null references sgc.notas(id) on delete cascade,
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  permiso    text not null default 'ver' check (permiso in ('ver','editar')),
  created_at timestamptz not null default now(),
  unique (nota_id, usuario_id)
);
create index if not exists idx_nota_compartidos_usuario on sgc.nota_compartidos(usuario_id);

comment on table sgc.notas is 'AC4 — notas personales y compartidas (módulo general).';
comment on table sgc.nota_compartidos is 'AC4 — a quién y con qué permiso (ver|editar) se comparte una nota.';

-- ── Helper: ¿el usuario puede editar la nota? (owner o compartido editor) ───
create or replace function sgc.puede_editar_nota(p_nota_id uuid)
returns boolean language sql stable security definer
set search_path to 'sgc','pg_temp' as $$
  select exists (select 1 from sgc.notas n where n.id = p_nota_id and n.owner_id = auth.uid())
      or exists (select 1 from sgc.nota_compartidos s
                  where s.nota_id = p_nota_id and s.usuario_id = auth.uid() and s.permiso = 'editar');
$$;
grant execute on function sgc.puede_editar_nota(uuid) to authenticated, service_role;

-- ── RLS estricta ────────────────────────────────────────────────────────────
alter table sgc.notas            enable row level security;
alter table sgc.nota_compartidos enable row level security;

-- notas: leer = owner o compartido (cualquier permiso).
drop policy if exists notas_sel on sgc.notas;
create policy notas_sel on sgc.notas for select to authenticated
using (
  owner_id = auth.uid()
  or exists (select 1 from sgc.nota_compartidos s where s.nota_id = notas.id and s.usuario_id = auth.uid())
);
-- crear: solo como propio owner.
drop policy if exists notas_ins on sgc.notas;
create policy notas_ins on sgc.notas for insert to authenticated
with check (owner_id = auth.uid());
-- editar contenido: owner o compartido-editor.
drop policy if exists notas_upd on sgc.notas;
create policy notas_upd on sgc.notas for update to authenticated
using (
  owner_id = auth.uid()
  or exists (select 1 from sgc.nota_compartidos s where s.nota_id = notas.id and s.usuario_id = auth.uid() and s.permiso = 'editar')
)
with check (
  owner_id = auth.uid()
  or exists (select 1 from sgc.nota_compartidos s where s.nota_id = notas.id and s.usuario_id = auth.uid() and s.permiso = 'editar')
);
-- borrar: solo owner.
drop policy if exists notas_del on sgc.notas;
create policy notas_del on sgc.notas for delete to authenticated
using (owner_id = auth.uid());

-- nota_compartidos: ver = owner de la nota o el propio compartido.
drop policy if exists nota_comp_sel on sgc.nota_compartidos;
create policy nota_comp_sel on sgc.nota_compartidos for select to authenticated
using (
  usuario_id = auth.uid()
  or exists (select 1 from sgc.notas n where n.id = nota_compartidos.nota_id and n.owner_id = auth.uid())
);
-- gestionar compartidos (insert/update/delete): solo el owner de la nota.
drop policy if exists nota_comp_ins on sgc.nota_compartidos;
create policy nota_comp_ins on sgc.nota_compartidos for insert to authenticated
with check (exists (select 1 from sgc.notas n where n.id = nota_compartidos.nota_id and n.owner_id = auth.uid()));
drop policy if exists nota_comp_upd on sgc.nota_compartidos;
create policy nota_comp_upd on sgc.nota_compartidos for update to authenticated
using (exists (select 1 from sgc.notas n where n.id = nota_compartidos.nota_id and n.owner_id = auth.uid()))
with check (exists (select 1 from sgc.notas n where n.id = nota_compartidos.nota_id and n.owner_id = auth.uid()));
drop policy if exists nota_comp_del on sgc.nota_compartidos;
create policy nota_comp_del on sgc.nota_compartidos for delete to authenticated
using (exists (select 1 from sgc.notas n where n.id = nota_compartidos.nota_id and n.owner_id = auth.uid()));

-- ── RPC: guardar nota con detección de conflicto (última edición gana) ──────
create or replace function sgc.guardar_nota(
  p_id uuid, p_titulo text, p_contenido text,
  p_color text default null, p_pinned boolean default null, p_archivada boolean default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare v_uid uuid := auth.uid(); v_srv timestamptz; v_conflict boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  if not exists (select 1 from sgc.notas where id = p_id) then
    -- Crear (owner = quien llama).
    insert into sgc.notas (id, owner_id, titulo, contenido, color, pinned, archivada)
    values (p_id, v_uid, coalesce(p_titulo,''), coalesce(p_contenido,''),
            nullif(p_color,''), coalesce(p_pinned,false), coalesce(p_archivada,false));
    return jsonb_build_object('conflict', false,
      'nota', (select to_jsonb(n) from sgc.notas n where n.id = p_id));
  end if;

  if not sgc.puede_editar_nota(p_id) then raise exception 'No tienes permiso para editar esta nota'; end if;

  select updated_at into v_srv from sgc.notas where id = p_id;
  if p_expected_updated_at is not null and v_srv is not null and v_srv > p_expected_updated_at then
    v_conflict := true;   -- otro editó después; se avisa pero última edición gana
  end if;

  update sgc.notas set
    titulo    = coalesce(p_titulo, titulo),
    contenido = coalesce(p_contenido, contenido),
    color     = case when p_color is null then color else nullif(p_color,'') end,
    pinned    = coalesce(p_pinned, pinned),
    archivada = coalesce(p_archivada, archivada),
    updated_at = now()
  where id = p_id;

  return jsonb_build_object('conflict', v_conflict,
    'nota', (select to_jsonb(n) from sgc.notas n where n.id = p_id));
end;
$$;
grant execute on function sgc.guardar_nota(uuid, text, text, text, boolean, boolean, timestamptz) to authenticated, service_role;
