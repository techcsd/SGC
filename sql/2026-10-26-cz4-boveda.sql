-- ============================================================================
-- CZ3/CZ9 (PROMPT-120, ronda CZ, 26/10/2026) — Vault ("Bóveda") de
-- Administración. Nota 3 de Xaviel: credenciales de webs/cuentas, llaves API y
-- tokens, códigos 2FA y de recuperación, notas seguras y archivos — "porque
-- ahorita lo guardo en mi NordPass personal pero si en un futuro no estoy eso
-- va a ser un problema". Respuesta de Xaviel: solo rol Administrador lo abre.
--
-- Nombres `boveda_*` a propósito (DZ-09/§3 de CONTEXTO-59): NO es el mismo
-- `vault` de infraestructura de Supabase (sql/2026-07-02-vault-resend-key.sql,
-- guarda la llave de Resend/crons) — ese es de la plataforma y no se toca.
--
-- Seguridad ante todo (regla explícita de esta pieza): ninguna fila en claro,
-- cifrado AES-256-GCM SOLO en la edge `boveda` (única que ve la llave maestra),
-- columnas cifradas SIN select para `authenticated` (privilegio por columna),
-- auditoría solo-insertar, y el gate es un GUARD DE ROL estricto (is_admin),
-- nunca el módulo `admin` (que gatea /admin/* por módulo — ver
-- docs/SUBMODULOS-SENSIBLES.md §2: si algún día otro rol recibiera ese módulo,
-- vería TODO /admin/* de un golpe; el Vault no puede heredar ese riesgo).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-10-26-cz4-boveda.sql --env dev  →  --env prod
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) Predicado único ─────────────────────────────────────────────────────
create or replace function sgc.puede_ver_vault()
returns boolean
language sql stable security definer set search_path = sgc, public
as $$ select sgc.is_admin(); $$;
grant execute on function sgc.puede_ver_vault() to authenticated, service_role;

-- ── (2) boveda_entradas — la entrada en sí ──────────────────────────────────
create table if not exists sgc.boveda_entradas (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null check (tipo in ('cuenta', 'api', '2fa', 'nota', 'archivo')),
  nombre            text not null,
  sitio_url         text,
  usuario_texto     text,
  -- Cifrado AES-256-GCM (ciphertext+tag concatenado por WebCrypto) + IV de 96
  -- bits — NUNCA en claro. Para tipo='2fa' es la semilla TOTP; para 'nota' es
  -- el cuerpo; para 'cuenta'/'api' es la contraseña/llave. 'archivo' no usa
  -- estas columnas (el archivo cifrado vive en el bucket, ver abajo).
  valor_cifrado     bytea,
  valor_iv          bytea,
  -- tipo='archivo': puntero al bucket privado (el archivo YA está cifrado
  -- antes de subir — el path no es secreto, es inútil sin pasar por la edge).
  archivo_path      text,
  archivo_nombre    text,
  archivo_mime      text,
  clave_version     int not null default 1,
  etiquetas         text[] not null default '{}',
  rotar_cada_dias   int,
  ultima_rotacion   date,
  notas             text,
  creado_por        uuid references sgc.usuarios(id),
  es_prueba         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_boveda_entradas_tipo on sgc.boveda_entradas (tipo);

alter table sgc.boveda_entradas enable row level security;
drop policy if exists boveda_entradas_sel on sgc.boveda_entradas;
create policy boveda_entradas_sel on sgc.boveda_entradas
  for select to authenticated using (sgc.puede_ver_vault());
-- Sin política de escritura para `authenticated`: el ÚNICO camino de escritura
-- es la edge `boveda` con el service role (cifra antes de insertar/actualizar).
-- Metadata (nombre/tipo/sitio/etiquetas/rotación) sí se puede listar sin pasar
-- por la edge (no es secreta, como cualquier gestor de contraseñas); el VALOR
-- cifrado NUNCA sale hacia `authenticated`.
--
-- OJO (gotcha real, encontrado con el smoke de esta pieza): un `GRANT SELECT`
-- de tabla completa seguido de un `REVOKE SELECT (columna)` NO restringe nada
-- — el grant de tabla sigue cubriendo TODAS las columnas; Postgres solo puede
-- "quitar" una columna de un privilegio que se otorgó A ESE MISMO GRANO
-- (columna). Por eso aquí NUNCA se da `grant select` de tabla completa a
-- `authenticated`: se listan explícitamente las columnas no-secretas.
-- (REVOKE defensivo por si una corrida anterior de esta migración ya hizo el
-- grant de tabla completa — reentrante.)
revoke select on sgc.boveda_entradas from authenticated;
grant select (
  id, tipo, nombre, sitio_url, usuario_texto, archivo_path, archivo_nombre, archivo_mime,
  clave_version, etiquetas, rotar_cada_dias, ultima_rotacion, notas, creado_por, es_prueba,
  created_at, updated_at
) on sgc.boveda_entradas to authenticated;
grant select, insert, update, delete on sgc.boveda_entradas to service_role;

-- ── (3) boveda_sesiones — reautenticación vigente (DZ-10) ───────────────────
-- Sin grants a `authenticated` en absoluto: solo la edge (service role) la
-- crea/lee. El cliente consulta su vigencia por la RPC angosta de abajo.
create table if not exists sgc.boveda_sesiones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id),
  plataforma  text not null default 'web' check (plataforma in ('web', 'app')),
  creado_at   timestamptz not null default now(),
  expira_at   timestamptz not null
);
create index if not exists idx_boveda_sesiones_usuario on sgc.boveda_sesiones (usuario_id, expira_at);
alter table sgc.boveda_sesiones enable row level security;
-- Sin políticas para `authenticated` (ninguna fila visible/escribible desde el
-- cliente) — solo `service_role` la toca. OJO (gotcha real de esta pieza):
-- "service_role bypassa RLS" NO significa que tenga privilegios de tabla por
-- defecto — BYPASSRLS y los GRANT son mecanismos independientes; sin este
-- GRANT explícito, la edge fallaba en silencio con "permission denied for
-- table boveda_sesiones" (detectado con el smoke vivo de esta pieza).
grant select, insert, update, delete on sgc.boveda_sesiones to service_role;

create or replace function sgc.boveda_sesion_vigente()
returns timestamptz
language sql stable security definer set search_path = sgc, public
as $$
  select max(expira_at) from sgc.boveda_sesiones
  where usuario_id = auth.uid() and expira_at > now();
$$;
grant execute on function sgc.boveda_sesion_vigente() to authenticated;

-- ── (4) boveda_intentos — bloqueo tras 3 fallos de reautenticación (DZ-10) ──
create table if not exists sgc.boveda_intentos (
  usuario_id       uuid primary key references sgc.usuarios(id),
  fallos           int not null default 0,
  bloqueado_hasta  timestamptz,
  updated_at       timestamptz not null default now()
);
alter table sgc.boveda_intentos enable row level security;
-- Sin políticas para `authenticated`: solo la edge (service role) — mismo
-- gotcha que boveda_sesiones: BYPASSRLS no exime del GRANT.
grant select, insert, update, delete on sgc.boveda_intentos to service_role;

-- ── (5) boveda_accesos — auditoría SOLO-INSERTAR (DZ-11) ───────────────────
create table if not exists sgc.boveda_accesos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id),
  entrada_id  uuid references sgc.boveda_entradas(id) on delete set null,
  accion      text not null check (accion in (
                'abrir_sesion', 'fallo_reautenticacion', 'bloqueo',
                'revelar', 'copiar', 'crear', 'editar', 'eliminar',
                'mostrar_semilla', 'codigo_2fa', 'importar'
              )),
  detalle     text,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_boveda_accesos_entrada on sgc.boveda_accesos (entrada_id, created_at desc);
create index if not exists idx_boveda_accesos_usuario on sgc.boveda_accesos (usuario_id, created_at desc);

alter table sgc.boveda_accesos enable row level security;
drop policy if exists boveda_accesos_sel on sgc.boveda_accesos;
create policy boveda_accesos_sel on sgc.boveda_accesos
  for select to authenticated using (sgc.is_admin());
grant select on sgc.boveda_accesos to authenticated;
grant insert on sgc.boveda_accesos to service_role;

-- Append-only de VERDAD: el trigger bloquea UPDATE/DELETE para CUALQUIER rol,
-- incluido service_role — nadie edita ni borra un registro de auditoría ya
-- escrito, ni siquiera la propia edge.
create or replace function sgc.tg_boveda_accesos_bloquear_mod()
returns trigger language plpgsql as $$
begin
  raise exception 'boveda_accesos es de solo-insertar (append-only); no se edita ni se borra.';
end;
$$;
drop trigger if exists trg_boveda_accesos_bloquear on sgc.boveda_accesos;
create trigger trg_boveda_accesos_bloquear
  before update or delete on sgc.boveda_accesos
  for each row execute function sgc.tg_boveda_accesos_bloquear_mod();

-- ── (6) Bucket privado para archivos (DZ-14) ─────────────────────────────────
-- El archivo se cifra EN LA EDGE antes de subir; sin políticas de storage para
-- `authenticated` (descarga solo vía edge, que usa service role). Límite 1 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('boveda-archivos', 'boveda-archivos', false, 1048576, null)
on conflict (id) do nothing;

commit;
