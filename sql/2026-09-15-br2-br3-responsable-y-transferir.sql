-- BR2 + BR3 — Responsable como USUARIO (buscar por usuario) + transferir conduce web.
-- Nota #29: "que ahí se pueda buscar, por usuario" (Responsable en aprobar requisición /
--   salidas; la captura mostraba "Rakler Feliz" en texto libre con typo).
-- Nota #30: "desde esta vista yo debería poder traspasar ese conduce a alguien… en la
--   web no deja transferir, solo en la app lo habilité".
--
-- BR2: salidas_inventario.responsable_id -> usuarios (aditivo; `responsable` texto se
--   conserva como snapshot). Los RPCs aceptan p_responsable_id y rellenan el texto con
--   usuarios.nombre. Backfill best-effort por nombre normalizado EXACTO (los que no
--   matcheen se reportan, no se adivinan).
-- BR3: se amplía el gate de ofrecer_transferencia_conduce (el MISMO RPC que usa la app,
--   AU1) para incluir tiene_modulo('inventario') → Raykler y El flaco también transfieren.
--   La web OFRECE la transferencia; el chofer receptor la acepta en su app (foto+firma),
--   idéntico a la app (paridad).

begin;

-- 1) Columna aditiva -------------------------------------------------------------
alter table sgc.salidas_inventario
  add column if not exists responsable_id uuid references sgc.usuarios(id);
create index if not exists idx_salidas_responsable_id on sgc.salidas_inventario(responsable_id);

-- 2) registrar_salida_inventario — acepta p_responsable_id (drop+recreate: nuevo arg) --
drop function if exists sgc.registrar_salida_inventario(date, uuid, uuid, text, character varying, text, uuid, jsonb);
create function sgc.registrar_salida_inventario(p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_salida_id     uuid;
  v_item          jsonb;
  v_stock_actual  numeric;
  v_nombre        text;
  v_bodega_nombre text;
  v_solicitado    numeric;
  v_faltantes     text[] := array[]::text[];
  v_responsable   text := p_responsable;   -- BR2
begin
  -- BR2 — si viene el id, el texto se rellena con el nombre del usuario (snapshot).
  if p_responsable_id is not null then
    select coalesce(nombre, p_responsable) into v_responsable from sgc.usuarios where id = p_responsable_id;
    v_responsable := coalesce(v_responsable, p_responsable);
  end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad, 0)
      into v_nombre, v_stock_actual
    from sgc.articulos a
    left join sgc.stock_por_bodega s
      on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;

    v_nombre := coalesce(v_nombre, 'artículo desconocido');
    v_stock_actual := coalesce(v_stock_actual, 0);

    if v_stock_actual < v_solicitado then
      v_faltantes := v_faltantes || format(
        'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega_nombre,
        trim(to_char(v_stock_actual, 'FM999999990.###')),
        trim(to_char(v_solicitado,  'FM999999990.###'))
      );
    end if;
  end loop;

  if array_length(v_faltantes, 1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n');
  end if;

  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, responsable_id, observaciones, creado_por)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, v_responsable, p_responsable_id, p_observaciones, p_creado_por)
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla, unidad_capturada, factor_aplicado)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;
grant execute on function sgc.registrar_salida_inventario(date, uuid, uuid, text, character varying, text, uuid, jsonb, uuid) to authenticated;

-- 3) aprobar_requisicion — acepta p_responsable_id y lo propaga ------------------
drop function if exists sgc.aprobar_requisicion(uuid, uuid, date, text, text, jsonb);
create function sgc.aprobar_requisicion(p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_sol sgc.solicitudes_material%rowtype;
  v_item jsonb; v_articulo_id uuid; v_cant numeric; v_stock numeric; v_desp numeric; v_falt numeric;
  v_nombre text; v_codigo text; v_desc text; v_talla text; v_unidad text; v_item_id uuid;
  v_despacho jsonb := '[]'::jsonb; v_compra jsonb := '[]'::jsonb;
  v_falt_total numeric := 0; v_desp_total numeric := 0;
  v_salida_id uuid; v_sc_id uuid; v_fase int; v_has_cuadre boolean := false;
  v_auto boolean;
  v_estado text;
  v_unidad_cap text; v_factor numeric;
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
    v_item_id := nullif(v_item->>'item_id', '')::uuid;
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
      v_unidad_cap := null; v_factor := 1;
      if v_item_id is not null then
        select smi.unidad_capturada, coalesce(smi.factor_aplicado, 1)
          into v_unidad_cap, v_factor
          from sgc.solicitud_material_items smi where smi.id = v_item_id;
      end if;
      v_despacho := v_despacho || jsonb_build_object(
        'articulo_id', v_articulo_id, 'cantidad', v_desp, 'talla', v_item->>'talla',
        'unidad_capturada', v_unidad_cap, 'factor_aplicado', coalesce(v_factor, 1));
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
        'origen_item_id', v_item_id);
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
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto', p_responsable, p_observaciones, auth.uid(), v_despacho, p_responsable_id);
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
grant execute on function sgc.aprobar_requisicion(uuid, uuid, date, text, text, jsonb, uuid) to authenticated;

-- 4) Backfill best-effort por nombre normalizado EXACTO --------------------------
update sgc.salidas_inventario s
   set responsable_id = u.id
  from sgc.usuarios u
 where s.responsable_id is null
   and s.responsable is not null and btrim(s.responsable) <> ''
   and lower(btrim(s.responsable)) = lower(btrim(u.nombre));

-- 5) BR3 — ampliar el gate de ofrecer_transferencia_conduce (mismo RPC, AU1) -----
create or replace function sgc.ofrecer_transferencia_conduce(p_salida_id uuid, p_a_conductor_id uuid, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_salida sgc.salidas_inventario%rowtype;
  -- BR3 — antes solo admin/flota; ahora también inventario (Raykler, El flaco).
  v_es_flota boolean := sgc.is_admin() or sgc.es_flota_elevado() or sgc.tiene_modulo('inventario');
  v_soy_responsable boolean;
  v_a_usuario uuid; v_de_nombre text; v_id uuid; v_es_prueba boolean; v_fase text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado'; end if;

  v_soy_responsable := exists (
    select 1 from sgc.conductores c
    where c.id = v_salida.conductor_id and c.usuario_id = v_uid);
  if not (v_soy_responsable or v_es_flota) then
    raise exception 'Solo el chofer responsable, Flota o Inventario puede transferir este conduce';
  end if;

  v_fase := sgc.conduce_fase(p_salida_id);
  if v_fase not in ('emitido','en_transito') then
    raise exception 'Este conduce ya no se puede transferir (está en fase "%"). Solo se transfiere emitido o en ruta.', v_fase
      using errcode = 'DR423';
  end if;

  if p_a_conductor_id = v_salida.conductor_id then
    raise exception 'El conduce ya está a cargo de ese chofer';
  end if;
  if not exists (select 1 from sgc.conductores where id = p_a_conductor_id and coalesce(activo,true)) then
    raise exception 'Chofer destino no válido';
  end if;

  if exists (select 1 from sgc.conduce_transferencias
             where salida_id = p_salida_id and estado = 'ofrecida') then
    raise exception 'Ya hay una transferencia pendiente para este conduce';
  end if;

  v_es_prueba := coalesce(v_salida.es_prueba, false);
  insert into sgc.conduce_transferencias (
    salida_id, de_conductor_id, a_conductor_id, ofrecida_por, notas,
    fase_al_transferir, es_prueba, es_prueba_origen)
  values (p_salida_id, v_salida.conductor_id, p_a_conductor_id, v_uid, nullif(trim(p_notas),''),
          v_fase, v_es_prueba, case when v_es_prueba then 'heredado' else 'manual' end)
  returning id into v_id;

  select usuario_id into v_a_usuario from sgc.conductores where id = p_a_conductor_id;
  select nombre into v_de_nombre from sgc.usuarios where id = v_uid;
  if v_a_usuario is not null then
    perform sgc.notificar(v_a_usuario, 'transporte',
      'Te ofrecen un conduce',
      format('%s quiere transferirte la responsabilidad de un conduce. Revísalo y acéptalo con foto y firma.',
             coalesce(v_de_nombre,'Un chofer')),
      '/transporte/conduces');
  end if;

  return v_id;
end;
$function$;

commit;
