-- =============================================================================
-- PROMPT-32+ (BJ2) — Lista blanca teléfono → usuario para Compa por WhatsApp.
-- El puente n8n (Evolution) recibe un mensaje de WhatsApp, resuelve el teléfono
-- del remitente a un usuario SGC por esta tabla, y llama a la edge `assistant` en
-- modo WhatsApp para que Compa responda RESPETANDO EL ROL de esa persona. Un número
-- que no esté en la lista NO recibe respuesta de datos.
-- Ronda 04/09/2026. Aditivo, idempotente.
--
-- Matching robusto: se compara por los ÚLTIMOS 10 dígitos (RD guarda 10 sin código
-- de país; WhatsApp trae '1'+10). Así '8299663040' ≡ '18299663040'.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-04-bj2-whatsapp-compa-whitelist.sql
-- =============================================================================
begin;
set local search_path = sgc, public;

create table if not exists sgc.whatsapp_autorizados (
  telefono    text primary key,                 -- dígitos (como venga); se compara por right(,10)
  usuario_id  uuid not null references sgc.usuarios(id) on delete cascade,
  activo      boolean not null default true,
  nota        text,
  creado_por  uuid references sgc.usuarios(id),
  creado_en   timestamptz not null default now()
);
create index if not exists idx_wa_autorizados_tel10 on sgc.whatsapp_autorizados (right(regexp_replace(telefono,'\D','','g'),10));
comment on table sgc.whatsapp_autorizados is
  'BJ2 — lista blanca teléfono→usuario para Compa por WhatsApp. El puente resuelve el remitente a un usuario SGC y Compa responde con el rol de esa persona.';

alter table sgc.whatsapp_autorizados enable row level security;
drop policy if exists wa_autorizados_admin on sgc.whatsapp_autorizados;
create policy wa_autorizados_admin on sgc.whatsapp_autorizados for all to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia()) with check (sgc.is_admin() or sgc.es_tecnologia());
grant select, insert, update, delete on sgc.whatsapp_autorizados to authenticated;
grant all on sgc.whatsapp_autorizados to service_role;

-- ── Resolver (lo llama la edge con service_role): teléfono → usuario + email ──
create or replace function sgc.whatsapp_resolver(p_telefono text)
returns table (usuario_id uuid, email text, nombre text)
language sql stable security definer
set search_path to 'sgc', 'public'
as $$
  select w.usuario_id, u.email, u.nombre
  from sgc.whatsapp_autorizados w
  join sgc.usuarios u on u.id = w.usuario_id
  where w.activo
    and right(regexp_replace(w.telefono,'\D','','g'),10) = right(regexp_replace(coalesce(p_telefono,''),'\D','','g'),10)
    and coalesce(u.activo,true) = true
  limit 1;
$$;
grant execute on function sgc.whatsapp_resolver(text) to service_role;
revoke execute on function sgc.whatsapp_resolver(text) from authenticated, public;

-- ── Seed: usuarios con teléfono en ficha y rol relevante (ingeniería/gestión) ──
-- Los choferes NO se auto-añaden (su rol los limitaría igual, pero la lista es una
-- autorización deliberada). Eduardo NG NO tiene teléfono en ficha → agregar aparte.
insert into sgc.whatsapp_autorizados (telefono, usuario_id, nota)
select u.telefono, u.id, 'seed BJ2 (teléfono en ficha)'
from sgc.usuarios u
join sgc.usuarios_roles ur on ur.usuario_id = u.id
join sgc.roles r on r.id = ur.rol_id
where u.telefono is not null and coalesce(u.es_prueba,false)=false
  and r.codigo in ('ingeniero_campo','gerente_proyectos','ingeniero_oficina','jefe_flota','logistica','direccion','gerencia','tecnologia','admin')
on conflict (telefono) do nothing;

commit;
