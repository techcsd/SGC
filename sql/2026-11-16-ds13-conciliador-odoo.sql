-- DS-13 (ronda DS, 16-nov-2026): conciliador SGC <-> Odoo de traslados (issue #113). ADITIVA.
-- Guarda las corridas del conciliador (diaria, sondeo de 5 min por write_date, transito > 72 h) y las discrepancias
-- abiertas/resueltas. La edge `odoo-conciliar` es la unica que escribe (service_role); Tecnologia solo lee.
-- Nada de esto escribe en Odoo. Sin hosts/usuarios/ids de Odoo en el repo (publico).

create table if not exists sgc.odoo_conciliacion_corridas (
  id uuid primary key default gen_random_uuid(),
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  tipo text not null check (tipo in ('diaria','sondeo','transito')),
  iniciada_en timestamptz not null default now(),
  terminada_en timestamptz,
  marca_agua timestamptz,               -- sondeo: mayor write_date visto en Odoo (ADR 17)
  resumen jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists odoo_conc_corridas_ix on sgc.odoo_conciliacion_corridas(odoo_instancia_id, tipo, iniciada_en desc);
alter table sgc.odoo_conciliacion_corridas enable row level security;
drop policy if exists odoo_conc_corridas_sel on sgc.odoo_conciliacion_corridas;
create policy odoo_conc_corridas_sel on sgc.odoo_conciliacion_corridas for select to authenticated using (sgc.es_tecnologia());
grant select on sgc.odoo_conciliacion_corridas to authenticated;
grant all on sgc.odoo_conciliacion_corridas to service_role;

create table if not exists sgc.odoo_discrepancias (
  id uuid primary key default gen_random_uuid(),
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  clave text not null,                  -- tipo|salida|picking: una fila por hallazgo, se reabre si reaparece
  tipo text not null check (tipo in ('sin_picking_a','picking_a_no_validado','cantidad_distinta','sin_picking_b','picking_b_no_validado',
                                     'picking_huerfano','transito_vencido','fuera_de_canal','saldo_distinto')),
  salida_id uuid references sgc.salidas_inventario(id) on delete set null,
  picking_id bigint,
  detalle text not null,
  primera_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  resuelta_en timestamptz,
  alertada_en timestamptz,
  unique (odoo_instancia_id, clave)
);
create index if not exists odoo_discrepancias_abiertas_ix on sgc.odoo_discrepancias(odoo_instancia_id, tipo) where resuelta_en is null;
alter table sgc.odoo_discrepancias enable row level security;
drop policy if exists odoo_discrepancias_sel on sgc.odoo_discrepancias;
create policy odoo_discrepancias_sel on sgc.odoo_discrepancias for select to authenticated using (sgc.es_tecnologia());
grant select on sgc.odoo_discrepancias to authenticated;
grant all on sgc.odoo_discrepancias to service_role;

insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_bodegas_piloto', '', 'DS-13: codigos de almacen de Odoo (codigo_odoo, separados por coma) vigilados por el conciliador (saldos y pickings fuera de canal). Vacio = no se vigila ninguno.'),
  ('odoo_transito_horas_max', '72', 'DS-13: horas maximas de material en transito (A hecho, sin B) antes de alertar.'),
  ('odoo_outbox_retraso_min', '5', 'DS-13: minutos de retraso del outbox de salidas que disparan alerta a Tecnologia.')
on conflict (clave) do nothing;

-- Salidas a conciliar: las que ya intentaron publicarse (tienen estado de sync) o ya traen pickings.
create or replace function sgc.odoo_conciliar_cargar(p_instancia uuid)
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (auth.role() = 'service_role' or sgc.es_tecnologia()) then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'estado', s.estado, 'es_prueba', coalesce(s.es_prueba, false), 'despachada_en', s.created_at,
      'lineas', coalesce((select jsonb_agg(jsonb_build_object('odoo_product_id', a.odoo_product_id, 'cantidad', d.cantidad, 'cantidad_recibida', d.cantidad_recibida))
                          from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id where d.salida_id = s.id and a.odoo_product_id is not null), '[]'::jsonb)))
    from sgc.salidas_inventario s
    where s.odoo_instancia_id = p_instancia and (s.odoo_sync_estado is not null or s.odoo_picking_salida_id is not null)), '[]'::jsonb);
end $fn$;

-- Saldos SGC por bodega piloto (para compararlos con stock.quant). Solo bodegas con codigo_odoo en la lista.
create or replace function sgc.odoo_conciliar_saldos(p_instancia uuid, p_codigos text[])
returns table (bodega_id uuid, bodega text, odoo_location_id bigint, articulo_id uuid, odoo_product_id bigint, cantidad numeric)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (auth.role() = 'service_role' or sgc.es_tecnologia()) then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;
  return query
    select b.id, b.nombre::text, b.odoo_location_id, a.id, a.odoo_product_id, coalesce(sb.cantidad, 0)
    from sgc.bodegas b
    join sgc.stock_por_bodega sb on sb.bodega_id = b.id
    join sgc.articulos a on a.id = sb.articulo_id and a.odoo_product_id is not null
    where b.odoo_instancia_id = p_instancia and b.codigo_odoo = any(p_codigos) and b.odoo_location_id is not null;
end $fn$;

-- Aviso a Tecnologia (roles tecnologia y encargado_tecnologia).
create or replace function sgc.odoo_notificar_tecnologia(p_titulo text, p_mensaje text, p_ruta text) returns void
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  perform sgc.notificar_rol('tecnologia', 'alerta', p_titulo, p_mensaje, p_ruta);
  perform sgc.notificar_rol('encargado_tecnologia', 'alerta', p_titulo, p_mensaje, p_ruta);
end $fn$;
revoke all on function sgc.odoo_notificar_tecnologia(text, text, text) from public, anon, authenticated;
grant execute on function sgc.odoo_notificar_tecnologia(text, text, text) to service_role;

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
    from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and estado in ('pendiente','reintento') and odoo_instancia_id = p_instancia;
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

-- Marca de agua del sondeo (ultima corrida correcta).
create or replace function sgc.odoo_conciliar_marca(p_instancia uuid)
returns timestamptz language sql stable security definer set search_path = sgc, pg_temp as $fn$
  select max(marca_agua) from sgc.odoo_conciliacion_corridas where odoo_instancia_id = p_instancia and tipo = 'sondeo' and error is null;
$fn$;

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
        where agregado_tipo = 'salida_inventario' and estado in ('pendiente','reintento') and odoo_instancia_id = v_inst), 0),
    'inciertos_abiertos', (select count(*) from sgc.salidas_inventario where odoo_instancia_id = v_inst and odoo_sync_estado = 'incierto'));
end $fn$;

revoke all on function sgc.odoo_conciliar_cargar(uuid), sgc.odoo_conciliar_saldos(uuid, text[]), sgc.odoo_conciliar_registrar(uuid, text, jsonb, text[], jsonb, timestamptz, text),
  sgc.odoo_conciliar_marca(uuid), sgc.odoo_conciliacion_estado() from public, anon;
grant execute on function sgc.odoo_conciliar_cargar(uuid), sgc.odoo_conciliar_saldos(uuid, text[]), sgc.odoo_conciliar_marca(uuid) to authenticated, service_role; -- gatean adentro
grant execute on function sgc.odoo_conciliar_registrar(uuid, text, jsonb, text[], jsonb, timestamptz, text) to service_role;
grant execute on function sgc.odoo_conciliacion_estado() to authenticated;

-- Crons (patron DL5: pg_net + secreto del vault). Diario 5:30 am RD (09:30 UTC); sondeo cada 5 min.
-- Solo disparan si hay exactamente una instancia habilitada.
create or replace function sgc.odoo_conciliar_disparar(p_tarea text) returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_inst uuid; v_n integer;
begin
  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then return; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada;
  perform net.http_post(url := sgc.edge_url('odoo-conciliar'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := jsonb_build_object('tarea', p_tarea, 'instancia_id', v_inst));
end $fn$;
revoke all on function sgc.odoo_conciliar_disparar(text) from public, anon, authenticated;
grant execute on function sgc.odoo_conciliar_disparar(text) to service_role;

do $$ begin perform cron.unschedule('sgc-odoo-conciliar-diario'); exception when others then null; end $$;
select cron.schedule('sgc-odoo-conciliar-diario', '30 9 * * *', $cron$ select sgc.odoo_conciliar_disparar('diaria') $cron$);
do $$ begin perform cron.unschedule('sgc-odoo-conciliar-sondeo'); exception when others then null; end $$;
select cron.schedule('sgc-odoo-conciliar-sondeo', '*/5 * * * *', $cron$ select sgc.odoo_conciliar_disparar('sondeo') $cron$);
