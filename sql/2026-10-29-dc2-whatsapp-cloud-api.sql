-- =============================================================================
-- DC2 (rebautizada de DA2 por colisión de letra de ronda — ver HANDOFF) —
-- WhatsApp Cloud API (Meta oficial): bitácora de mensajes + memoria de
-- conversación por teléfono. Sustituye el puente n8n/Evolution (no oficial,
-- bloqueado por Meta) por el webhook `whatsapp-webhook` (DC3), que sigue
-- llamando a `assistant` en modo WhatsApp (BJ2, sin cambios de ese contrato).
--
-- Aditivo, idempotente. Ronda DC (29/10/2026).
-- Apply: node scripts/apply-migration.mjs sql/2026-10-29-dc2-whatsapp-cloud-api.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) Bitácora de mensajes (entrada y salida) ──────────────────────────────
create table if not exists sgc.whatsapp_mensajes (
  id              uuid primary key default gen_random_uuid(),
  wa_message_id   text unique,                      -- id de Meta (dedupe de inbound; también el de cada chunk de salida)
  direccion       text not null check (direccion in ('entrada','salida')),
  telefono        text not null,                     -- normalizado (últimos 10 dígitos, igual que whatsapp_autorizados)
  usuario_id      uuid references sgc.usuarios(id) on delete set null,
  tipo            text not null default 'texto' check (tipo in ('texto','audio','imagen','documento','otro','estado')),
  texto           text,                               -- texto entrante/transcripción, o la respuesta saliente
  estado          text not null check (estado in ('recibido','procesando','respondido','no_autorizado','ignorado','error','entregado','leido','fallido')),
  error           text,
  duracion_ms     integer,
  conversacion_id uuid references sgc.assistant_conversaciones(id) on delete set null,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_whatsapp_mensajes_tel_fecha on sgc.whatsapp_mensajes (telefono, creado_en desc);
create index if not exists idx_whatsapp_mensajes_estado_fecha on sgc.whatsapp_mensajes (estado, creado_en desc);
comment on table sgc.whatsapp_mensajes is
  'DC2 — una fila por mensaje de WhatsApp (entrada/salida) vía Meta Cloud API. Retención 90 días (sgc.purgar_whatsapp_mensajes_viejos, Ley 172-13).';

alter table sgc.whatsapp_mensajes enable row level security;
drop policy if exists whatsapp_mensajes_lectura on sgc.whatsapp_mensajes;
create policy whatsapp_mensajes_lectura on sgc.whatsapp_mensajes for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.whatsapp_mensajes to authenticated;
grant all on sgc.whatsapp_mensajes to service_role;

-- ── 2) Memoria de conversación por teléfono (qué conversación de Compa sigue
--      vigente, y el control del aviso de primer uso / no-autorizado) ───────
create table if not exists sgc.whatsapp_conversaciones (
  telefono                      text primary key,     -- normalizado, igual criterio que whatsapp_autorizados/mensajes
  usuario_id                    uuid references sgc.usuarios(id) on delete set null,
  conversacion_id               uuid references sgc.assistant_conversaciones(id) on delete set null,
  ultimo_mensaje_en             timestamptz,
  aviso_primer_uso_en           timestamptz,
  ultimo_aviso_no_autorizado_en timestamptz,
  creado_en                     timestamptz not null default now()
);
comment on table sgc.whatsapp_conversaciones is
  'DC2 — estado por teléfono para el puente de WhatsApp: conversación vigente de Compa (reusada si < 30 min), aviso de primer uso (privacidad) y throttle del aviso a no-autorizados (máx 1/24h).';

alter table sgc.whatsapp_conversaciones enable row level security;
drop policy if exists whatsapp_conversaciones_lectura on sgc.whatsapp_conversaciones;
create policy whatsapp_conversaciones_lectura on sgc.whatsapp_conversaciones for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.whatsapp_conversaciones to authenticated;
grant all on sgc.whatsapp_conversaciones to service_role;

-- ── 3) whatsapp_autorizados (BJ2) — columnas aditivas para la pantalla de
--      Tecnología (último uso) y auditoría (cuándo se tocó la fila) ────────
alter table sgc.whatsapp_autorizados add column if not exists actualizado_en timestamptz;
alter table sgc.whatsapp_autorizados add column if not exists ultimo_uso_en timestamptz;

-- ── 4) Retención 90 días (Ley 172-13) — mismo patrón que purgar_posiciones_viejas ──
create or replace function sgc.purgar_whatsapp_mensajes_viejos()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_n int;
begin
  delete from sgc.whatsapp_mensajes where creado_en < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.purgar_whatsapp_mensajes_viejos() to service_role;

do $$ begin perform cron.unschedule('sgc-purgar-whatsapp-mensajes'); exception when others then null; end $$;
select cron.schedule('sgc-purgar-whatsapp-mensajes', '0 8 * * *', $cron$ select sgc.purgar_whatsapp_mensajes_viejos(); $cron$);

commit;
