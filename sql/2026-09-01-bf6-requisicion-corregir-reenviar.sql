-- ════════════════════════════════════════════════════════════════════════════
-- BF6 — La requisición se CORRIGE después de creada (caso real REQ-000015,
--   rechazada por "ubicacion erronea"). Amplía BB10:
--   (1) la OBRA (proyecto_id) es editable por el autor mientras esté pendiente;
--   (2) flujo RECHAZADA → CORREGIR → REENVIAR: una rechazada no es callejón —
--       el autor ve el motivo, corrige y REENVÍA la MISMA REQ (vuelve a
--       'pendiente' a la misma bandeja, v2, con el diff en el historial) en vez
--       de crear otra y dejar basura (decisión Xaviel);
--   (3) `motivo_rechazo` deja de PISAR `notas` — columna propia, visible al autor.
-- Aditivo/retrocompatible. La aprobación (mismo aprobador/bandeja) no cambia.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── 1) motivo_rechazo propio (antes se clobbereaba `notas`) ──────────────────
alter table sgc.solicitudes_material
  add column if not exists motivo_rechazo text;
comment on column sgc.solicitudes_material.motivo_rechazo is
  'BF6 — motivo del rechazo, visible para el autor para corregir y reenviar. Antes se pisaba `notas` (destructivo).';

-- ── 2) rechazar: escribe motivo_rechazo, conserva `notas` del autor ──────────
create or replace function sgc.rechazar_solicitud_material(p_solicitud_id uuid, p_notas text default null)
returns void
language plpgsql
as $$
declare
  v_sol sgc.solicitudes_material%rowtype;
begin
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;

  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esta solicitud ya fue procesada.'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para rechazar solicitudes de materiales.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes rechazar tu propia solicitud.';
  end if;

  update sgc.solicitudes_material
     set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
         motivo_rechazo = coalesce(nullif(trim(p_notas), ''), motivo_rechazo),  -- BF6: campo propio
         updated_at = now()
   where id = p_solicitud_id;
end;
$$;

-- ── 3) editar_requisicion — obra editable + corregir-rechazada-y-reenviar ─────
-- Se DROPea la firma 4-arg de BB10 para no dejar dos funciones (ambigüedad en
-- PostgREST). La nueva 5-arg con p_proyecto_id default cubre las llamadas viejas.
drop function if exists sgc.editar_requisicion(uuid, text, text, jsonb);

create or replace function sgc.editar_requisicion(
  p_solicitud_id uuid,
  p_urgencia     text  default null,
  p_notas        text  default null,
  p_items        jsonb default null,
  p_proyecto_id  uuid  default null   -- BF6 — obra editable
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_sol       sgc.solicitudes_material%rowtype;
  v_antes     jsonb;
  v_despues   jsonb;
  v_reenviada boolean := false;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;

  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;
  if not found then raise exception 'Requisición no encontrada.' using errcode = 'BB404'; end if;

  -- Solo el autor (o admin).
  if not (v_sol.solicitante_id = auth.uid() or sgc.is_admin()) then
    raise exception 'Solo el autor puede editar su requisición.' using errcode = '42501';
  end if;
  -- BF6 — editable mientras PENDIENTE o RECHAZADA (para corregir y reenviar).
  if v_sol.estado not in ('pendiente', 'rechazada') then
    raise exception 'Solo se puede editar mientras está pendiente o rechazada. Ya fue procesada — pide el ajuste en el despacho o cancélala y rehazla.' using errcode = 'BB409';
  end if;

  -- Snapshot ANTES (cabecera + obra + estado + renglones).
  v_antes := jsonb_build_object(
    'urgencia', v_sol.urgencia, 'notas', v_sol.notas,
    'proyecto_id', v_sol.proyecto_id, 'estado', v_sol.estado,
    'motivo_rechazo', v_sol.motivo_rechazo,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'articulo_id', i.articulo_id, 'descripcion', i.descripcion,
                'cantidad', i.cantidad, 'unidad', i.unidad, 'talla', i.talla) order by i.id)
              from sgc.solicitud_material_items i where i.solicitud_id = p_solicitud_id), '[]'::jsonb));

  -- ¿Es una corrección de rechazada? → vuelve a pendiente (reenvío a la bandeja).
  v_reenviada := (v_sol.estado = 'rechazada');

  update sgc.solicitudes_material
     set urgencia    = coalesce(nullif(trim(p_urgencia), ''), urgencia),
         notas       = coalesce(p_notas, notas),
         proyecto_id = coalesce(p_proyecto_id, proyecto_id),   -- BF6 obra editable
         estado      = case when v_reenviada then 'pendiente' else estado end,
         -- al reenviar, limpia la marca de rechazo viva (queda en el historial).
         motivo_rechazo = case when v_reenviada then null else motivo_rechazo end,
         atendido_por   = case when v_reenviada then null else atendido_por end,
         atendido_en    = case when v_reenviada then null else atendido_en end,
         version    = version + 1,
         updated_at = now()
   where id = p_solicitud_id;

  -- Renglones (si vienen).
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    delete from sgc.solicitud_material_items where solicitud_id = p_solicitud_id;
    insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, talla)
    select p_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion',
           (i->>'cantidad')::numeric, i->>'unidad', nullif(i->>'talla', '')
      from jsonb_array_elements(p_items) as i;
  end if;

  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id;
  v_despues := jsonb_build_object(
    'urgencia', v_sol.urgencia, 'notas', v_sol.notas,
    'proyecto_id', v_sol.proyecto_id, 'estado', v_sol.estado,
    'motivo_rechazo', v_sol.motivo_rechazo,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'articulo_id', i.articulo_id, 'descripcion', i.descripcion,
                'cantidad', i.cantidad, 'unidad', i.unidad, 'talla', i.talla) order by i.id)
              from sgc.solicitud_material_items i where i.solicitud_id = p_solicitud_id), '[]'::jsonb));

  insert into sgc.solicitud_material_ediciones (solicitud_id, editado_por, cambios)
  values (p_solicitud_id, auth.uid(),
          jsonb_build_object('antes', v_antes, 'despues', v_despues, 'reenviada', v_reenviada));

  return jsonb_build_object('ok', true, 'version', v_sol.version, 'reenviada', v_reenviada);
end;
$$;
grant execute on function sgc.editar_requisicion(uuid, text, text, jsonb, uuid) to authenticated, service_role;

commit;
