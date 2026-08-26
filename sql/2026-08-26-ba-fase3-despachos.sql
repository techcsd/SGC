-- ============================================================================
-- BA / TRANSPORTE V3 — FASE 3 — Despachos (backend). Aditivo.
--  1. aprobar_requisicion respeta el flag `requisicion_auto_conduce` (transición
--     AT7): 'true' = comportamiento actual + enlaza la salida a la requisición;
--     'false' = NO genera conduce, la requisición queda 'por_despachar'.
--  2. requisicion_avance — solicitado vs despachado, renglón por renglón.
--  3. Cierre/cancelación por ROL (set aprobado por Xaviel) + autor + responsable.
--  4. Vincular conduce suelto a una requisición (rectificación) — Raykler/admin.
-- El flag nace 'true' (FASE 1): NADA cambia hasta que Xaviel lo apague cuando el
-- flujo de despacho de la app (PROMPT-18) esté listo.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- (1) aprobar_requisicion — flag-aware + enlace inverso -----------------------
create or replace function sgc.aprobar_requisicion(p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_sol sgc.solicitudes_material%rowtype;
  v_item jsonb; v_articulo_id uuid; v_cant numeric; v_stock numeric; v_desp numeric; v_falt numeric;
  v_nombre text; v_codigo text; v_desc text; v_talla text;
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

  -- Flag de transición (BA/Transporte v3): ¿aprobar genera el conduce automático?
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
        'cantidad', v_falt, 'proveedor_sugerido', null);
      v_falt_total := v_falt_total + v_falt;
    end if;

    -- Nota: el consumo de cuadre solo se registra si REALMENTE se despacha ahora
    -- (auto). En modo despacho manual, se registrará al crearse cada conduce.
    if v_auto and v_has_cuadre and v_articulo_id is not null and v_desp > 0 then
      insert into sgc.cuadre_consumo (proyecto_id, articulo_id, fase, cantidad, requisicion_id)
      values (v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
      perform sgc.evaluar_alerta_cuadre(v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
    end if;
  end loop;

  -- Genera el conduce (salida) SOLO si el flag lo permite (comportamiento AT7 legado).
  if v_auto and jsonb_array_length(v_despacho) > 0 then
    v_salida_id := sgc.registrar_salida_inventario(
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto', p_responsable, p_observaciones, auth.uid(), v_despacho);
    -- Enlace inverso: el conduce sabe de qué requisición salió (Q5).
    if v_salida_id is not null then
      update sgc.salidas_inventario set origen_requisicion_id = p_solicitud_id where id = v_salida_id;
    end if;
  end if;

  if jsonb_array_length(v_compra) > 0 then
    insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, estado, notas, origen_requisicion_id)
    values (v_sol.proyecto_id, v_sol.solicitante_id, 'pendiente',
            'Generada automáticamente por el faltante de la requisición al aprobar.', p_solicitud_id)
    returning id into v_sc_id;
    insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido)
    select v_sc_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido'
    from jsonb_array_elements(v_compra) as i;
  end if;

  -- Estado resultante:
  --  · auto ON  → como siempre: 'aprobada' (queda faltante) / 'entregada' (todo despachado).
  --  · auto OFF → 'por_despachar' si hay líneas despachables (esperan conduce),
  --               'aprobada' si todo pasó a compra, 'entregada' si nada pendiente.
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

-- (2) Avance de la requisición — solicitado vs despachado por renglón ---------
create or replace function sgc.requisicion_avance(p_solicitud_id uuid)
returns table(
  articulo_id uuid, descripcion text, unidad text, talla text,
  solicitado numeric, despachado numeric, pendiente numeric)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with despachos as (
    -- Conduces (salidas) vinculados a la requisición: directos o vía conduce externo.
    select ds.articulo_id, sum(coalesce(ds.cantidad,0)) as cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    where s.origen_requisicion_id = p_solicitud_id
       or s.id in (select ce.salida_id from sgc.conduces_externos ce
                   where ce.origen_requisicion_id = p_solicitud_id and ce.salida_id is not null)
    group by ds.articulo_id
  )
  select smi.articulo_id,
         coalesce(nullif(btrim(smi.descripcion),''), a.nombre, '—') as descripcion,
         smi.unidad, smi.talla,
         coalesce(smi.cantidad, 0) as solicitado,
         coalesce(d.cant, 0) as despachado,
         greatest(coalesce(smi.cantidad,0) - coalesce(d.cant,0), 0) as pendiente
  from sgc.solicitud_material_items smi
  left join sgc.articulos a on a.id = smi.articulo_id
  left join despachos d on d.articulo_id = smi.articulo_id
  where smi.solicitud_id = p_solicitud_id
  order by descripcion;
$$;
grant execute on function sgc.requisicion_avance(uuid) to authenticated;

-- (3) Permiso de gestión (cierre/cancelación) por ROL + autor + responsable ---
create or replace function sgc.puede_gestionar_requisicion(p_solicitud_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = auth.uid()
                   and r.codigo in ('logistica','coord_compras','jefe_ingenieros','tecnologia'))
      or exists (select 1 from sgc.solicitudes_material sm
                 where sm.id = p_solicitud_id and sm.solicitante_id = auth.uid())
      or exists (select 1 from sgc.solicitudes_material sm
                 where sm.id = p_solicitud_id and sgc.es_responsable_de_proyecto(sm.proyecto_id));
$$;
grant execute on function sgc.puede_gestionar_requisicion(uuid) to authenticated;

-- Cierre manual (se da por completada aunque no se haya despachado todo).
create or replace function sgc.requisicion_cerrar(p_solicitud_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_gestionar_requisicion(p_solicitud_id) then
    raise exception 'No tienes permiso para cerrar esta requisición.';
  end if;
  update sgc.solicitudes_material
     set estado = 'completada', cerrada_por = auth.uid(), cerrada_en = now(), updated_at = now()
   where id = p_solicitud_id and estado not in ('cancelada');
end;
$$;
grant execute on function sgc.requisicion_cerrar(uuid) to authenticated;

-- Cancelación con motivo obligatorio (histórico intacto).
create or replace function sgc.requisicion_cancelar(p_solicitud_id uuid, p_motivo text)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_gestionar_requisicion(p_solicitud_id) then
    raise exception 'No tienes permiso para cancelar esta requisición.';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;
  update sgc.solicitudes_material
     set estado = 'cancelada', cancelada_motivo = btrim(p_motivo),
         cerrada_por = auth.uid(), cerrada_en = now(), updated_at = now()
   where id = p_solicitud_id;
end;
$$;
grant execute on function sgc.requisicion_cancelar(uuid,text) to authenticated;

-- (4) Vincular un conduce suelto a una requisición (rectificación) ------------
create or replace function sgc.requisicion_vincular_conduce(p_solicitud_id uuid, p_salida_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.es_logistica() or sgc.puede_gestionar_requisicion(p_solicitud_id)) then
    raise exception 'No tienes permiso para vincular conduces a la requisición.';
  end if;
  update sgc.salidas_inventario set origen_requisicion_id = p_solicitud_id where id = p_salida_id;
end;
$$;
grant execute on function sgc.requisicion_vincular_conduce(uuid,uuid) to authenticated;

-- Conduces (salidas) sin vincular, candidatos para vincular a una requisición.
create or replace function sgc.conduces_sin_vincular(p_proyecto_id uuid default null)
returns table(id uuid, fecha date, motivo text, proyecto_id uuid, estado text, despachante_nombre text, creado_en timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.motivo, s.proyecto_id, s.estado, s.despachante_nombre, s.created_at
  from sgc.salidas_inventario s
  where s.origen_requisicion_id is null
    and coalesce(s.anulado_por is null, true)
    and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin() or not coalesce(s.es_prueba, false))
  order by s.created_at desc
  limit 100;
$$;
grant execute on function sgc.conduces_sin_vincular(uuid) to authenticated;

commit;
