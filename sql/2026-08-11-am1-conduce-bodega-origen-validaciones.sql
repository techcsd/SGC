-- =============================================================================
-- PROMPT-5 FASE 1 (AM1) — Ronda 11/08/2026 (IDs AM). SGC padre.
-- 🔴 BLOQUEANTE DE PRODUCCIÓN: emitir un conduce falla con
--    `null value in column "bodega_id" of relation "salidas_inventario"`.
--    Caso: origen = almacén de la obra "911" (ROSCH - Edif Adm 911), destino =
--    "devolver a ferretería" (devolución a suplidor). La app arma el payload del
--    outbox sin resolver la bodega de origen → llega null → revienta el NOT NULL.
--
-- CAUSA RAÍZ (confirmada): TODO conduce se inserta vía
--   crear_conduce_simple → crear_conduce_transportista (AF23/AI2/AL10), y ese
--   insert usa `bodega_id = p_bodega_id` DIRECTO, sin resolver la bodega de la
--   obra ni validar que exista/esté activa. El resolutor canónico AH9
--   (destinos_transporte) sí expone la bodega resuelta por obra, pero la RPC de
--   creación nunca lo usa. En la devolución a suplidor el destino NO es una obra
--   (proyecto_id null), así que el ORIGEN debe venir explícito — y ahí es donde
--   la app lo mandaba null.
--
-- FIX (server-side, aditivo, retrocompatible):
--   1) resolver_bodega_origen(): resolutor canónico reutilizable (bodega directa
--      válida → si no, bodega principal de la obra → si no, null).
--   2) crear_conduce_transportista(): resuelve el origen SIEMPRE y valida con
--      errores ESTRUCTURADOS y accionables (nunca un constraint crudo):
--        · DR451 — no se pudo determinar el almacén de origen.
--        · DR452 — el almacén de origen no existe o está inactivo.
--        · DR453 — no hay existencia suficiente de un item (ya existía; ahora con
--                  errcode para que la app lo muestre accionable).
--        · DR454 — el conduce no lleva items.
--   3) crear_conduce_devolucion_suplidor(): contrato EXPLÍCITO para "devolver a
--      ferretería" — la bodega de ORIGEN es un parámetro nombrado y obligatorio
--      (el bug no puede repetirse), sin destino de obra/almacén, motivo
--      'devolucion'. La salida descuenta del almacén de origen y no requiere
--      bodega destino (AM1-e).
--
-- Nada de esto relaja validaciones: sólo hace la emisión MÁS robusta.
-- =============================================================================

begin;

-- ── 1) Resolutor canónico de la bodega de ORIGEN ─────────────────────────────
-- Reemplaza la resolución obra→bodega que hoy está duplicada inline en varias
-- RPC (crear_conduce_*, chofer_registrar_devolucion, registrar_devolucion_obra,
-- conduce_confirmar_receptor). Devuelve la bodega si es válida+activa; si no,
-- resuelve la bodega principal (o la más antigua) de la obra; si no, null.
create or replace function sgc.resolver_bodega_origen(
  p_bodega_id uuid, p_proyecto_id uuid default null)
returns uuid
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(
    -- (a) bodega directa, sólo si existe y está activa
    (select b.id from sgc.bodegas b
      where b.id = p_bodega_id and coalesce(b.activo, true)),
    -- (b) bodega de la obra (principal primero, luego la más antigua)
    (select b.id from sgc.bodegas b
      where b.proyecto_id = p_proyecto_id and coalesce(b.activo, true)
      order by coalesce(b.es_principal, false) desc, b.created_at asc nulls last
      limit 1)
  );
$$;
grant execute on function sgc.resolver_bodega_origen(uuid, uuid) to authenticated, service_role;
comment on function sgc.resolver_bodega_origen(uuid, uuid) is
  'AM1 — resuelve la bodega de ORIGEN de un movimiento: bodega directa válida+activa; si no, la bodega principal/activa de la obra; si no, null. Fuente única (reemplaza la resolución inline duplicada).';

-- ── 2) crear_conduce_transportista: resolver origen + validar (estructurado) ──
-- Misma firma (8 args). Fiel al comportamiento AF23 (auto-ruta, detalle, es_prueba)
-- salvo: (a) resuelve la bodega de origen ANTES de insertar, (b) valida con
-- errcodes claros en vez de reventar el NOT NULL o soltar un texto pelado.
create or replace function sgc.crear_conduce_transportista(
  p_id uuid, p_fecha date, p_bodega_id uuid, p_proyecto_id uuid,
  p_observaciones text, p_vehiculo_id uuid, p_ruta_id uuid, p_items jsonb)
 returns uuid
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_cond_id    uuid;
  v_elevado    boolean;
  v_item       jsonb;
  v_stock      numeric; v_nombre text; v_bodega text; v_sol numeric;
  v_faltantes  text[] := array[]::text[];
  v_bodega_id  uuid;                    -- AM1: origen RESUELTO
  v_n_items    int;
  -- AF23 auto-ruta
  v_ruta       uuid := p_ruta_id;
  v_parada     uuid;
  v_dest       text;
  v_orden      int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  v_elevado := sgc.is_admin() or sgc.tiene_modulo('inventario');
  select id into v_cond_id from sgc.conductores where usuario_id = v_uid and coalesce(activo,true) limit 1;

  if not (v_elevado or v_cond_id is not null) then
    raise exception 'Tu usuario no puede crear conduces (no es transportista ni tiene el módulo Inventario).';
  end if;

  if p_id is not null and exists (select 1 from sgc.salidas_inventario where id = p_id) then
    return p_id;   -- idempotente (reintento de outbox)
  end if;

  -- AM1 (a) — resolver la bodega de ORIGEN de forma robusta y validarla.
  v_bodega_id := sgc.resolver_bodega_origen(p_bodega_id, p_proyecto_id);
  if v_bodega_id is null then
    raise exception 'No se pudo determinar el almacén de origen del conduce. Selecciona un almacén de origen válido antes de enviar.'
      using errcode = 'DR451';
  end if;
  if not exists (select 1 from sgc.bodegas where id = v_bodega_id and coalesce(activo,true)) then
    raise exception 'El almacén de origen seleccionado ya no existe o está inactivo. Elige otro almacén.'
      using errcode = 'DR452';
  end if;

  -- AM1 — el conduce debe llevar al menos un item.
  select count(*) into v_n_items from jsonb_array_elements(coalesce(p_items,'[]'::jsonb));
  if coalesce(v_n_items,0) = 0 then
    raise exception 'El conduce no tiene materiales. Agrega al menos un artículo antes de enviar.'
      using errcode = 'DR454';
  end if;

  -- AM1 (c) — existencias suficientes al momento de emitir (error estructurado).
  select nombre into v_bodega from sgc.bodegas where id = v_bodega_id;
  v_bodega := coalesce(v_bodega, 'el almacén');
  for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_sol := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad,0) into v_nombre, v_stock
    from sgc.articulos a
    left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = v_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;
    v_nombre := coalesce(v_nombre,'artículo'); v_stock := coalesce(v_stock,0);
    if v_stock < v_sol then
      v_faltantes := v_faltantes || format('No hay existencia suficiente de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega, trim(to_char(v_stock,'FM999999990.###')), trim(to_char(v_sol,'FM999999990.###')));
    end if;
  end loop;
  if array_length(v_faltantes,1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n') using errcode = 'DR453';
  end if;

  -- AF23 — ruta = movimiento del chofer: el conduce genera/usa su ruta.
  if v_ruta is null and v_cond_id is not null and p_proyecto_id is not null and p_vehiculo_id is not null then
    select nombre into v_dest from sgc.proyectos where id = p_proyecto_id;
    select id into v_ruta from sgc.rutas
      where conductor_id = v_cond_id and estado = 'en_curso' and fecha = current_date
      order by iniciada_at desc nulls last limit 1;
    if v_ruta is null then
      insert into sgc.rutas (vehiculo_id, conductor_id, origen, destino, destino_proyecto_id, fecha, tipo, estado, creado_por)
      values (p_vehiculo_id, v_cond_id, v_bodega, coalesce(v_dest, 'Obra'), p_proyecto_id, coalesce(p_fecha, current_date), 'material', 'planificada', v_uid)
      returning id into v_ruta;
    end if;
    select coalesce(max(orden),0)+1 into v_orden from sgc.ruta_paradas where ruta_id = v_ruta;
    insert into sgc.ruta_paradas (ruta_id, orden, ubicacion, proyecto_id, estado)
    values (v_ruta, v_orden, coalesce(v_dest, v_bodega), p_proyecto_id, 'pendiente')
    returning id into v_parada;
  end if;

  insert into sgc.salidas_inventario (
    id, fecha, bodega_id, proyecto_id, motivo, responsable, observaciones,
    creado_por, conductor_id, vehiculo_id, ruta_id, ruta_parada_id, estado
  ) values (
    coalesce(p_id, gen_random_uuid()), coalesce(p_fecha, current_date), v_bodega_id, p_proyecto_id,
    case when p_proyecto_id is not null then 'uso_proyecto' else 'otro' end,
    null, p_observaciones, v_uid,
    v_cond_id, p_vehiculo_id, v_ruta, v_parada, 'despachado'
  ) returning id into p_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla','')
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i;

  return p_id;
end;
$function$;
grant execute on function sgc.crear_conduce_transportista(uuid, date, uuid, uuid, text, uuid, uuid, jsonb) to authenticated, service_role;

-- ── 3) Contrato EXPLÍCITO: devolución a suplidor ("devolver a ferretería") ────
-- Origen = parámetro nombrado OBLIGATORIO (no puede llegar null como en AM1).
-- Sin destino de obra/almacén; motivo 'devolucion'. Reutiliza crear_conduce_simple
-- (crea salida + despachante + firmas) y fija el motivo. La salida descuenta del
-- almacén de origen (trigger de stock) y no genera entrada a ningún destino.
create or replace function sgc.crear_conduce_devolucion_suplidor(
  p_id                      uuid,
  p_fecha                   date,
  p_bodega_origen_id        uuid,        -- ORIGEN obligatorio (bodega de la obra/almacén)
  p_proyecto_origen_id      uuid,        -- opcional: obra de la que sale (para resolver bodega)
  p_observaciones           text,
  p_vehiculo_id             uuid,
  p_items                   jsonb,
  p_despachante_nombre      text  default null,
  p_despachante_usuario_id  uuid  default null,
  p_despachante_empleado_id uuid  default null,
  p_carga_foto_path         text  default null,
  p_firma_chofer_path       text  default null,
  p_firma_despachante_path  text  default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_bodega_id uuid;
  v_id uuid;
begin
  -- Resolver + exigir origen ANTES de nada (blindaje AM1).
  v_bodega_id := sgc.resolver_bodega_origen(p_bodega_origen_id, p_proyecto_origen_id);
  if v_bodega_id is null then
    raise exception 'Una devolución a suplidor requiere un almacén de ORIGEN válido. Selecciona de qué almacén sale la mercancía.'
      using errcode = 'DR451';
  end if;

  -- Reutiliza el flujo estándar: proyecto/destino_almacen = null (sale a suplidor).
  v_id := sgc.crear_conduce_simple(
    p_id, p_fecha, v_bodega_id, null::uuid, p_observaciones, p_vehiculo_id,
    null::uuid, p_items, p_despachante_nombre, p_despachante_usuario_id,
    p_despachante_empleado_id, p_carga_foto_path, p_firma_chofer_path, p_firma_despachante_path);

  update sgc.salidas_inventario set motivo = 'devolucion' where id = v_id;
  return v_id;
end;
$$;
grant execute on function sgc.crear_conduce_devolucion_suplidor(
  uuid, date, uuid, uuid, text, uuid, jsonb, text, uuid, uuid, text, text, text
) to authenticated, service_role;
comment on function sgc.crear_conduce_devolucion_suplidor(
  uuid, date, uuid, uuid, text, uuid, jsonb, text, uuid, uuid, text, text, text) is
  'AM1 — contrato explícito de devolución a suplidor: origen obligatorio (nombrado), sin destino de obra/almacén, motivo devolucion. Blinda el bug del bodega_id null.';

commit;
