-- ============================================================================
-- PROMPT-25 (AW) — Ronda 21/08/2026.
-- AW9: "APIs y consumo" — inventario de las APIs/servicios que usa el proyecto
--      (Google Maps/Places/Roads, Supabase, FCM/push, Vercel, Resend…) con su
--      propósito, dónde se usan y un COSTO ESTIMADO/mes manual (mientras se
--      habilita la extracción por Billing API — ⏸ checklist para Xaviel).
-- Gateado por es_tecnologia() (admin | tecnología | gerencia | dirección).
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-21-aw9-apis-consumo.sql
-- ============================================================================
set search_path = sgc, public;

create table if not exists sgc.api_servicios (
  id                 serial primary key,
  nombre             text not null,
  proveedor          text,
  proposito          text,
  donde_se_usa       text,
  costo_estimado_mes numeric,
  moneda             text not null default 'USD',
  panel_url          text,
  notas              text,
  activo             boolean not null default true,
  orden              int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (nombre)
);
comment on table sgc.api_servicios is
  'AW9 — inventario de APIs/servicios del proyecto y su costo estimado/mes (manual mientras no se habilite la Billing API). Gestión gateada por es_tecnologia().';

alter table sgc.api_servicios enable row level security;
drop policy if exists api_serv_select on sgc.api_servicios;
drop policy if exists api_serv_write  on sgc.api_servicios;
create policy api_serv_select on sgc.api_servicios for select to authenticated using (sgc.es_tecnologia());
create policy api_serv_write  on sgc.api_servicios for all to authenticated
  using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());
grant select, insert, update, delete on sgc.api_servicios to authenticated;
grant all on sgc.api_servicios to service_role;
grant usage, select on sequence sgc.api_servicios_id_seq to authenticated;

-- Toca updated_at en cada cambio.
create or replace function sgc.api_servicios_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_api_servicios_touch on sgc.api_servicios;
create trigger trg_api_servicios_touch before update on sgc.api_servicios
  for each row execute function sgc.api_servicios_touch();

-- Seed del inventario conocido (idempotente por nombre; no pisa costos editados).
insert into sgc.api_servicios (nombre, proveedor, proposito, donde_se_usa, moneda, panel_url, orden)
values
  ('Google Maps JavaScript API', 'Google Cloud', 'Mapas interactivos (seguimiento, recorrido diario, ubicación de obras).', 'Web: seguimiento, recorrido-diario, mapas de obra.', 'USD', 'https://console.cloud.google.com/google/maps-apis', 1),
  ('Google Places API', 'Google Cloud', 'Búsqueda/autocompletado de lugares y direcciones.', 'Edge function places-search; selección de ubicación de obras.', 'USD', 'https://console.cloud.google.com/google/maps-apis', 2),
  ('Google Roads API', 'Google Cloud', 'Map-matching (ajustar el trayecto a las calles) del tracking.', 'Edge function snap-to-roads (AV7).', 'USD', 'https://console.cloud.google.com/google/maps-apis', 3),
  ('Supabase', 'Supabase', 'Base de datos Postgres, Auth, Storage, Edge Functions, Realtime.', 'Todo el backend (schema sgc, RLS, buckets, edge functions).', 'USD', 'https://supabase.com/dashboard/project/jeeqhgccqefbqilntcpu', 4),
  ('Firebase Cloud Messaging (FCM)', 'Google Firebase', 'Notificaciones push a la app móvil.', 'Edge function send-push; avisos de flota/conduces/mensajería.', 'USD', 'https://console.firebase.google.com', 5),
  ('Vercel', 'Vercel', 'Hosting y despliegue de la web (build + CDN + dominios).', 'Deploy de la app web (sgcconstructorasd.com).', 'USD', 'https://vercel.com/dashboard', 6),
  ('Resend', 'Resend', 'Correos transaccionales (alertas, invitaciones, soporte).', 'Edge functions de notificación por correo; monitoreo de infraestructura.', 'USD', 'https://resend.com/overview', 7)
on conflict (nombre) do update
  set proveedor = excluded.proveedor,
      proposito = excluded.proposito,
      donde_se_usa = excluded.donde_se_usa,
      panel_url = coalesce(sgc.api_servicios.panel_url, excluded.panel_url),
      orden = excluded.orden;
