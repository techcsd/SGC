-- 2026-11-01-df1-bitacora-ia.sql
-- DF1-A (ronda DF) — "Modo rápido" de bitácora: fotos + nota de voz → la IA
-- propone los 12 pasos del parte, el usuario revisa y confirma con el MISMO
-- submit/RPC de siempre (crear_entrada_bitacora). Esta tabla es la métrica de
-- aceptación de esas propuestas — no reemplaza ni duplica la bitácora real.
-- Aditivo.
--   node scripts/apply-migration.mjs sql/2026-11-01-df1-bitacora-ia.sql --env dev

begin;

create table if not exists sgc.bitacora_ia_propuestas (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references sgc.usuarios(id) on delete cascade,
  proyecto_id     uuid not null references sgc.proyectos(id) on delete cascade,
  fecha           date not null,
  propuesta_json  jsonb not null,
  confianza_media numeric,
  estado          text not null default 'propuesta' check (estado in ('propuesta', 'aceptada', 'descartada')),
  bitacora_id     uuid references sgc.bitacoras(id) on delete set null,
  creada_en       timestamptz not null default now(),
  resuelta_en     timestamptz
);
comment on table sgc.bitacora_ia_propuestas is
  'DF1-A — propuesta de parte diario generada por IA (fotos+voz) antes de que el usuario la confirme. Métrica de aceptación, no la bitácora en sí.';

create index if not exists bitacora_ia_propuestas_usuario_idx on sgc.bitacora_ia_propuestas (usuario_id, creada_en desc);
create index if not exists bitacora_ia_propuestas_proyecto_idx on sgc.bitacora_ia_propuestas (proyecto_id, creada_en desc);

alter table sgc.bitacora_ia_propuestas enable row level security;

drop policy if exists "bitacora_ia_propuestas: select" on sgc.bitacora_ia_propuestas;
create policy "bitacora_ia_propuestas: select" on sgc.bitacora_ia_propuestas
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or sgc.is_admin()
    or sgc.es_tecnologia()
    or sgc.puede_ver_bitacora_de(proyecto_id)
  );

-- Solo el dueño marca su propia propuesta como aceptada/descartada (el INSERT lo
-- hace la edge function con service role, que no pasa por RLS).
drop policy if exists "bitacora_ia_propuestas: update propia" on sgc.bitacora_ia_propuestas;
create policy "bitacora_ia_propuestas: update propia" on sgc.bitacora_ia_propuestas
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

grant select, update on sgc.bitacora_ia_propuestas to authenticated;
grant all on sgc.bitacora_ia_propuestas to service_role;

commit;
