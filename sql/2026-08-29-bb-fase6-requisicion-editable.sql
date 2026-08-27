-- ════════════════════════════════════════════════════════════════════════════
-- BB10 (PROMPT-19 FASE 6) — El AUTOR puede EDITAR su requisición mientras esté
-- PENDIENTE (renglones, cantidades, urgencia, notas), con historial de cambios.
-- Tras aprobar no se edita (decisión Xaviel): los ajustes van por el despacho
-- (BA6/AT7) o se cancela con motivo y se rehace. Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = sgc, public;

-- ── 1) Historial de ediciones de la requisición ──────────────────────────────
create table if not exists sgc.solicitud_material_ediciones (
  id           uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references sgc.solicitudes_material(id) on delete cascade,
  editado_por  uuid references sgc.usuarios(id),
  editado_at   timestamptz not null default now(),
  cambios      jsonb not null default '{}'::jsonb   -- {antes:{...}, despues:{...}}
);
comment on table sgc.solicitud_material_ediciones is
  'BB10 — bitácora de ediciones de una requisición por su autor (qué cambió y cuándo).';
create index if not exists ix_sol_mat_ediciones on sgc.solicitud_material_ediciones (solicitud_id, editado_at desc);

alter table sgc.solicitud_material_ediciones enable row level security;
do $$ begin
  create policy sol_mat_ediciones_sel on sgc.solicitud_material_ediciones
    for select using (
      exists (select 1 from sgc.solicitudes_material s
               where s.id = solicitud_id
                 and (s.solicitante_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('inventario')))
    );
exception when duplicate_object then null; end $$;
grant select, insert on sgc.solicitud_material_ediciones to authenticated, service_role;

-- ── 2) Contador de versión (para que el aprobador sepa si cambió tras enviarse) ─
alter table sgc.solicitudes_material
  add column if not exists version int not null default 1;
comment on column sgc.solicitudes_material.version is
  'BB10 — sube en cada edición del autor; el aprobador ve qué versión está aprobando.';

-- ── 3) RPC: editar la requisición (solo autor, solo pendiente) ────────────────
create or replace function sgc.editar_requisicion(
  p_solicitud_id uuid,
  p_urgencia     text default null,
  p_notas        text default null,
  p_items        jsonb default null
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_sol     sgc.solicitudes_material%rowtype;
  v_antes   jsonb;
  v_despues jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;

  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;
  if not found then raise exception 'Requisición no encontrada.' using errcode = 'BB404'; end if;

  -- Solo el autor (o admin) edita; solo mientras esté PENDIENTE.
  if not (v_sol.solicitante_id = auth.uid() or sgc.is_admin()) then
    raise exception 'Solo el autor puede editar su requisición.' using errcode = '42501';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'Solo se puede editar mientras está pendiente. Ya fue procesada — pide el ajuste en el despacho o cancélala y rehazla.' using errcode = 'BB409';
  end if;

  -- Snapshot ANTES (cabecera + renglones) para el historial.
  v_antes := jsonb_build_object(
    'urgencia', v_sol.urgencia, 'notas', v_sol.notas,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'articulo_id', i.articulo_id, 'descripcion', i.descripcion,
                'cantidad', i.cantidad, 'unidad', i.unidad, 'talla', i.talla) order by i.id)
              from sgc.solicitud_material_items i where i.solicitud_id = p_solicitud_id), '[]'::jsonb));

  -- Actualiza cabecera (solo los campos provistos).
  update sgc.solicitudes_material
     set urgencia = coalesce(nullif(trim(p_urgencia), ''), urgencia),
         notas    = coalesce(p_notas, notas),
         version  = version + 1,
         updated_at = now()
   where id = p_solicitud_id;

  -- Si vienen items, reemplaza los renglones (la RPC es SECURITY DEFINER → puede borrar).
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    delete from sgc.solicitud_material_items where solicitud_id = p_solicitud_id;
    insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, talla)
    select p_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion',
           (i->>'cantidad')::numeric, i->>'unidad', nullif(i->>'talla', '')
      from jsonb_array_elements(p_items) as i;
  end if;

  -- Snapshot DESPUÉS.
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id;
  v_despues := jsonb_build_object(
    'urgencia', v_sol.urgencia, 'notas', v_sol.notas,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'articulo_id', i.articulo_id, 'descripcion', i.descripcion,
                'cantidad', i.cantidad, 'unidad', i.unidad, 'talla', i.talla) order by i.id)
              from sgc.solicitud_material_items i where i.solicitud_id = p_solicitud_id), '[]'::jsonb));

  insert into sgc.solicitud_material_ediciones (solicitud_id, editado_por, cambios)
  values (p_solicitud_id, auth.uid(), jsonb_build_object('antes', v_antes, 'despues', v_despues));

  return jsonb_build_object('ok', true, 'version', v_sol.version);
end;
$$;
grant execute on function sgc.editar_requisicion(uuid, text, text, jsonb) to authenticated, service_role;

-- ── 4) Historial de ediciones de una requisición (para la UI) ─────────────────
create or replace function sgc.requisicion_ediciones(p_solicitud_id uuid)
returns table(editado_por uuid, editado_por_nombre text, editado_at timestamptz, cambios jsonb)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select e.editado_por, u.nombre, e.editado_at, e.cambios
    from sgc.solicitud_material_ediciones e
    left join sgc.usuarios u on u.id = e.editado_por
   where e.solicitud_id = p_solicitud_id
     and exists (select 1 from sgc.solicitudes_material s
                  where s.id = p_solicitud_id
                    and (s.solicitante_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('inventario')))
   order by e.editado_at desc;
$$;
grant execute on function sgc.requisicion_ediciones(uuid) to authenticated, service_role;
