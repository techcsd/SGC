-- 2026-10-20-ct4-requisicion-duplicada.sql — CT4/CT7 (fila 264/267)
-- Enmanuel (Emmanuel) Peralta mandó la misma requisición dos veces porque la
-- primera "no aparecía" (el teléfono la guarda local antes de que el servidor
-- confirme — ver CT7). `crear_solicitud_app` ya es idempotente por `p_id`, pero
-- cada reintento desde la app genera un `p_id` NUEVO, así que esa idempotencia
-- no detecta el duplicado real (mismo solicitante+obra+renglones, id distinto).
-- Regla 19: definiciones leídas en vivo de prod antes de reemplazar (ver reporte).
-- Migración aditiva: agrega `p_forzar` (default false, no rompe llamadores
-- existentes) y cambia el tipo de retorno de `uuid` a `jsonb` — los únicos
-- llamadores reales son `solicitudes-material.service.ts` (web, actualizado en
-- este commit) y el ejecutor genérico de Compa/Claude (`herramientas.ts`, que
-- solo mira `error`, nunca `data` — no se rompe). El contrato nuevo para la app
-- (csd-app, PROMPT-109) queda documentado en PARIDAD.md.
begin;

drop function if exists sgc.crear_solicitud_material(uuid, uuid, text, text, jsonb, date);
create or replace function sgc.crear_solicitud_material(
  p_proyecto_id uuid, p_solicitante_id uuid, p_urgencia text, p_notas text, p_items jsonb,
  p_fecha_necesidad date default null, p_forzar boolean default false
) returns jsonb
language plpgsql
as $function$
declare
  v_solicitud_id uuid;
  v_folio bigint;
  v_fingerprint text;
  v_dup record;
begin
  if not sgc.requisicion_permitida(p_proyecto_id, p_solicitante_id) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;

  select string_agg(coalesce(i->>'articulo_id','') || '|' || coalesce(i->>'descripcion','') || '|' || coalesce(i->>'cantidad',''), ';'
           order by coalesce(i->>'articulo_id',''), coalesce(i->>'descripcion',''))
    into v_fingerprint
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;

  if not coalesce(p_forzar, false) then
    select s.id, s.folio into v_dup
      from sgc.solicitudes_material s
     where s.proyecto_id = p_proyecto_id and s.solicitante_id = p_solicitante_id
       and s.estado <> 'rechazada' -- una rechazada que se corrige y reenvía no es "duplicada por error"
       and s.created_at >= now() - interval '24 hours'
       and coalesce((select string_agg(coalesce(it.articulo_id::text,'') || '|' || coalesce(it.descripcion,'') || '|' || coalesce(it.cantidad::text,''), ';'
                              order by coalesce(it.articulo_id::text,''), coalesce(it.descripcion,''))
                       from sgc.solicitud_material_items it where it.solicitud_id = s.id), '') = coalesce(v_fingerprint, '')
     order by s.created_at asc
     limit 1;

    if found then
      return jsonb_build_object('id', v_dup.id, 'duplicada_de', v_dup.id, 'folio', 'REQ-' || lpad(v_dup.folio::text, 6, '0'));
    end if;
  end if;

  insert into sgc.solicitudes_material (proyecto_id, solicitante_id, urgencia, notas, fecha_necesidad)
  values (p_proyecto_id, p_solicitante_id, p_urgencia, p_notas, p_fecha_necesidad)
  returning id, folio into v_solicitud_id, v_folio;
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, talla, unidad_capturada, factor_aplicado)
  select v_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion',
         (i->>'cantidad')::numeric, i->>'unidad', nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;

  return jsonb_build_object('id', v_solicitud_id, 'duplicada_de', null, 'folio', 'REQ-' || lpad(v_folio::text, 6, '0'));
end;
$function$;
grant execute on function sgc.crear_solicitud_material(uuid, uuid, text, text, jsonb, date, boolean) to authenticated;

drop function if exists sgc.crear_solicitud_app(uuid, uuid, text, text, jsonb, date);
create or replace function sgc.crear_solicitud_app(
  p_id uuid, p_proyecto_id uuid, p_urgencia text, p_notas text, p_items jsonb,
  p_fecha_necesidad date default null, p_forzar boolean default false
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_folio bigint;
  v_fingerprint text;
  v_dup record;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (
    sgc.tiene_modulo('compras')
    or sgc.tiene_modulo('obra')
    or sgc.puede_operar_submodulo('obra.plan_dia')
  ) then
    raise exception 'Tu usuario no tiene el módulo Solicitudes ni acceso a Obra';
  end if;
  if exists (select 1 from sgc.solicitudes_material where id = p_id) then
    return jsonb_build_object('id', p_id, 'duplicada_de', null, 'folio',
      (select 'REQ-' || lpad(folio::text, 6, '0') from sgc.solicitudes_material where id = p_id));
  end if;
  if not sgc.requisicion_permitida(p_proyecto_id, auth.uid()) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;

  select string_agg(coalesce(i->>'articulo_id','') || '|' || coalesce(i->>'descripcion','') || '|' || coalesce(i->>'cantidad',''), ';'
           order by coalesce(i->>'articulo_id',''), coalesce(i->>'descripcion',''))
    into v_fingerprint
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;

  if not coalesce(p_forzar, false) then
    select s.id, s.folio into v_dup
      from sgc.solicitudes_material s
     where s.proyecto_id = p_proyecto_id and s.solicitante_id = auth.uid()
       and s.estado <> 'rechazada'
       and s.created_at >= now() - interval '24 hours'
       and coalesce((select string_agg(coalesce(it.articulo_id::text,'') || '|' || coalesce(it.descripcion,'') || '|' || coalesce(it.cantidad::text,''), ';'
                              order by coalesce(it.articulo_id::text,''), coalesce(it.descripcion,''))
                       from sgc.solicitud_material_items it where it.solicitud_id = s.id), '') = coalesce(v_fingerprint, '')
     order by s.created_at asc
     limit 1;

    if found then
      return jsonb_build_object('id', v_dup.id, 'duplicada_de', v_dup.id, 'folio', 'REQ-' || lpad(v_dup.folio::text, 6, '0'));
    end if;
  end if;

  insert into sgc.solicitudes_material (id, proyecto_id, solicitante_id, estado, urgencia, notas, fecha_necesidad)
  values (p_id, p_proyecto_id, auth.uid(), 'pendiente', coalesce(p_urgencia, 'normal'), p_notas, p_fecha_necesidad)
  returning folio into v_folio;
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, unidad_capturada, factor_aplicado)
  select p_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion', (i->>'cantidad')::numeric, i->>'unidad',
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;

  return jsonb_build_object('id', p_id, 'duplicada_de', null, 'folio', 'REQ-' || lpad(v_folio::text, 6, '0'));
end;
$function$;
grant execute on function sgc.crear_solicitud_app(uuid, uuid, text, text, jsonb, date, boolean) to authenticated;

commit;
