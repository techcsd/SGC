-- 2026-10-08-ck12-apoyo-transporte.sql
-- CK11/CK12/CK13 — "Apoyo de transporte": evoluciona solicitudes_movimiento (NO tabla
-- nueva) para unificar movimientos internos, retiro de material y bote. Añade tipo_apoyo,
-- dia, descripcion, fotos y estados ampliados. Aditivo. RPCs en ck12b (envoltorios de
-- los viejos). El retiro de material dañado (bg4/cuarentena) NO se rompe.
--   node scripts/apply-migration.mjs sql/2026-10-08-ck12-apoyo-transporte.sql --env dev
--
-- Dry-run de conteos de estado (planificada→asignada, en_curso→en_proceso):
--   dev: 0 a remapear · prod: 1 (planificada→asignada). Verificado 08-oct.

begin;

-- ── 1) Columnas nuevas (aditivas) ────────────────────────────────────────────────
alter table sgc.solicitudes_movimiento
  add column if not exists tipo_apoyo text not null default 'movimiento_interno',
  add column if not exists dia date,
  add column if not exists descripcion text,
  add column if not exists retiro_material_id uuid references sgc.retiros_material(id);

-- tipo_carga y prioridad YA tienen default ('materiales'/'media') → dejan de ser
-- obligatorios en las pantallas (CK11) sin tocar el esquema.

-- ── 2) Backfill de las existentes ────────────────────────────────────────────────
update sgc.solicitudes_movimiento
   set dia = coalesce(dia, fecha_requerimiento, fecha_solicitud),
       descripcion = coalesce(descripcion, que_se_mueve)
 where dia is null or descripcion is null;

-- ── 3) Estados ampliados: DROP del check viejo ANTES del remap (si no, el UPDATE a
--       'asignada' viola el check aún activo — lo descubrió el 1 row 'planificada' de prod). ─
alter table sgc.solicitudes_movimiento drop constraint if exists solicitudes_movimiento_estado_check;
update sgc.solicitudes_movimiento set estado = 'asignada'   where estado = 'planificada';
update sgc.solicitudes_movimiento set estado = 'en_proceso' where estado = 'en_curso';
alter table sgc.solicitudes_movimiento add constraint solicitudes_movimiento_estado_check
  check (estado = any (array['pendiente','asignada','en_proceso','por_confirmar','completada','cancelada']));

alter table sgc.solicitudes_movimiento drop constraint if exists solicitudes_movimiento_tipo_apoyo_check;
alter table sgc.solicitudes_movimiento add constraint solicitudes_movimiento_tipo_apoyo_check
  check (tipo_apoyo = any (array['movimiento_interno','retiro_material','bote']));

-- ── 4) Fotos de lo que se va a mover (CK12) ──────────────────────────────────────
create table if not exists sgc.apoyo_transporte_fotos (
  id          uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references sgc.solicitudes_movimiento(id) on delete cascade,
  path        text not null,
  tomada_por  uuid references sgc.usuarios(id),
  client_id   uuid unique,
  created_at  timestamptz not null default now()
);
create index if not exists idx_apoyo_fotos_solicitud on sgc.apoyo_transporte_fotos(solicitud_id);
alter table sgc.apoyo_transporte_fotos enable row level security;

-- ── 5) Historial de estados (CK13) ───────────────────────────────────────────────
create table if not exists sgc.apoyo_transporte_eventos (
  id          uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references sgc.solicitudes_movimiento(id) on delete cascade,
  de          text,
  a           text,
  por         uuid references sgc.usuarios(id),
  nota        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_apoyo_eventos_solicitud on sgc.apoyo_transporte_eventos(solicitud_id);
alter table sgc.apoyo_transporte_eventos enable row level security;

-- ── 6) ¿Quién puede ver un apoyo? (solicitante, referente de transporte, obra) ────
create or replace function sgc.puede_ver_apoyo(p_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.solicitudes_movimiento s
    where s.id = p_id
      and (
        s.solicitante_id = auth.uid()
        or s.created_by = auth.uid()
        or sgc.es_referente_movimiento()
        or (s.proyecto_id is not null and sgc.puede_ver_proyecto(s.proyecto_id))
      )
  );
$function$;
grant execute on function sgc.puede_ver_apoyo(uuid) to authenticated, service_role;

-- RLS de fotos/eventos: ver si puede ver la solicitud; escribir solo por RPC DEFINER.
drop policy if exists apoyo_fotos_sel on sgc.apoyo_transporte_fotos;
create policy apoyo_fotos_sel on sgc.apoyo_transporte_fotos
  for select to authenticated using (sgc.puede_ver_apoyo(solicitud_id));
drop policy if exists apoyo_eventos_sel on sgc.apoyo_transporte_eventos;
create policy apoyo_eventos_sel on sgc.apoyo_transporte_eventos
  for select to authenticated using (sgc.puede_ver_apoyo(solicitud_id));

grant select on sgc.apoyo_transporte_fotos  to authenticated, service_role;
grant select on sgc.apoyo_transporte_eventos to authenticated, service_role;

-- ── 7) Bucket privado para las fotos (carpeta = <solicitud_id>/...) ───────────────
insert into storage.buckets (id, name, public)
values ('apoyo-transporte', 'apoyo-transporte', false)
on conflict (id) do nothing;

drop policy if exists "apoyo-transporte lee" on storage.objects;
create policy "apoyo-transporte lee" on storage.objects
  for select to authenticated
  using (bucket_id = 'apoyo-transporte'
         and sgc.puede_ver_apoyo(nullif((storage.foldername(name))[1], '')::uuid));

drop policy if exists "apoyo-transporte sube" on storage.objects;
create policy "apoyo-transporte sube" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'apoyo-transporte'
              and sgc.puede_ver_apoyo(nullif((storage.foldername(name))[1], '')::uuid));

commit;
