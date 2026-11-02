-- 2026-11-01-df2-formulario-ia-propuestas.sql
-- DF1-B..E (ronda DF) — lectores IA genéricos para formularios distintos a la
-- bitácora (conduce externo, y en el futuro checklist/requisición/factura).
-- Tabla GENÉRICA (una fila por "entendí esto" de cualquier tipo de formulario),
-- hermana de sgc.bitacora_ia_propuestas (DF1-A) pero sin atarse a un solo
-- formulario — evita crear una tabla por tipo. Aditivo.
--   node scripts/apply-migration.mjs sql/2026-11-01-df2-formulario-ia-propuestas.sql --env dev

begin;

create table if not exists sgc.formulario_ia_propuestas (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('conduce_externo', 'checklist_vehiculo', 'requisicion', 'factura_general', 'mantenimiento', 'ruta')),
  usuario_id      uuid not null references sgc.usuarios(id) on delete cascade,
  proyecto_id     uuid references sgc.proyectos(id) on delete set null,
  propuesta_json  jsonb not null,
  confianza_media numeric,
  estado          text not null default 'propuesta' check (estado in ('propuesta', 'aceptada', 'descartada')),
  -- Id de la entidad real ya creada (conduce_externo, solicitud_material, etc.)
  -- una vez que el usuario confirma. Sin FK porque la tabla destino varía por tipo.
  entidad_id      uuid,
  creada_en       timestamptz not null default now(),
  resuelta_en     timestamptz
);
comment on table sgc.formulario_ia_propuestas is
  'DF1-B..E — propuesta de IA (foto/voz) para formularios no-bitácora, antes de que el usuario la confirme. Métrica de aceptación por tipo, no la entidad real en sí.';

create index if not exists formulario_ia_propuestas_usuario_idx on sgc.formulario_ia_propuestas (usuario_id, creada_en desc);
create index if not exists formulario_ia_propuestas_tipo_idx on sgc.formulario_ia_propuestas (tipo, creada_en desc);

alter table sgc.formulario_ia_propuestas enable row level security;

drop policy if exists "formulario_ia_propuestas: select" on sgc.formulario_ia_propuestas;
create policy "formulario_ia_propuestas: select" on sgc.formulario_ia_propuestas
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or sgc.is_admin()
    or sgc.es_tecnologia()
  );

-- Solo el dueño marca su propia propuesta como aceptada/descartada (el INSERT lo
-- hace la edge function con service role, que no pasa por RLS).
drop policy if exists "formulario_ia_propuestas: update propia" on sgc.formulario_ia_propuestas;
create policy "formulario_ia_propuestas: update propia" on sgc.formulario_ia_propuestas
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

grant select, update on sgc.formulario_ia_propuestas to authenticated;
grant all on sgc.formulario_ia_propuestas to service_role;

commit;
