-- ============================================================================
-- Actualización 6 — X1: documentos de conductores y vehículos
-- ----------------------------------------------------------------------------
-- Tabla genérica sgc.documentos + bucket privado `flota-documentos`.
-- NOTA (el código manda): conductores.id y vehiculos.id son UUID, no bigint —
-- así que entidad_id es UUID (el brief decía bigint).
-- X2 (GPS) NO necesita migración: vehiculo_entregas ya tiene gps_lat/gps_lng y
-- el RPC crear_entrega_vehiculo YA los persiste desde p_gps. X3/X4 tampoco
-- (checklist_vehiculo_fotos.slot ya guarda item_N; salidas_inventario.foto_path
-- ya existe). Todo aditivo/retrocompatible/idempotente.
-- ============================================================================

set search_path = sgc, public;

create table if not exists sgc.documentos (
  id          uuid primary key default gen_random_uuid(),
  entidad     text not null check (entidad in ('conductor', 'vehiculo')),
  entidad_id  uuid not null,
  tipo        text not null,          -- conductor: cedula|licencia|otro · vehiculo: seguro|matricula|otro
  nombre      text,
  path        text not null,
  subido_por  uuid references sgc.usuarios(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_documentos_entidad on sgc.documentos(entidad, entidad_id);

alter table sgc.documentos enable row level security;

drop policy if exists documentos_sel on sgc.documentos;
create policy documentos_sel on sgc.documentos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));

drop policy if exists documentos_ins on sgc.documentos;
create policy documentos_ins on sgc.documentos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));

drop policy if exists documentos_del on sgc.documentos;
create policy documentos_del on sgc.documentos for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));

grant select, insert, delete on sgc.documentos to authenticated;
grant all on sgc.documentos to service_role;

-- ── Bucket privado para los documentos (imágenes y PDF) ─────────────────────
insert into storage.buckets (id, name, public)
values ('flota-documentos', 'flota-documentos', false)
on conflict (id) do nothing;

drop policy if exists flota_docs_sel on storage.objects;
create policy flota_docs_sel on storage.objects for select to authenticated
  using (bucket_id = 'flota-documentos' and (sgc.is_admin() or sgc.tiene_modulo('flota')));

drop policy if exists flota_docs_ins on storage.objects;
create policy flota_docs_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'flota-documentos' and (sgc.is_admin() or sgc.tiene_modulo('flota')));

drop policy if exists flota_docs_del on storage.objects;
create policy flota_docs_del on storage.objects for delete to authenticated
  using (bucket_id = 'flota-documentos' and (sgc.is_admin() or sgc.tiene_modulo('flota')));
