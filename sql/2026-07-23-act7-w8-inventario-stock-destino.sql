-- ============================================================================
-- W8 — Inventario server-side: stock consultable, validación estructurada y
-- notificación al almacén destino. Todo aditivo/retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────
-- (1) Stock consultable por artículo+bodega para el picker de la app.
--     Devuelve SIEMPRE una fila con cantidad (0, nunca NULL — cuida el caso T13)
--     + la unidad del artículo, para pintar "Hay N {unidad} en {bodega}".
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sgc.stock_articulo_bodega(p_articulo_id uuid, p_bodega_id uuid)
returns table(cantidad numeric, unidad text)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(s.cantidad, 0)::numeric as cantidad,
         a.unidad::text                    as unidad
  from sgc.articulos a
  left join sgc.stock_por_bodega s
    on s.articulo_id = a.id and s.bodega_id = p_bodega_id
  where a.id = p_articulo_id;
$function$;

grant execute on function sgc.stock_articulo_bodega(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (2) Validación estructurada en la salida de la app: al rechazar por
--     existencias, además del mensaje legible (retrocompat), adjunta un DETAIL
--     JSON con la lista de faltantes (artículo, disponible, solicitado) que la
--     app puede pintar antes y después. Idéntica salvo el `raise`.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sgc.registrar_salida_app(p_id uuid, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_items jsonb, p_foto_path text DEFAULT NULL::text, p_capturado_en timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_item          jsonb;
  v_stock         numeric;
  v_nombre        text;
  v_bodega_nombre text;
  v_solicitado    numeric;
  v_faltantes     text[] := array[]::text[];
  v_faltantes_j   jsonb  := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.salidas_inventario where id = p_id) then
    return p_id;
  end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad, 0)
      into v_nombre, v_stock
    from sgc.articulos a
    left join sgc.stock_por_bodega s
      on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;

    v_nombre := coalesce(v_nombre, 'artículo desconocido');
    v_stock := coalesce(v_stock, 0);

    if v_stock < v_solicitado then
      v_faltantes := v_faltantes || format(
        'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega_nombre,
        trim(to_char(v_stock, 'FM999999990.###')),
        trim(to_char(v_solicitado, 'FM999999990.###'))
      );
      v_faltantes_j := v_faltantes_j || jsonb_build_object(
        'articulo_id', v_item->>'articulo_id',
        'articulo', v_nombre,
        'bodega', v_bodega_nombre,
        'disponible', v_stock,
        'solicitado', v_solicitado
      );
    end if;
  end loop;

  if array_length(v_faltantes, 1) > 0 then
    -- SQLSTATE P0001 (raise por defecto): la app ya lo clasifica como error
    -- permanente y legible. El `hint`/`detail` añaden la estructura sin cambiar
    -- esa clasificación (evita reintentos infinitos del outbox).
    raise exception '%', array_to_string(v_faltantes, E'\n')
      using hint = 'sin_existencias',
            detail = jsonb_build_object('faltantes', v_faltantes_j)::text;
  end if;

  insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, creado_por, foto_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_proyecto_id, coalesce(p_motivo, 'Consumo en obra'), auth.uid(), p_foto_path);

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', '')
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- (3) Notificación al almacén destino cuando una salida sale despachada hacia
--     una obra. Trigger genérico (cubre web y app): al pasar a 'despachado' con
--     proyecto destino, avisa al equipo de esa obra ("Entrega en camino").
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sgc.tg_notificar_salida_despachada()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_origen text;
  v_proy   text;
  u record;
begin
  -- Solo al ENTRAR en 'despachado' con destino de obra (evita re-notificar).
  if new.proyecto_id is null then return new; end if;
  if new.estado is distinct from 'despachado' then return new; end if;
  if tg_op = 'UPDATE' and old.estado is not distinct from new.estado then return new; end if;

  select nombre into v_origen from sgc.bodegas where id = new.bodega_id;
  select nombre into v_proy   from sgc.proyectos where id = new.proyecto_id;

  -- Notificar al equipo de la obra destino (los que confirman la recepción).
  for u in
    select distinct e.usuario_id
    from sgc.proyecto_empleados pe
    join sgc.empleados e on e.id = pe.empleado_id
    where pe.proyecto_id = new.proyecto_id and e.usuario_id is not null
  loop
    perform sgc.notificar(
      u.usuario_id, 'info',
      'Entrega en camino',
      format('Material despachado desde %s hacia %s. Confírmalo al recibirlo.',
             coalesce(v_origen,'el almacén'), coalesce(v_proy,'la obra')),
      '/bitacora/entregas?item=' || new.id::text
    );
  end loop;

  return new;
end;
$function$;

drop trigger if exists trg_notificar_salida_despachada on sgc.salidas_inventario;
create trigger trg_notificar_salida_despachada
  after insert or update of estado on sgc.salidas_inventario
  for each row execute function sgc.tg_notificar_salida_despachada();
