-- 2026-11-21 — #202: al emitir un conduce, la autoridad del stock es Odoo (no stock_por_bodega).
-- También: el conteo de la app y el ajuste real, en almacenes con fuente Odoo, se publican
-- como conteo físico (inventory_quantity), con odoo_sync_estado=pendiente hasta que Odoo confirme.
-- Aditiva y retrocompatible (firma de registrar_salida_inventario y registrar_conteo_app se conserva).

begin;

-- ── 1) adjust_stock: en fuente Odoo la proyección puede quedar transitoriamente
--    por debajo de cero (Odoo manda; el sondeo corrige). Sin esto, un conduce
--    válido en Odoo fallaba si SGC tenía 0 por el sondeo o por un artículo nuevo.
create or replace function sgc.adjust_stock(p_articulo_id uuid, p_bodega_id uuid, p_delta numeric)
returns void
language plpgsql
as $function$
declare
  v_actual numeric;
  v_fuente boolean;
begin
  select cantidad into v_actual
  from sgc.stock_por_bodega
  where articulo_id = p_articulo_id and bodega_id = p_bodega_id
  for update;

  v_fuente := exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo);
  if v_fuente then perform set_config('sgc.odoo_proyectando', 'true', true); end if;

  if not found then
    if p_delta < 0 and not v_fuente then
      raise exception 'Stock insuficiente: no hay existencias registradas para este artículo en esta bodega.';
    end if;
    insert into sgc.stock_por_bodega (articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, p_delta, now());
  else
    if (v_actual + p_delta) < 0 and not v_fuente then
      raise exception 'Stock insuficiente: disponible %, solicitado %.', v_actual, abs(p_delta);
    end if;
    update sgc.stock_por_bodega
    set cantidad = v_actual + p_delta, updated_at = now()
    where articulo_id = p_articulo_id and bodega_id = p_bodega_id;
  end if;

  if v_fuente then perform set_config('sgc.odoo_proyectando', 'false', true); end if;
end;
$function$;

-- ── 2) registrar_salida_inventario: si la bodega tiene fuente Odoo, no se valida
--    contra stock_por_bodega (está desfasado respecto de Odoo). La validación viva
--    la hace el gateway (salidas.emitir). Ajustes de sesión (solo service_role, vía
--    el wrapper): omitir tras validar Odoo, o forzar SGC en contingencia.
create or replace function sgc.registrar_salida_inventario(p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid, p_es_prueba boolean DEFAULT false)
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
  v_responsable   text := p_responsable;
  v_items_key     text;
  v_existente     uuid;
  v_fuente        boolean;
  v_validar       boolean;
begin
  if p_responsable_id is not null then
    select coalesce(nombre, p_responsable) into v_responsable from sgc.usuarios where id = p_responsable_id;
    v_responsable := coalesce(v_responsable, p_responsable);
  end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');
  v_fuente := exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo);

  select string_agg(format('%s:%s', i->>'articulo_id', (i->>'cantidad')::numeric(10,2)), ',' order by i->>'articulo_id')
    into v_items_key
    from jsonb_array_elements(p_items) i;

  select si.id into v_existente
    from sgc.salidas_inventario si
   where si.creado_por = p_creado_por
     and si.bodega_id = p_bodega_id
     and coalesce(si.proyecto_id::text,'') = coalesce(p_proyecto_id::text,'')
     and coalesce(si.motivo,'') = coalesce(p_motivo,'')
     and si.created_at > now() - interval '120 seconds'
     and v_items_key is not null
     and v_items_key = (
       select string_agg(format('%s:%s', d.articulo_id, d.cantidad::numeric(10,2)), ',' order by d.articulo_id)
         from sgc.detalle_salidas d where d.salida_id = si.id
     )
   order by si.created_at asc
   limit 1;
  if v_existente is not null then
    return v_existente;
  end if;

  -- Prueba: no valida. Fuente Odoo: no valida contra SGC, salvo forzar (contingencia).
  -- Omitir: el gateway ya validó contra Odoo en esta misma petición.
  v_validar := not coalesce(p_es_prueba, false)
    and coalesce(current_setting('sgc.omitir_validacion_stock', true), '') <> 'true'
    and (
      coalesce(current_setting('sgc.validar_stock_sgc', true), '') = 'true'
      or not v_fuente
    );

  if v_validar then
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
  end if;

  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, responsable_id, observaciones, creado_por, es_prueba)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, v_responsable, p_responsable_id, p_observaciones, p_creado_por,
          coalesce(p_es_prueba, false))
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla, unidad_capturada, factor_aplicado, origen_item_id)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1),
         nullif(i->>'origen_item_id', '')::uuid
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;

grant execute on function sgc.registrar_salida_inventario(date,uuid,uuid,text,character varying,text,uuid,jsonb,uuid,boolean) to authenticated, service_role;

-- Wrapper usado SOLO por el gateway (service_role): fija el modo de validación y llama a la RPC viva.
create or replace function sgc.registrar_salida_conduce_odoo(
  p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_responsable character varying,
  p_observaciones text, p_creado_por uuid, p_items jsonb, p_responsable_id uuid default null,
  p_modo text default 'auto'
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el servicio puede emitir un conduce validado contra Odoo.' using errcode = '42501';
  end if;
  if p_modo = 'odoo' then
    perform set_config('sgc.omitir_validacion_stock', 'true', true);
  elsif p_modo = 'sgc' then
    perform set_config('sgc.validar_stock_sgc', 'true', true);
  end if;
  return sgc.registrar_salida_inventario(
    p_fecha, p_bodega_id, p_proyecto_id, p_motivo, p_responsable, p_observaciones,
    p_creado_por, p_items, p_responsable_id, false
  );
end;
$fn$;
revoke all on function sgc.registrar_salida_conduce_odoo(date,uuid,uuid,text,character varying,text,uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function sgc.registrar_salida_conduce_odoo(date,uuid,uuid,text,character varying,text,uuid,jsonb,uuid,text) to service_role;
comment on function sgc.registrar_salida_conduce_odoo is
  '#202 — el gateway valida existencias en Odoo (modo odoo) o, en contingencia, en SGC (modo sgc) y luego registra el conduce.';

-- ── 3) Contexto de almacenes para el formulario de conduces (homologación + fuente).
create or replace function sgc.bodegas_conduce_odoo()
returns table (
  bodega_id uuid, nombre text, odoo_warehouse_id bigint, odoo_location_id bigint,
  codigo_odoo text, fuente_odoo boolean, homologada boolean, contingencia boolean
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select b.id, b.nombre::text, b.odoo_warehouse_id, b.odoo_location_id, b.codigo_odoo::text,
         exists (select 1 from sgc.odoo_corte_bodega o where o.bodega_id = b.id and o.fuente_odoo),
         b.odoo_location_id is not null,
         exists (select 1 from sgc.odoo_contingencias k where k.bodega_id = b.id and k.vigente_hasta > now())
    from sgc.bodegas b
   where auth.uid() is not null
     and coalesce(b.activo, true)
$$;
revoke all on function sgc.bodegas_conduce_odoo() from public, anon;
grant execute on function sgc.bodegas_conduce_odoo() to authenticated;
comment on function sgc.bodegas_conduce_odoo is
  '#202 — almacenes visibles en el conduce, con vínculo y fuente de stock Odoo. Sin secretos.';

-- ── 4) Bandeja de sincronización: folio, almacén y error en la fila; reintento en lote.
drop function if exists sgc.odoo_eventos_listar(text, text, integer);
create function sgc.odoo_eventos_listar(
  p_agregado_tipo text default null, p_estado text default null, p_limite integer default 200
)
returns table (
  id uuid, agregado_tipo text, agregado_id text, accion text, revision integer,
  estado text, intentos integer, es_prueba boolean, error text,
  creado_en timestamptz, actualizado_en timestamptz,
  folio text, almacen text
)
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
begin
  if not sgc.es_tecnologia() then
    raise exception 'Solo Tecnología puede ver la sincronización con Odoo' using errcode = '42501';
  end if;
  return query
    select e.id, e.agregado_tipo, e.agregado_id, e.accion, e.revision,
           e.estado, e.intentos, e.es_prueba, e.error, e.creado_en, e.actualizado_en,
           case when e.agregado_tipo = 'salida_inventario' and s.id is not null
                then 'CND-' || upper(substr(s.id::text, 1, 8))
                else null end,
           case when e.agregado_tipo = 'salida_inventario' then b.nombre::text else null end
    from sgc.odoo_eventos e
    left join sgc.salidas_inventario s
      on e.agregado_tipo = 'salida_inventario' and s.id::text = e.agregado_id
    left join sgc.bodegas b on b.id = s.bodega_id
    where (p_agregado_tipo is null or e.agregado_tipo = p_agregado_tipo)
      and (p_estado is null or e.estado = p_estado)
    order by e.creado_en desc
    limit greatest(1, least(500, coalesce(p_limite, 200)));
end;
$fn$;
comment on function sgc.odoo_eventos_listar is
  'CY16 + #202 — bandeja del outbox Odoo para Tecnología, con folio y almacén en salidas.';
revoke all on function sgc.odoo_eventos_listar(text, text, integer) from public, anon;
grant execute on function sgc.odoo_eventos_listar(text, text, integer) to authenticated;

create or replace function sgc.odoo_eventos_reintentar_lote(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not sgc.es_tecnologia() then
    raise exception 'Solo Tecnología puede reintentar una sincronización con Odoo' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;
  if array_length(p_ids, 1) > 50 then
    raise exception 'Puedes reintentar como máximo 50 eventos a la vez.' using errcode = '22023';
  end if;
  foreach v_id in array p_ids loop
    begin
      if sgc.odoo_evento_reintentar(v_id) then
        v_n := v_n + 1;
      end if;
    exception when others then
      -- un evento no reintentable no tira el lote
      null;
    end;
  end loop;
  return v_n;
end;
$fn$;
comment on function sgc.odoo_eventos_reintentar_lote is
  '#202 — reencola hasta 50 eventos (error/incierto/bloqueado) para el mismo procesador. No ajusta stock.';
revoke all on function sgc.odoo_eventos_reintentar_lote(uuid[]) from public, anon;
grant execute on function sgc.odoo_eventos_reintentar_lote(uuid[]) to authenticated;

-- ── 5) Helper: crea un conteo físico YA APLICADO y lo deja pendiente de Odoo.
--    Lo usan el conteo de la app y el ajuste real en almacenes con fuente Odoo.
create or replace function sgc._conteo_aplicado_publicable(
  p_id uuid,
  p_bodega_id uuid,
  p_items jsonb,
  p_motivo text,
  p_observaciones text,
  p_creado_por uuid
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'public'
as $fn$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_row jsonb;
  v_art uuid;
  v_cant numeric;
  v_antes numeric;
  v_sigma numeric;
  v_nombre text;
  v_sin text[] := array[]::text[];
  v_n int := 0;
  v_homologada boolean;
begin
  if exists (select 1 from sgc.conteos_inventario where id = v_id) then
    return v_id;
  end if;

  select odoo_location_id is not null into v_homologada from sgc.bodegas where id = p_bodega_id;
  if not coalesce(v_homologada, false) then
    raise exception 'El almacén no está homologado con Odoo.' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_art := nullif(v_row->>'articulo_id','')::uuid;
    v_cant := coalesce(nullif(v_row->>'cantidad_contada','')::numeric, (v_row->>'cantidad')::numeric);
    if v_art is null or v_cant is null then
      raise exception 'Cada renglón del conteo necesita artículo y cantidad.' using errcode = '22023';
    end if;
    if v_cant < 0 then
      raise exception 'La cantidad contada no puede ser negativa.' using errcode = '22023';
    end if;
    select a.nombre into v_nombre from sgc.articulos a where a.id = v_art;
    if v_nombre is null then
      raise exception 'Hay un artículo que no existe en el catálogo.' using errcode = '22023';
    end if;
    if not exists (select 1 from sgc.articulos a where a.id = v_art and a.odoo_product_id is not null) then
      v_sin := v_sin || v_nombre;
    end if;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'El conteo no tiene ninguna cantidad registrada.' using errcode = '22023';
  end if;
  if array_length(v_sin, 1) is not null then
    raise exception 'Estos artículos no están homologados con Odoo: %. Vincúlalos y reintenta.', array_to_string(v_sin, ', ')
      using errcode = '22023';
  end if;

  insert into sgc.conteos_inventario (
    id, bodega_id, motivo, tipo, estado, observaciones, creado_por,
    fecha_conteo, cerrado_por, aprobado_por, aplicado_at,
    odoo_sync_estado, odoo_sync_error
  ) values (
    v_id, p_bodega_id, coalesce(nullif(trim(p_motivo), ''), 'Conteo físico'),
    'conteo_fisico', 'aplicado', p_observaciones, p_creado_por,
    (now() at time zone 'America/Santo_Domingo')::date,
    p_creado_por, p_creado_por, now(),
    'pendiente', null
  );

  for v_row in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_art := nullif(v_row->>'articulo_id','')::uuid;
    v_cant := coalesce(nullif(v_row->>'cantidad_contada','')::numeric, (v_row->>'cantidad')::numeric);
    select coalesce(cantidad, 0) into v_antes
      from sgc.stock_por_bodega
     where articulo_id = v_art and bodega_id = p_bodega_id;
    v_antes := coalesce(v_antes, 0);
    v_sigma := sgc.stock_movimientos_sigma(v_art, p_bodega_id);
    insert into sgc.conteo_items (conteo_id, articulo_id, cantidad_antes, cantidad_contada, apertura_antes)
    values (v_id, v_art, v_antes, v_cant, sgc.apertura_efectiva(v_art, p_bodega_id));
    perform sgc._aplicar_apertura(v_art, p_bodega_id, v_cant - v_sigma, p_creado_por,
                                  coalesce(nullif(trim(p_motivo), ''), 'Conteo físico'));
  end loop;

  return v_id;
end;
$fn$;
revoke all on function sgc._conteo_aplicado_publicable(uuid, uuid, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function sgc._conteo_aplicado_publicable(uuid, uuid, jsonb, text, text, uuid) to service_role;
-- La llaman otras RPC SECURITY DEFINER de este esquema (mismo owner); no se otorga a authenticated.

-- ── 6) registrar_conteo_app: en fuente Odoo crea un conteo físico publicable
--    (no un adjust_stock que el sondeo de 5 min revierte) y nace en pendiente.
create or replace function sgc.registrar_conteo_app(
  p_id uuid, p_bodega_id uuid, p_motivo text, p_items jsonb,
  p_observaciones text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_item     jsonb;
  v_antes    numeric;
  v_contada  numeric;
  v_ajustes  int := 0;
  v_total    int := 0;
  v_fuente   boolean;
  v_items    jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.conteos_inventario where id = p_id) then
    return p_id;
  end if;

  v_fuente := exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo)
              or exists (select 1 from sgc.bodegas where id = p_bodega_id and odoo_location_id is not null);

  if v_fuente then
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'articulo_id', v_item->>'articulo_id',
        'cantidad_contada', (v_item->>'cantidad_contada')::numeric
      ));
    end loop;
    return sgc._conteo_aplicado_publicable(
      p_id, p_bodega_id, v_items,
      coalesce(p_motivo, 'Conteo físico'),
      p_observaciones, auth.uid()
    );
  end if;

  -- Almacén aún no gobernado por Odoo: se mantiene el ajuste local (sin outbox).
  insert into sgc.conteos_inventario (id, bodega_id, motivo, creado_por, observaciones, tipo, estado)
  values (p_id, p_bodega_id, coalesce(p_motivo, 'Conteo físico'), auth.uid(), p_observaciones, 'ajuste', 'aplicado');

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_total := v_total + 1;
    v_contada := (v_item->>'cantidad_contada')::numeric;
    select coalesce(cantidad, 0) into v_antes
    from sgc.stock_por_bodega
    where articulo_id = (v_item->>'articulo_id')::uuid and bodega_id = p_bodega_id;
    v_antes := coalesce(v_antes, 0);

    insert into sgc.conteo_items (conteo_id, articulo_id, cantidad_antes, cantidad_contada)
    values (p_id, (v_item->>'articulo_id')::uuid, v_antes, v_contada);

    if v_contada <> v_antes then
      v_ajustes := v_ajustes + 1;
      perform sgc.adjust_stock((v_item->>'articulo_id')::uuid, p_bodega_id, v_contada - v_antes);
    end if;
  end loop;

  if v_ajustes = 0 and p_observaciones is null then
    update sgc.conteos_inventario
       set observaciones = case
             when v_total = 0 then 'Todo conforme — sin diferencias (conteo confirmado)'
             else 'Todo conforme — ' || v_total || ' artículos verificados, sin diferencias'
           end
     where id = p_id;
  end if;

  return p_id;
end;
$function$;
grant execute on function sgc.registrar_conteo_app(uuid, uuid, text, jsonb, text) to authenticated, service_role;
comment on function sgc.registrar_conteo_app is
  '#202 — en almacenes con fuente/vínculo Odoo crea un conteo físico aplicado y lo deja pendiente de publicar (nunca «sincronizado» hasta que Odoo confirme). En el resto, ajusta solo SGC.';

-- ── 7) set_apertura: en fuente Odoo NO corrige existencias (el sondeo las revierte
--    y publicar una apertura como ajuste duplicaría historia en Odoo, criterio 4).
create or replace function sgc.set_apertura(p_articulo_id uuid, p_bodega_id uuid, p_cantidad numeric, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede editar el dato de apertura.' using errcode = '42501';
  end if;
  if exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo) then
    raise exception 'En un almacén gobernado por Odoo no se puede cambiar la existencia con la apertura. Usa un conteo físico o un ajuste real para que quede publicado en Odoo.'
      using errcode = 'P0001';
  end if;
  perform sgc._aplicar_apertura(p_articulo_id, p_bodega_id, p_cantidad, auth.uid(),
                                coalesce(nullif(trim(p_motivo), ''), 'Ajuste de apertura'));
end;
$function$;
grant execute on function sgc.set_apertura(uuid, uuid, numeric, text) to authenticated;

-- ── 8) ajuste_real_stock / lote: en fuente Odoo se publican como conteo físico.
create or replace function sgc.ajuste_real_stock(p_articulo_id uuid, p_bodega_id uuid, p_cantidad_real numeric, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'sgc', 'public' as $function$
declare v_sigma numeric; v_fuente boolean;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede hacer el ajuste real' using errcode = '42501';
  end if;
  if p_cantidad_real is null or p_cantidad_real < 0 then
    raise exception 'La cantidad real no puede ser negativa' using errcode = 'AT400';
  end if;
  v_fuente := exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo);
  if v_fuente then
    perform sgc._conteo_aplicado_publicable(
      gen_random_uuid(), p_bodega_id,
      jsonb_build_array(jsonb_build_object('articulo_id', p_articulo_id, 'cantidad_contada', p_cantidad_real)),
      coalesce(nullif(trim(p_motivo), ''), 'Ajuste real de existencia'),
      'Origen: ajuste real (web)', auth.uid()
    );
    return;
  end if;
  v_sigma := sgc.stock_movimientos_sigma(p_articulo_id, p_bodega_id);
  perform sgc._aplicar_apertura(p_articulo_id, p_bodega_id, p_cantidad_real - v_sigma, auth.uid(),
                                coalesce(nullif(trim(p_motivo), ''), 'Ajuste real de existencia'));
end;
$function$;
grant execute on function sgc.ajuste_real_stock(uuid, uuid, numeric, text) to authenticated, service_role;

create or replace function sgc.ajuste_real_lote(p_bodega_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'sgc', 'public' as $function$
declare
  v_row jsonb; v_i int := 0; v_ok int := 0; v_err jsonb := '[]'::jsonb;
  v_art uuid; v_cant numeric; v_items jsonb := '[]'::jsonb; v_fuente boolean;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede hacer el ajuste real' using errcode = '42501';
  end if;
  v_fuente := exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo);
  if v_fuente then
    for v_row in select * from jsonb_array_elements(p_rows) loop
      v_i := v_i + 1;
      v_art := nullif(v_row->>'articulo_id','')::uuid;
      v_cant := (v_row->>'cantidad')::numeric;
      if v_art is null then
        v_err := v_err || jsonb_build_object('fila', v_i, 'msg', 'Sin artículo'); continue;
      end if;
      if v_cant is null or v_cant < 0 then
        v_err := v_err || jsonb_build_object('fila', v_i, 'articulo_id', v_row->>'articulo_id', 'msg', 'Cantidad inválida'); continue;
      end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object('articulo_id', v_art, 'cantidad_contada', v_cant));
      v_ok := v_ok + 1;
    end loop;
    if v_ok > 0 then
      begin
        perform sgc._conteo_aplicado_publicable(
          gen_random_uuid(), p_bodega_id, v_items,
          'Ajuste real de existencia', 'Origen: ajuste real en lote (web)', auth.uid()
        );
      exception when others then
        return jsonb_build_object('ok', 0, 'errores', v_err || jsonb_build_object('fila', 0, 'msg', SQLERRM));
      end;
    end if;
    return jsonb_build_object('ok', v_ok, 'errores', v_err);
  end if;
  v_i := 0; v_ok := 0;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      v_art := nullif(v_row->>'articulo_id','')::uuid;
      v_cant := (v_row->>'cantidad')::numeric;
      if v_art is null then
        v_err := v_err || jsonb_build_object('fila', v_i, 'msg', 'Sin artículo'); continue;
      end if;
      perform sgc.ajuste_real_stock(v_art, p_bodega_id, v_cant);
      v_ok := v_ok + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('fila', v_i, 'articulo_id', v_row->>'articulo_id', 'msg', SQLERRM);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errores', v_err);
end;
$function$;
grant execute on function sgc.ajuste_real_lote(uuid, jsonb) to authenticated, service_role;

comment on function sgc.set_apertura(uuid, uuid, numeric, text) is
  'AP5 — fija la apertura en SGC. En almacenes con fuente Odoo se rechaza: hay que usar conteo físico o ajuste real para publicar en Odoo.';
comment on function sgc.ajuste_real_stock(uuid, uuid, numeric, text) is
  'AT12 + #202 — fija la existencia real. En almacenes con fuente Odoo crea un conteo físico publicable (pendiente hasta que Odoo confirme).';

commit;
