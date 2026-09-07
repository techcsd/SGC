-- ============================================================================
-- BJ4 — Despacho PARCIAL de la requisición (pedido de Raykler). Aditivo.
--
-- (1) BUG de estado: en aprobar_requisicion, con TODAS las líneas en cero
--     (v_desp_total=0 y v_falt_total=0) se escribía 'entregada' → la requisición
--     "dice entregada" sin haber despachado nada y se cae de
--     requisiciones_por_despachar() → el restante queda inalcanzable. Además, un
--     despacho de MENOS de lo solicitado (el aprobador edita cantidades) también
--     terminaba en 'entregada' porque el estado solo miraba los p_items de ESTE
--     approval, no lo que aún queda pendiente en solicitud_material_items.
--
--     FIX: el estado se calcula contra el AVANCE REAL de la requisición
--     (solicitado por ítem vs. despachado acumulado, excluyendo líneas canceladas
--     y las ya cubiertas por una compra del faltante):
--       · nada despachado y queda pendiente        → 'por_despachar'
--       · algo despachado y queda pendiente         → 'parcial'   (por fin se escribe)
--       · nada pendiente, hubo faltante a compra    → 'aprobada'  (espera la compra)
--       · nada pendiente, todo despachado           → 'entregada'
--
-- (2) 'parcial' entra en requisiciones_por_despachar() (antes solo 'por_despachar')
--     para que el restante sea alcanzable en un 2º conduce; y despacho_marcar()
--     recalcula el estado al vincular un conduce (cierra el lazo: al despachar el
--     restante, pasa sola a 'entregada').
--
-- (6) Estado por LÍNEA en solicitud_material_items (pendiente|despachada|cancelada)
--     + motivo. Permite "quitar esta línea y cerrar el resto" sin cancelar la
--     requisición entera. El check (cantidad > 0) SE QUEDA: cancelar ≠ poner en cero.
--     RLS: la mutación va por RPC SECURITY DEFINER (la tabla no tiene UPDATE policy).
--
-- (7) La compra automática respeta lo cancelado: origen_item_id (BH7) ya enlaza el
--     faltante a su línea; el cálculo de avance/pendiente excluye las canceladas.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ── (6) Estado por línea ────────────────────────────────────────────────────
alter table sgc.solicitud_material_items
  add column if not exists estado           text not null default 'pendiente',
  add column if not exists cancelado_motivo text,
  add column if not exists cancelado_por    uuid references sgc.usuarios(id),
  add column if not exists cancelado_en     timestamptz;

alter table sgc.solicitud_material_items
  drop constraint if exists solicitud_material_items_estado_check;
alter table sgc.solicitud_material_items
  add constraint solicitud_material_items_estado_check
  check (estado in ('pendiente', 'despachada', 'cancelada'));

-- ── Helper: pendiente de despacho real por línea (excluye canceladas y las
--    cubiertas por una compra del faltante). Devuelve una fila por ítem. ───────
create or replace function sgc.requisicion_pendiente_items(p_solicitud_id uuid)
returns table(item_id uuid, articulo_id uuid, solicitado numeric, despachado numeric, pendiente numeric, estado text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with despachos as (
    select ds.articulo_id, sum(coalesce(ds.cantidad,0)) as cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    where (s.origen_requisicion_id = p_solicitud_id
           or s.id in (select ce.salida_id from sgc.conduces_externos ce
                       where ce.origen_requisicion_id = p_solicitud_id and ce.salida_id is not null))
      and coalesce(s.anulado_por is null, true)
    group by ds.articulo_id
  )
  select smi.id, smi.articulo_id,
         coalesce(smi.cantidad,0) as solicitado,
         coalesce(d.cant,0) as despachado,
         case
           when coalesce(smi.estado,'pendiente') = 'cancelada' then 0
           -- ¿el faltante de esta línea ya se envió a compra? → no queda por despachar.
           when exists (select 1 from sgc.solicitud_compra_items sci
                        join sgc.solicitudes_compra sc on sc.id = sci.solicitud_id
                        where sc.origen_requisicion_id = p_solicitud_id
                          and sci.origen_item_id = smi.id) then 0
           else greatest(coalesce(smi.cantidad,0) - coalesce(d.cant,0), 0)
         end as pendiente,
         coalesce(smi.estado,'pendiente') as estado
  from sgc.solicitud_material_items smi
  left join despachos d on d.articulo_id is not distinct from smi.articulo_id
  where smi.solicitud_id = p_solicitud_id;
$$;
grant execute on function sgc.requisicion_pendiente_items(uuid) to authenticated, service_role;

-- ── Helper: estado de despacho calculado (solo mueve estados de despacho) ─────
-- Devuelve 'por_despachar' | 'parcial' | 'entregada' | 'aprobada' según el avance.
create or replace function sgc.requisicion_estado_despacho(p_solicitud_id uuid)
returns text
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_pend numeric := 0;
  v_hubo_despacho boolean := false;
  v_hubo_compra boolean := false;
begin
  select coalesce(sum(pendiente),0) into v_pend
    from sgc.requisicion_pendiente_items(p_solicitud_id);

  select exists (select 1 from sgc.salidas_inventario s
                 where s.origen_requisicion_id = p_solicitud_id
                   and coalesce(s.anulado_por is null, true))
    into v_hubo_despacho;

  select exists (select 1 from sgc.solicitudes_compra sc
                 where sc.origen_requisicion_id = p_solicitud_id)
    into v_hubo_compra;

  if v_pend > 0 then
    return case when v_hubo_despacho then 'parcial' else 'por_despachar' end;
  else
    return case when v_hubo_compra then 'aprobada' else 'entregada' end;
  end if;
end;
$$;
grant execute on function sgc.requisicion_estado_despacho(uuid) to authenticated, service_role;

-- ── (1) aprobar_requisicion — estado por AVANCE real (base BH7) ───────────────
create or replace function sgc.aprobar_requisicion(p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_sol sgc.solicitudes_material%rowtype;
  v_item jsonb; v_articulo_id uuid; v_cant numeric; v_stock numeric; v_desp numeric; v_falt numeric;
  v_nombre text; v_codigo text; v_desc text; v_talla text; v_unidad text; v_item_id uuid;
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
    v_item_id := nullif(v_item->>'item_id', '')::uuid;   -- BJ4 — línea de origen (si viene)
    -- (7) Nunca despachar/comprar una línea cancelada, aunque el cliente la mande.
    if v_item_id is not null and exists (
      select 1 from sgc.solicitud_material_items smi
      where smi.id = v_item_id and coalesce(smi.estado,'pendiente') = 'cancelada'
    ) then continue; end if;
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
        'articulo_id', v_articulo_id,
        'unidad', v_unidad,
        'origen_item_id', v_item_id);   -- BJ4/BH7 — traza inversa a la línea
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
    insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, articulo_id, unidad, origen_item_id)
    select v_sc_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido',
           nullif(i->>'articulo_id','')::uuid, nullif(i->>'unidad',''), nullif(i->>'origen_item_id','')::uuid
    from jsonb_array_elements(v_compra) as i;
  end if;

  -- Marca como 'despachada' las líneas totalmente servidas (para el UI por línea).
  update sgc.solicitud_material_items smi
     set estado = 'despachada'
   where smi.solicitud_id = p_solicitud_id
     and coalesce(smi.estado,'pendiente') = 'pendiente'
     and coalesce(smi.cantidad,0) <= coalesce((
         select sum(ds.cantidad) from sgc.detalle_salidas ds
         join sgc.salidas_inventario s on s.id = ds.salida_id
         where s.origen_requisicion_id = p_solicitud_id
           and ds.articulo_id is not distinct from smi.articulo_id
           and coalesce(s.anulado_por is null, true)), 0);

  -- (1) Estado por AVANCE real (no por los p_items de este approval).
  v_estado := sgc.requisicion_estado_despacho(p_solicitud_id);

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

-- ── (2) requisiciones_por_despachar — incluye 'parcial' ──────────────────────
create or replace function sgc.requisiciones_por_despachar()
returns table(
  id uuid, proyecto_id uuid, proyecto_nombre text, solicitante text,
  fecha date, renglones bigint, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sm.id, sm.proyecto_id, p.nombre::text, u.nombre::text, sm.created_at::date,
         (select count(*) from sgc.solicitud_material_items i
           where i.solicitud_id = sm.id and coalesce(i.estado,'pendiente') <> 'cancelada'),
         sm.created_at
  from sgc.solicitudes_material sm
  left join sgc.proyectos p on p.id = sm.proyecto_id
  left join sgc.usuarios u on u.id = sm.solicitante_id
  where sm.estado in ('por_despachar', 'parcial')       -- BJ4 — el restante sigue alcanzable
    and sgc.puede_crear_conduce()
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin()
         or not exists (select 1 from sgc.proyectos pp
                        where pp.id = sm.proyecto_id and coalesce(pp.es_prueba, false)))
  order by sm.created_at desc;
$$;
grant execute on function sgc.requisiciones_por_despachar() to authenticated, service_role;

-- ── (2) despacho_marcar — recalcula estado al vincular un conduce ────────────
create or replace function sgc.despacho_marcar(p_salida_id uuid, p_requisicion_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.puede_crear_conduce() or sgc.es_logistica()) then
    raise exception 'No tienes permiso para vincular despachos.';
  end if;
  update sgc.salidas_inventario
     set origen_requisicion_id = p_requisicion_id
   where id = p_salida_id
     and origen_requisicion_id is null;
  -- Cierra el lazo: al despachar el restante, la requisición pasa sola de
  -- 'parcial'/'por_despachar' a 'entregada'. NO toca estados terminales/manuales.
  update sgc.solicitudes_material sm
     set estado = sgc.requisicion_estado_despacho(p_requisicion_id), updated_at = now()
   where sm.id = p_requisicion_id
     and sm.estado in ('por_despachar', 'parcial');
end;
$$;
grant execute on function sgc.despacho_marcar(uuid, uuid) to authenticated, service_role;

-- ── (6) Cancelar UNA línea de la requisición (con motivo) ────────────────────
create or replace function sgc.requisicion_cancelar_item(p_item_id uuid, p_motivo text)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_sol_id uuid;
  v_estado text;
begin
  select solicitud_id into v_sol_id from sgc.solicitud_material_items where id = p_item_id;
  if v_sol_id is null then raise exception 'Línea no encontrada.'; end if;
  if not sgc.puede_gestionar_requisicion(v_sol_id) then
    raise exception 'No tienes permiso para modificar esta requisición.';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'El motivo para quitar la línea es obligatorio.';
  end if;

  update sgc.solicitud_material_items
     set estado = 'cancelada', cancelado_motivo = btrim(p_motivo),
         cancelado_por = auth.uid(), cancelado_en = now()
   where id = p_item_id and coalesce(estado,'pendiente') <> 'despachada';

  -- Recalcular el estado de despacho de la requisición (sin tocar terminales).
  select estado into v_estado from sgc.solicitudes_material where id = v_sol_id;
  if v_estado in ('por_despachar', 'parcial') then
    update sgc.solicitudes_material
       set estado = sgc.requisicion_estado_despacho(v_sol_id), updated_at = now()
     where id = v_sol_id;
  end if;
end;
$$;
grant execute on function sgc.requisicion_cancelar_item(uuid, text) to authenticated, service_role;

-- ── requisicion_avance — expone el estado de la línea (UI muestra canceladas) ─
-- Cambia el tipo de retorno (añade estado + item_id) → hay que DROPearla primero
-- (create or replace no puede cambiar las columnas OUT). Sólo la llama el front.
drop function if exists sgc.requisicion_avance(uuid);
create or replace function sgc.requisicion_avance(p_solicitud_id uuid)
returns table(
  articulo_id uuid, descripcion text, unidad text, talla text,
  solicitado numeric, despachado numeric, pendiente numeric, estado text, item_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with despachos as (
    select ds.articulo_id, sum(coalesce(ds.cantidad,0)) as cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    where (s.origen_requisicion_id = p_solicitud_id
           or s.id in (select ce.salida_id from sgc.conduces_externos ce
                       where ce.origen_requisicion_id = p_solicitud_id and ce.salida_id is not null))
      and coalesce(s.anulado_por is null, true)
    group by ds.articulo_id
  )
  select smi.articulo_id,
         coalesce(nullif(btrim(smi.descripcion),''), a.nombre, '—') as descripcion,
         smi.unidad, smi.talla,
         coalesce(smi.cantidad, 0) as solicitado,
         coalesce(d.cant, 0) as despachado,
         case when coalesce(smi.estado,'pendiente') = 'cancelada' then 0
              else greatest(coalesce(smi.cantidad,0) - coalesce(d.cant,0), 0) end as pendiente,
         coalesce(smi.estado,'pendiente') as estado,
         smi.id as item_id
  from sgc.solicitud_material_items smi
  left join sgc.articulos a on a.id = smi.articulo_id
  left join despachos d on d.articulo_id is not distinct from smi.articulo_id
  where smi.solicitud_id = p_solicitud_id
  order by descripcion;
$$;
grant execute on function sgc.requisicion_avance(uuid) to authenticated;

commit;
