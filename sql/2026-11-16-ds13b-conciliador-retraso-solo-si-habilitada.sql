-- DS-13b: el retraso del outbox solo cuenta (y alerta) si la publicacion de salidas esta habilitada; apagada, la cola quieta es lo esperado.

-- Registra el resultado de una corrida: upsert de hallazgos, resuelve los que ya no aparecen (solo del alcance de la corrida)
-- y devuelve las metricas del conciliador. `p_alcance` = tipos que esta corrida sabe evaluar.
create or replace function sgc.odoo_conciliar_registrar(
  p_instancia uuid, p_tipo text, p_discrepancias jsonb, p_alcance text[], p_resumen jsonb, p_marca timestamptz default null, p_error text default null
) returns jsonb language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_corrida uuid; v_claves text[]; v_retraso numeric; v_umbral integer; v_alertar integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  insert into sgc.odoo_conciliacion_corridas (odoo_instancia_id, tipo, terminada_en, marca_agua, resumen, error)
    values (p_instancia, p_tipo, now(), p_marca, coalesce(p_resumen, '{}'::jsonb), p_error) returning id into v_corrida;
  if p_error is not null then return jsonb_build_object('corrida', v_corrida, 'error', p_error); end if;

  select coalesce(array_agg(x->>'clave'), '{}') into v_claves from jsonb_array_elements(coalesce(p_discrepancias, '[]'::jsonb)) x;

  insert into sgc.odoo_discrepancias (odoo_instancia_id, clave, tipo, salida_id, picking_id, detalle)
  select p_instancia, x->>'clave', x->>'tipo', nullif(x->>'salida_id','')::uuid, nullif(x->>'picking_id','')::bigint, x->>'detalle'
  from jsonb_array_elements(coalesce(p_discrepancias, '[]'::jsonb)) x
  on conflict (odoo_instancia_id, clave) do update
    set ultima_vez = now(), detalle = excluded.detalle,
        primera_vez = case when sgc.odoo_discrepancias.resuelta_en is not null then now() else sgc.odoo_discrepancias.primera_vez end,
        alertada_en = case when sgc.odoo_discrepancias.resuelta_en is not null then null else sgc.odoo_discrepancias.alertada_en end,
        resuelta_en = null;

  update sgc.odoo_discrepancias set resuelta_en = now()
   where odoo_instancia_id = p_instancia and resuelta_en is null and tipo = any(p_alcance) and not (clave = any(v_claves));

  -- Metricas: retraso del outbox de salidas (min), inciertos abiertos, deriva > 24 h.
  select coalesce(extract(epoch from (now() - min(creado_en))) / 60, 0) into v_retraso
    from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and estado in ('pendiente','reintento') and odoo_instancia_id = p_instancia
       and exists (select 1 from sgc.odoo_publicacion_politica pp where pp.agregado_tipo = 'salida_inventario' and pp.habilitada);
  select coalesce(nullif(valor,'')::integer, 5) into v_umbral from sgc.parametros where clave = 'odoo_outbox_retraso_min';
  v_umbral := coalesce(v_umbral, 5);

  -- Alerta una sola vez por hallazgo de transito vencido; y una por hora si el outbox va atrasado.
  with al as (update sgc.odoo_discrepancias set alertada_en = now()
      where odoo_instancia_id = p_instancia and tipo = 'transito_vencido' and resuelta_en is null and alertada_en is null returning 1)
  select count(*) into v_alertar from al;
  if v_alertar > 0 then
    perform sgc.odoo_notificar_tecnologia('Material en tránsito vencido',
      v_alertar || ' conduce(s) llevan más de ' || coalesce((select valor from sgc.parametros where clave = 'odoo_transito_horas_max'), '72') || ' h en tránsito en Odoo.', '/tecnologia/odoo-conciliacion');
  end if;
  if v_retraso > v_umbral and not exists (select 1 from sgc.notificaciones where tipo = 'alerta' and titulo = 'Cola de Odoo atrasada' and created_at > now() - interval '1 hour') then
    perform sgc.odoo_notificar_tecnologia('Cola de Odoo atrasada',
      'Hay conduces esperando publicarse en Odoo hace ' || round(v_retraso)::text || ' min.', '/tecnologia/odoo-sync');
  end if;

  return jsonb_build_object('corrida', v_corrida, 'retraso_outbox_min', round(v_retraso),
    'inciertos_abiertos', (select count(*) from sgc.salidas_inventario where odoo_instancia_id = p_instancia and odoo_sync_estado = 'incierto'),
    'deriva_24h', (select count(*) from sgc.odoo_discrepancias where odoo_instancia_id = p_instancia and resuelta_en is null and primera_vez < now() - interval '24 hours'),
    'abiertas', (select count(*) from sgc.odoo_discrepancias where odoo_instancia_id = p_instancia and resuelta_en is null));
end $fn$;

-- Pantalla de Tecnologia: hallazgos + ultimas corridas + metricas (AT11: todo lo conciliado se ve).
create or replace function sgc.odoo_conciliacion_estado()
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_inst uuid;
begin
  if not sgc.es_tecnologia() then raise exception 'Solo Tecnologia puede ver la conciliacion con Odoo' using errcode = '42501'; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada limit 1;
  return jsonb_build_object(
    'instancia', v_inst is not null,
    'discrepancias', coalesce((select jsonb_agg(to_jsonb(d)) from (
        select x.id, x.tipo, x.salida_id, x.picking_id, x.detalle, x.primera_vez, x.ultima_vez, x.resuelta_en, 'CND-' || upper(left(replace(x.salida_id::text,'-',''),8)) as salida_folio
        from sgc.odoo_discrepancias x left join sgc.salidas_inventario s on s.id = x.salida_id
        where x.odoo_instancia_id = v_inst and (x.resuelta_en is null or x.resuelta_en > now() - interval '7 days')
        order by x.resuelta_en nulls first, x.primera_vez limit 500) d), '[]'::jsonb),
    'corridas', coalesce((select jsonb_agg(to_jsonb(c)) from (
        select tipo, iniciada_en, terminada_en, resumen, error from sgc.odoo_conciliacion_corridas
        where odoo_instancia_id = v_inst order by iniciada_en desc limit 20) c), '[]'::jsonb),
    'retraso_outbox_min', coalesce((select round(extract(epoch from (now() - min(creado_en))) / 60) from sgc.odoo_eventos
        where agregado_tipo = 'salida_inventario' and estado in ('pendiente','reintento') and odoo_instancia_id = v_inst
        and exists (select 1 from sgc.odoo_publicacion_politica pp where pp.agregado_tipo = 'salida_inventario' and pp.habilitada)), 0),
    'inciertos_abiertos', (select count(*) from sgc.salidas_inventario where odoo_instancia_id = v_inst and odoo_sync_estado = 'incierto'));
end $fn$;

