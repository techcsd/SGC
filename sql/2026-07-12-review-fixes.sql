-- ============================================================================
-- Revisión post-implementación (07/07/2026) — correcciones de coherencia
--  1) evaluar_alerta_cuadre: solo alerta artículos DENTRO del cuadre; el caso
--     "no presupuestado en la fase" baja a ADVERTENCIA (evita inundación).
--  2) aprobar_requisicion: el consumo del cuadre registra lo DESPACHADO (v_desp),
--     no lo requisitado (evita doble conteo cuando el faltante se compra y luego
--     se despacha en otra requisición).
--  3) Plantilla de checklist para "equipos/herramientas" (variante faltante A6).
--  4) Rol "Encargado de Tecnología" (el módulo tecnologia era solo admin).
-- Todo aditivo/retro-compatible.
-- ============================================================================
set search_path = sgc, public;

-- 1) Alerta antifraude: no inundar --------------------------------------------
create or replace function sgc.evaluar_alerta_cuadre(
  p_proyecto_id uuid,
  p_articulo_id uuid,
  p_fase int,
  p_cantidad numeric,
  p_requisicion_id uuid
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_estimado   numeric;
  v_consumido  numeric;
  v_pct        numeric;
  v_umbral_a   numeric;
  v_umbral_w   numeric;
  v_sev        text;
  v_tipo       text := 'acumulado_excede';
  v_msg        text;
  v_nombre     text;
  v_open_id    uuid;
begin
  -- Solo se monitorean artículos que el cuadre realmente contempla.
  if not exists (
    select 1 from sgc.cuadre_items where proyecto_id = p_proyecto_id and articulo_id = p_articulo_id
  ) then
    return;
  end if;

  select coalesce(sum(
           case p_fase when 1 then est_f1
                       when 2 then est_f1 + est_f2
                       when 3 then est_f1 + est_f2 + est_f3
                       else est_f1 + est_f2 + est_f3 + est_f4 end), 0)
    into v_estimado
    from sgc.cuadre_items
   where proyecto_id = p_proyecto_id and articulo_id = p_articulo_id;

  select coalesce(sum(cantidad), 0) into v_consumido
    from sgc.cuadre_consumo
   where proyecto_id = p_proyecto_id and articulo_id = p_articulo_id and fase <= p_fase;

  select coalesce(max(valor)::numeric, 100) into v_umbral_a from sgc.parametros where clave = 'alerta_cuadre_umbral_alerta';
  select coalesce(max(valor)::numeric, 80)  into v_umbral_w from sgc.parametros where clave = 'alerta_cuadre_umbral_advertencia';

  if v_estimado <= 0 then
    -- Está en el cuadre pero sin estimado para esta fase → advertencia (no alerta roja).
    if v_consumido <= 0 then return; end if;
    v_sev := 'advertencia'; v_pct := null;
  else
    v_pct := round(v_consumido / v_estimado * 100, 1);
    if v_pct >= v_umbral_a then v_sev := 'alerta';
    elsif v_pct >= v_umbral_w then v_sev := 'advertencia';
    else return;
    end if;
  end if;

  select nombre into v_nombre from sgc.articulos where id = p_articulo_id;
  v_msg := format('%s: consumo acumulado %s vs estimado %s en fase %s%s.',
                  coalesce(v_nombre, 'Artículo'), v_consumido, v_estimado, p_fase,
                  case when v_pct is not null then ' (' || v_pct || '%)' else ' (sin estimado en la fase)' end);

  select id into v_open_id from sgc.alertas_cuadre
   where proyecto_id = p_proyecto_id and articulo_id = p_articulo_id and fase = p_fase and estado <> 'resuelta'
   limit 1;

  if v_open_id is not null then
    update sgc.alertas_cuadre
       set severidad = v_sev, estimado = v_estimado, consumido = v_consumido,
           desviacion_pct = v_pct, requisicion_id = p_requisicion_id, tipo = v_tipo,
           mensaje = v_msg, updated_at = now()
     where id = v_open_id;
  else
    insert into sgc.alertas_cuadre
      (proyecto_id, articulo_id, fase, tipo, severidad, estimado, consumido, desviacion_pct, requisicion_id, mensaje)
    values
      (p_proyecto_id, p_articulo_id, p_fase, v_tipo, v_sev, v_estimado, v_consumido, v_pct, p_requisicion_id, v_msg);
  end if;
end;
$$;

-- 2) aprobar_requisicion: consumo = despachado --------------------------------
create or replace function sgc.aprobar_requisicion(
  p_solicitud_id  uuid,
  p_bodega_id     uuid,
  p_fecha         date,
  p_responsable   text,
  p_observaciones text,
  p_items         jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_sol         sgc.solicitudes_material%rowtype;
  v_item        jsonb;
  v_articulo_id uuid;
  v_cant        numeric;
  v_stock       numeric;
  v_desp        numeric;
  v_falt        numeric;
  v_nombre      text;
  v_codigo      text;
  v_desc        text;
  v_despacho    jsonb := '[]'::jsonb;
  v_compra      jsonb := '[]'::jsonb;
  v_falt_total  numeric := 0;
  v_desp_total  numeric := 0;
  v_salida_id   uuid;
  v_sc_id       uuid;
  v_fase        int;
  v_has_cuadre  boolean := false;
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

  select fase_activa into v_fase from sgc.cuadre_obra where proyecto_id = v_sol.proyecto_id;
  v_has_cuadre := found;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_articulo_id := nullif(v_item->>'articulo_id', '')::uuid;
    v_cant        := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cant <= 0 then continue; end if;
    v_desc   := coalesce(v_item->>'descripcion', '');
    v_nombre := null; v_codigo := null;

    if v_articulo_id is not null then
      select coalesce(s.cantidad, 0), a.nombre, a.codigo
        into v_stock, v_nombre, v_codigo
      from sgc.articulos a
      left join sgc.stock_por_bodega s
        on s.articulo_id = a.id and s.bodega_id = p_bodega_id
      where a.id = v_articulo_id;
      v_stock := coalesce(v_stock, 0);
      v_desp  := least(v_cant, v_stock);
      if v_desc = '' then v_desc := coalesce(v_nombre, ''); end if;
    else
      v_desp := 0;
    end if;

    v_falt := v_cant - v_desp;

    if v_desp > 0 then
      v_despacho   := v_despacho || jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', v_desp);
      v_desp_total := v_desp_total + v_desp;
    end if;
    if v_falt > 0 then
      v_compra := v_compra || jsonb_build_object(
        'descripcion', case when v_codigo is not null then '[' || v_codigo || '] ' || v_desc else v_desc end,
        'cantidad', v_falt,
        'proveedor_sugerido', null
      );
      v_falt_total := v_falt_total + v_falt;
    end if;

    -- Consumo contra el cuadre = lo REALMENTE despachado (no lo requisitado).
    if v_has_cuadre and v_articulo_id is not null and v_desp > 0 then
      insert into sgc.cuadre_consumo (proyecto_id, articulo_id, fase, cantidad, requisicion_id)
      values (v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
      perform sgc.evaluar_alerta_cuadre(v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
    end if;
  end loop;

  if jsonb_array_length(v_despacho) > 0 then
    v_salida_id := sgc.registrar_salida_inventario(
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto',
      p_responsable, p_observaciones, auth.uid(), v_despacho
    );
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

  update sgc.solicitudes_material
     set estado              = case when v_falt_total > 0 then 'aprobada' else 'entregada' end,
         salida_id           = coalesce(v_salida_id, salida_id),
         solicitud_compra_id = coalesce(v_sc_id, solicitud_compra_id),
         bodega_id           = p_bodega_id,
         atendido_por        = auth.uid(),
         atendido_en         = now(),
         updated_at          = now()
   where id = p_solicitud_id;

  return jsonb_build_object(
    'salida_id',           v_salida_id,
    'solicitud_compra_id', v_sc_id,
    'despachado_total',    v_desp_total,
    'faltante_total',      v_falt_total
  );
end;
$$;
grant execute on function sgc.aprobar_requisicion(uuid, uuid, date, text, text, jsonb) to authenticated, service_role;

-- 3) Plantilla de checklist "equipos / herramientas" (categoria 'equipo') ------
do $$
declare v_pl uuid;
begin
  insert into sgc.checklist_plantillas(codigo, nombre, categoria, descripcion, orden)
  values ('PRE-USO-EQUIPO', 'Pre-Uso — Equipos y Herramientas', 'equipo',
          'Verificación previa al uso de equipos y herramientas (planta, demoledor, sierras, etc.).', 4)
  on conflict (codigo) do nothing;
  select id into v_pl from sgc.checklist_plantillas where codigo = 'PRE-USO-EQUIPO';
  if not exists (select 1 from sgc.checklist_plantilla_items where plantilla_id = v_pl) then
    insert into sgc.checklist_plantilla_items(plantilla_id, seccion, etiqueta, es_critico, orden) values
      (v_pl,'aptitud','Operador capacitado para el equipo', true, 1),
      (v_pl,'aptitud','EPP adecuado (guantes, lentes, protección auditiva)', true, 2),
      (v_pl,'seguridad','Carcasas y guardas de seguridad en su lugar', true, 3),
      (v_pl,'seguridad','Cables / mangueras sin daños', true, 4),
      (v_pl,'seguridad','Interruptor / parada de emergencia funciona', true, 5),
      (v_pl,'seguridad','Discos / brocas / accesorios en buen estado', false, 6),
      (v_pl,'seguridad','Nivel de combustible / aceite (si aplica)', false, 7),
      (v_pl,'seguridad','Sin fugas ni ruidos anómalos', false, 8),
      (v_pl,'seguridad','Área de trabajo despejada', false, 9),
      (v_pl,'seguridad','Extintor cercano disponible', false, 10);
  end if;
end $$;

-- 4) Rol "Encargado de Tecnología" (para operar el módulo A7, no solo admin) ---
insert into sgc.roles (codigo, nombre, modulos)
select 'encargado_tecnologia', 'Encargado de Tecnología', array['tecnologia']
where not exists (select 1 from sgc.roles where codigo = 'encargado_tecnologia');
