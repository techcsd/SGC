-- ════════════════════════════════════════════════════════════════════════════
-- BH7 — Recuperar el articulo_id que hoy se tira al auto-generar la solicitud de
--   compra por el faltante de una requisición, y exigir motivo al rechazar una
--   solicitud de compra (misma regla que cancelar una requisición, BA6).
--
-- Causa (prima de AT7/AU12): aprobar_requisicion construía cada renglón de compra
-- como TEXTO plano ('[CODIGO] Nombre (Talla X)') + cantidad, sin articulo_id ni FK
-- al renglón de la requisición → la orden nacía como `esOtro: true, articulo_id: null`,
-- desconectada del catálogo.
--
-- Aditivo/retrocompatible: las filas viejas se quedan sin articulo_id y siguen
-- funcionando como "otro".
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── 1) Columnas nuevas en solicitud_compra_items ─────────────────────────────
alter table sgc.solicitud_compra_items
  add column if not exists articulo_id   uuid references sgc.articulos(id),
  add column if not exists unidad        text,
  add column if not exists origen_item_id uuid references sgc.solicitud_material_items(id);

comment on column sgc.solicitud_compra_items.articulo_id is
  'BH7 — artículo del catálogo cuando el faltante nació de un renglón resuelto (evita "fuera de catálogo").';
comment on column sgc.solicitud_compra_items.origen_item_id is
  'BH7 — renglón de la requisición que originó este faltante (trazabilidad inversa).';

-- ── 2) aprobar_requisicion: copia articulo_id + unidad al faltante ───────────
create or replace function sgc.aprobar_requisicion(p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_sol sgc.solicitudes_material%rowtype;
  v_item jsonb; v_articulo_id uuid; v_cant numeric; v_stock numeric; v_desp numeric; v_falt numeric;
  v_nombre text; v_codigo text; v_desc text; v_talla text; v_unidad text;
  v_despacho jsonb := '[]'::jsonb; v_compra jsonb := '[]'::jsonb;
  v_falt_total numeric := 0; v_desp_total numeric := 0;
  v_salida_id uuid; v_sc_id uuid; v_fase int; v_has_cuadre boolean := false;
  v_auto boolean;
  v_estado text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;
  if not found then raise exception 'Requisición no encontrada.'; end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esta requisición ya fue procesada.'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para aprobar requisiciones.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes aprobar tu propia requisición.';
  end if;

  select coalesce((select valor from sgc.parametros where clave = 'requisicion_auto_conduce'), 'true') = 'true'
    into v_auto;

  select fase_activa into v_fase from sgc.cuadre_obra where proyecto_id = v_sol.proyecto_id;
  v_has_cuadre := found;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_articulo_id := nullif(v_item->>'articulo_id', '')::uuid;
    v_cant := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cant <= 0 then continue; end if;
    v_desc := coalesce(v_item->>'descripcion', '');
    v_talla := nullif(v_item->>'talla', '');
    v_unidad := nullif(v_item->>'unidad', '');
    v_nombre := null; v_codigo := null;

    if v_articulo_id is not null then
      select coalesce(s.cantidad, 0), a.nombre, a.codigo into v_stock, v_nombre, v_codigo
      from sgc.articulos a
      left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
      where a.id = v_articulo_id;
      v_stock := coalesce(v_stock, 0);
      v_desp := least(v_cant, v_stock);
      if v_desc = '' then v_desc := coalesce(v_nombre, ''); end if;
    else
      v_desp := 0;
    end if;

    v_falt := v_cant - v_desp;

    if v_desp > 0 then
      v_despacho := v_despacho || jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', v_desp, 'talla', v_item->>'talla');
      v_desp_total := v_desp_total + v_desp;
    end if;
    if v_falt > 0 then
      v_compra := v_compra || jsonb_build_object(
        'descripcion',
          (case when v_codigo is not null then '[' || v_codigo || '] ' || v_desc else v_desc end)
          || case when v_talla is not null then ' (Talla ' || v_talla || ')' else '' end,
        'cantidad', v_falt, 'proveedor_sugerido', null,
        'articulo_id', v_articulo_id,   -- BH7 — se preserva el artículo del catálogo
        'unidad', v_unidad);            -- BH7 — y su unidad
      v_falt_total := v_falt_total + v_falt;
    end if;

    if v_auto and v_has_cuadre and v_articulo_id is not null and v_desp > 0 then
      insert into sgc.cuadre_consumo (proyecto_id, articulo_id, fase, cantidad, requisicion_id)
      values (v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
      perform sgc.evaluar_alerta_cuadre(v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
    end if;
  end loop;

  if v_auto and jsonb_array_length(v_despacho) > 0 then
    v_salida_id := sgc.registrar_salida_inventario(
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto', p_responsable, p_observaciones, auth.uid(), v_despacho);
    if v_salida_id is not null then
      update sgc.salidas_inventario set origen_requisicion_id = p_solicitud_id where id = v_salida_id;
    end if;
  end if;

  if jsonb_array_length(v_compra) > 0 then
    insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, estado, notas, origen_requisicion_id)
    values (v_sol.proyecto_id, v_sol.solicitante_id, 'pendiente',
            'Generada automáticamente por el faltante de la requisición al aprobar.', p_solicitud_id)
    returning id into v_sc_id;
    insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, articulo_id, unidad)
    select v_sc_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido',
           nullif(i->>'articulo_id','')::uuid, nullif(i->>'unidad','')
    from jsonb_array_elements(v_compra) as i;
  end if;

  if v_auto then
    v_estado := case when v_falt_total > 0 then 'aprobada' else 'entregada' end;
  else
    v_estado := case
                  when v_desp_total > 0 then 'por_despachar'
                  when v_falt_total > 0 then 'aprobada'
                  else 'entregada' end;
  end if;

  update sgc.solicitudes_material
     set estado = v_estado,
         salida_id = coalesce(v_salida_id, salida_id),
         solicitud_compra_id = coalesce(v_sc_id, solicitud_compra_id),
         bodega_id = p_bodega_id, atendido_por = auth.uid(), atendido_en = now(), updated_at = now()
   where id = p_solicitud_id;

  return jsonb_build_object('salida_id', v_salida_id, 'solicitud_compra_id', v_sc_id,
    'despachado_total', v_desp_total, 'faltante_total', v_falt_total,
    'auto_conduce', v_auto, 'estado', v_estado);
end;
$function$;

-- ── 3) rechazar_solicitud_compra: motivo obligatorio (BA6, misma regla) ──────
create or replace function sgc.rechazar_solicitud_compra(p_solicitud_id uuid, p_notas text default null)
returns void
language plpgsql
as $$
declare
  v_sol sgc.solicitudes_compra%rowtype;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esta solicitud ya fue procesada.'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'No autorizado para rechazar solicitudes de compra.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes rechazar tu propia solicitud.';
  end if;
  if nullif(btrim(coalesce(p_notas,'')),'') is null then
    raise exception 'El motivo del rechazo es obligatorio.';
  end if;

  update sgc.solicitudes_compra
  set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
      notas = btrim(p_notas), updated_at = now()
  where id = p_solicitud_id;
end;
$$;

commit;
