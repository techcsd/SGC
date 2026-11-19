-- DT3 (PROMPT-150, hotfix Raykler) — cambiar el artículo de un renglón de requisición ya aprobado.
-- Causa: aprobar_requisicion es de un solo tiro (articulo_despacho_id solo se escribe si era null) y no
-- existía ninguna vía para corregir un renglón LIBRE después (REQ-000178: 2 renglones LIBRE, despachado 0,
-- todo a compra). ADITIVO: función nueva; no toca aprobar_requisicion ni datos existentes.
-- Aplicar PRIMERO en dev (--env dev), probar, luego prod con OK de Xaviel.

create or replace function sgc.reemplazar_articulo_renglon_requisicion(
  p_item_id uuid, p_articulo_id uuid, p_motivo text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_item   sgc.solicitud_material_items%rowtype;
  v_sol    sgc.solicitudes_material%rowtype;
  v_art    sgc.articulos%rowtype;
  v_ant    uuid;
  v_desp   numeric;
  v_compra int := 0;
  v_compra_bloq int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.es_flota_elevado()) then
    raise exception 'No tienes permiso para cambiar artículos de una requisición.' using errcode = '42501';
  end if;

  select * into v_item from sgc.solicitud_material_items where id = p_item_id for update;
  if not found then raise exception 'Renglón no encontrado.'; end if;

  select * into v_sol from sgc.solicitudes_material where id = v_item.solicitud_id for update;
  if v_sol.estado in ('cerrada', 'cancelada', 'rechazada') then
    raise exception 'La requisición está % y ya no admite cambios.', v_sol.estado using errcode = 'P0001';
  end if;
  if coalesce(v_item.estado, 'pendiente') = 'cancelada' then
    raise exception 'El renglón está cancelado.' using errcode = 'P0001';
  end if;

  select * into v_art from sgc.articulos where id = p_articulo_id;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  if coalesce(v_art.activo, true) = false then raise exception 'El artículo está inactivo.'; end if;

  v_desp := sgc.requisicion_item_despachado(p_item_id);
  if v_desp > 0 then
    raise exception 'El renglón ya tiene % despachado; no se puede cambiar su artículo.', v_desp using errcode = 'P0001';
  end if;

  v_ant := coalesce(v_item.articulo_despacho_id, v_item.articulo_id);
  if v_ant is not distinct from p_articulo_id then
    return jsonb_build_object('cambiado', false, 'motivo', 'mismo_articulo');
  end if;

  update sgc.solicitud_material_items set articulo_despacho_id = p_articulo_id where id = p_item_id;

  -- Faltante ya mandado a compra: se corrige el MISMO renglón de compra (no se duplica) mientras la
  -- solicitud de compra siga sin avanzar. Si ya avanzó, se deja intacta y se avisa.
  update sgc.solicitud_compra_items sci
     set articulo_id = p_articulo_id,
         descripcion = '[' || v_art.codigo || '] ' || v_art.nombre
    from sgc.solicitudes_compra sc
   where sc.id = sci.solicitud_id
     and sc.origen_requisicion_id = v_item.solicitud_id
     and sci.origen_item_id = p_item_id
     and sc.estado in ('pendiente', 'borrador');
  get diagnostics v_compra = row_count;

  select count(*) into v_compra_bloq
    from sgc.solicitud_compra_items sci
    join sgc.solicitudes_compra sc on sc.id = sci.solicitud_id
   where sc.origen_requisicion_id = v_item.solicitud_id
     and sci.origen_item_id = p_item_id
     and sc.estado not in ('pendiente', 'borrador');

  insert into sgc.auditoria(tabla, registro_id, accion, actor_id, cambios, datos_antes, datos_despues)
    values ('solicitud_material_items', p_item_id::text, 'UPDATE', auth.uid(),
            jsonb_build_object('op', 'reemplazar_articulo_renglon', 'motivo', p_motivo, 'requisicion_id', v_item.solicitud_id),
            jsonb_build_object('articulo_id', v_ant),
            jsonb_build_object('articulo_id', p_articulo_id));

  return jsonb_build_object('cambiado', true, 'renglones_compra_actualizados', v_compra,
                            'compra_ya_avanzo', v_compra_bloq > 0);
end;
$function$;

revoke all on function sgc.reemplazar_articulo_renglon_requisicion(uuid, uuid, text) from public, anon;
grant execute on function sgc.reemplazar_articulo_renglon_requisicion(uuid, uuid, text) to authenticated, service_role;
