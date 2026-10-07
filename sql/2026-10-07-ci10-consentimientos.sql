-- 2026-10-07-ci10-consentimientos.sql
-- CI10 — Consentimiento explícito para IA de terceros y ubicación en 2.º plano.
-- Aditivo. Las edges de IA verifican el consentimiento en el servidor (403).
--   node scripts/apply-migration.mjs sql/2026-10-07-ci10-consentimientos.sql --env dev

-- ── Tabla ──────────────────────────────────────────────────────────────────────
create table if not exists sgc.consentimientos (
  usuario_id     uuid not null references sgc.usuarios(id) on delete cascade,
  tipo           text not null check (tipo in ('ia','ubicacion_fondo')),
  otorgado       boolean not null default false,
  plataforma     text,
  actualizado_at timestamptz not null default now(),
  primary key (usuario_id, tipo)
);
comment on table sgc.consentimientos is
  'CI10 — consentimiento explícito por usuario: ia (Anthropic/Groq/OpenAI) y ubicacion_fondo. Revocable.';

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table sgc.consentimientos enable row level security;

drop policy if exists consentimientos_sel on sgc.consentimientos;
create policy consentimientos_sel on sgc.consentimientos
  for select to authenticated
  using ( usuario_id = auth.uid() or sgc.is_admin() or sgc.es_tecnologia() );

drop policy if exists consentimientos_write on sgc.consentimientos;
create policy consentimientos_write on sgc.consentimientos
  for all to authenticated
  using ( usuario_id = auth.uid() )
  with check ( usuario_id = auth.uid() );

grant select, insert, update on sgc.consentimientos to authenticated;
grant all on sgc.consentimientos to service_role;

-- ── Helper servidor (lo usan las edges vía service role) ─────────────────────────
create or replace function sgc.tiene_consentimiento(p_usuario uuid, p_tipo text)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1 from sgc.consentimientos
    where usuario_id = p_usuario and tipo = p_tipo and otorgado
  );
$$;
grant execute on function sgc.tiene_consentimiento(uuid, text) to authenticated, service_role;

-- ── RPC: leer mi consentimiento ──────────────────────────────────────────────────
create or replace function sgc.mi_consentimiento(p_tipo text)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.tiene_consentimiento(auth.uid(), p_tipo);
$$;
grant execute on function sgc.mi_consentimiento(text) to authenticated;

-- ── RPC: otorgar / revocar ───────────────────────────────────────────────────────
create or replace function sgc.set_consentimiento(
  p_tipo text,
  p_otorgado boolean,
  p_plataforma text default null
)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_tipo not in ('ia','ubicacion_fondo') then
    raise exception 'tipo de consentimiento inválido: %', p_tipo;
  end if;
  insert into sgc.consentimientos (usuario_id, tipo, otorgado, plataforma, actualizado_at)
  values (v_uid, p_tipo, coalesce(p_otorgado, false), nullif(trim(p_plataforma), ''), now())
  on conflict (usuario_id, tipo) do update
    set otorgado = excluded.otorgado,
        plataforma = coalesce(excluded.plataforma, sgc.consentimientos.plataforma),
        actualizado_at = now();
end;
$$;
grant execute on function sgc.set_consentimiento(text, boolean, text) to authenticated;
