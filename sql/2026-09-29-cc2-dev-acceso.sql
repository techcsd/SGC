-- ============================================================================
-- CC2 (PROMPT-74 F2) — Candado de acceso a DEV — 🔴 dev es público en internet.
-- Nota #85: «that "Dev - Entorno de desarrollo - usuarios de prueba" is not
-- working, and is not safe to have that exposed… a random person with the link
-- https://dev.sgcconstructorasd.com gonna join to the system.»
-- ----------------------------------------------------------------------------
-- ⚠️ ESTE ARCHIVO ES **SOLO DEV**. La lista blanca y el Custom Access Token hook
-- NO deben existir en prod. El guard de abajo ABORTA si config_entorno<>'dev'.
-- (apply-migration nunca lo envía a prod; este guard es la segunda red.)
--
-- Dos capas de defensa (la 2ª, Vercel Deployment Protection, la activa Xaviel):
--   (i)  Custom Access Token hook `sgc.dev_token_hook`: al emitir el token,
--        niega 403 a todo email que no esté en la lista blanca (dev_acceso),
--        no sea `qa_*` y no sea sintético `.local` (conductores de prueba).
--        Aunque alguien tenga una contraseña válida, no obtiene sesión.
--   (ii) `sgc.dev_acceso`: la lista blanca (solo admin la gestiona).
--
-- Configurar el hook (Management API, solo en sgc-dev) tras aplicar:
--   PATCH /v1/projects/<dev-ref>/config/auth
--     hook_custom_access_token_enabled = true
--     hook_custom_access_token_uri = 'pg-functions://postgres/sgc/dev_token_hook'
-- (scripts/aplicar-hook-dev.mjs lo hace; si la API no deja, pasos en ENTORNOS.md).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-29-cc2-dev-acceso.sql --env dev
-- Rollback: drop function sgc.dev_token_hook(jsonb); drop table sgc.dev_acceso;
--           + desactivar el hook en el dashboard/API.
-- ============================================================================

begin;

-- ── Guard: SOLO DEV ──────────────────────────────────────────────────────────
do $$
begin
  if coalesce((select valor from sgc.config_entorno where clave = 'entorno'), '') <> 'dev' then
    raise exception 'cc2-dev-acceso.sql es SOLO para DEV (config_entorno.entorno debe ser ''dev'').';
  end if;
end $$;

-- ── 1) Lista blanca de correos con acceso a dev ──────────────────────────────
create table if not exists sgc.dev_acceso (
  email      text primary key,   -- siempre en minúsculas (lo normalizan los RPC y el hook)
  nota       text,
  creado_por uuid references sgc.usuarios(id),
  creado_en  timestamptz not null default now()
);
comment on table sgc.dev_acceso is
  'CC2 (DEV ONLY) — correos reales autorizados a iniciar sesión en el entorno de '
  'desarrollo. Los `qa_*` y los sintéticos `.local` (conductores) se permiten por patrón '
  'en dev_token_hook; esta tabla es para personas reales (Tecnología).';

alter table sgc.dev_acceso enable row level security;
drop policy if exists dev_acceso_admin on sgc.dev_acceso;
create policy dev_acceso_admin on sgc.dev_acceso
  for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());

-- ── 2) Custom Access Token hook: niega el token si no está autorizado ────────
-- Recibe { user_id, claims:{ email, ... }, ... } y devuelve el event (permitir)
-- o { error:{ http_code, message } } (denegar). El hook corre como
-- supabase_auth_admin → necesita USAGE en el esquema + SELECT en las 2 tablas.
create or replace function sgc.dev_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_email text;
  v_ok    boolean;
begin
  -- Defensa: si por lo que sea corre fuera de dev, no interfiere.
  if coalesce((select valor from sgc.config_entorno where clave = 'entorno'), '') <> 'dev' then
    return event;
  end if;

  v_email := lower(coalesce(event #>> '{claims,email}', ''));

  -- Conductores/personal de prueba entran por cédula+PIN (email sintético): permitir.
  if v_email like '%.local' then
    return event;
  end if;
  -- Cuentas QA (qa_*): permitir por patrón (no hace falta listarlas una a una).
  if v_email like 'qa\_%' escape '\' then
    return event;
  end if;
  -- Lista blanca de personas reales.
  select exists (select 1 from sgc.dev_acceso d where d.email = v_email) into v_ok;
  if v_ok then
    return event;
  end if;

  -- No autorizado → deniega la emisión del token (no hay sesión).
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Este entorno es solo para el equipo de Tecnología.'
    )
  );
end;
$$;

-- Permisos para el hook (patrón oficial de Supabase auth hooks).
grant usage on schema sgc to supabase_auth_admin;
grant execute on function sgc.dev_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function sgc.dev_token_hook(jsonb) from authenticated, anon, public;
grant select on sgc.dev_acceso     to supabase_auth_admin;
grant select on sgc.config_entorno to supabase_auth_admin;

-- ── 3) RPCs para gestionar la lista blanca desde Admin › Usuarios de prueba ──
create or replace function sgc.dev_acceso_listar()
returns table (email text, nota text, creado_en timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select d.email::text, d.nota, d.creado_en
    from sgc.dev_acceso d
   where sgc.is_admin()
   order by d.creado_en;
$$;
grant execute on function sgc.dev_acceso_listar() to authenticated;

create or replace function sgc.dev_acceso_agregar(p_email text, p_nota text default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador.'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Correo requerido.'; end if;
  insert into sgc.dev_acceso (email, nota, creado_por)
  values (lower(trim(p_email)), nullif(trim(p_nota), ''), auth.uid())
  on conflict (email) do update set nota = excluded.nota;
end;
$$;
grant execute on function sgc.dev_acceso_agregar(text, text) to authenticated;

create or replace function sgc.dev_acceso_quitar(p_email text)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador.'; end if;
  delete from sgc.dev_acceso where email = lower(trim(p_email));
end;
$$;
grant execute on function sgc.dev_acceso_quitar(text) to authenticated;

-- ── 4) Seed: la cuenta real de Tecnología ────────────────────────────────────
insert into sgc.dev_acceso (email, nota)
values ('tecnologia@constructorasd.com', 'Tecnología — semilla CC2')
on conflict (email) do nothing;

commit;
