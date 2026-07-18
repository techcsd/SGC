-- ============================================================================
-- Actualización 1 — P5: acceso de conductores por cédula + PIN
-- ----------------------------------------------------------------------------
-- Los conductores no tienen correo: acceden con cédula + PIN (6 dígitos). El
-- admin/flota genera el acceso desde el perfil del conductor (edge function
-- `conductor-crear-acceso`, service role): crea un usuario auth con email
-- sintético determinista (c-{cedula}@conductores.constructorasd.local), le pone
-- el rol Chofer/Transportista y enlaza conductores.usuario_id. El login va por
-- la edge `conductor-login` (mapea cédula→email→signInWithPassword) con bloqueo
-- temporal por intentos. Esta tabla respalda ese bloqueo (solo service_role).
-- ============================================================================

set search_path = sgc, public;

create table if not exists sgc.conductor_login_intentos (
  cedula          text primary key,
  intentos        int not null default 0,
  bloqueado_hasta timestamptz,
  ultimo_intento  timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Solo el service_role (edge functions) toca esta tabla. RLS on sin policies =
-- ningún usuario autenticado puede leer/escribir; service_role la bypassa.
alter table sgc.conductor_login_intentos enable row level security;
grant all on sgc.conductor_login_intentos to service_role;
