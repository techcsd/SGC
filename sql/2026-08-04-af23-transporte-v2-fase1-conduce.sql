-- ============================================================================
-- TRANSPORTE v2 — FASE 1 — Modelo conduce-céntrico (AF23, AF16, AF30, AF31)
-- Ronda 03/08/2026 (IDs AF) — PROMPT-3. Doc: TRANSPORTE-V2.md (aprobado).
--
-- Decisiones aprobadas: fase DERIVADA (no se toca el `estado` de stock); una ruta
-- activa por chofer (conduce sin ruta la crea, con ruta activa se adjunta); firma
-- del emisor obligatoria al emitir; alto valor bloquea auto-recepción; ≥2 fotos de
-- descarga; suplidor = proveedor.
--
-- Aditivo, idempotente, retrocompatible (conduces/rutas viejos intactos).
-- ============================================================================

-- ── 1) Fase derivada del conduce (capa de lectura para la UI) ───────────────
-- borrador (solo en outbox app) · emitido · en_transito · entregado · confirmado
-- · pendiente_firma. Se deriva de señales que ya existen; el `estado`/stock sigue
-- siendo la fuente de verdad de inventario.
create or replace function sgc.conduce_fase(p_salida_id uuid)
returns text
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case
    when s.id is null then null
    when s.recibido_por is not null
      or exists (select 1 from sgc.recepcion_confirmaciones rc
                 where rc.entidad_tipo='salida' and rc.entidad_id=s.id) then 'confirmado'
    when s.firma_pendiente_usuario_id is not null then 'pendiente_firma'
    when s.estado in ('entregado','entregado_incompleto') then 'entregado'
    when (p.estado = 'en_camino')
      or exists (select 1 from sgc.rutas r where r.id=s.ruta_id and r.estado='en_curso') then 'en_transito'
    else 'emitido'
  end
  from sgc.salidas_inventario s
  left join sgc.ruta_paradas p on p.id = s.ruta_parada_id
  where s.id = p_salida_id;
$$;
grant execute on function sgc.conduce_fase(uuid) to authenticated, service_role;

-- ── 2) ¿El conduce lleva algún artículo de alto valor (entrega en mano)? ─────
create or replace function sgc.conduce_tiene_alto_valor(p_salida_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1 from sgc.detalle_salidas d
    join sgc.articulos a on a.id = d.articulo_id
    where d.salida_id = p_salida_id and coalesce(a.entrega_en_mano, false)
  );
$$;
grant execute on function sgc.conduce_tiene_alto_valor(uuid) to authenticated, service_role;

-- ── 3) crear_conduce_transportista: auto-genera ruta al emitir (AF23) ───────
-- Misma firma (8 args). Si no se pasa ruta y hay vehículo + obra destino: usa la
-- ruta activa del chofer (una sola) o crea una nueva tipo 'material' con una
-- parada = destino, y vincula el conduce a esa parada. No rompe llamadas viejas.
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
    return p_id;
  end if;

  select nombre into v_bodega from sgc.bodegas where id = p_bodega_id;
  v_bodega := coalesce(v_bodega, 'el almacén');
  for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_sol := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad,0) into v_nombre, v_stock
    from sgc.articulos a
    left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;
    v_nombre := coalesce(v_nombre,'artículo'); v_stock := coalesce(v_stock,0);
    if v_stock < v_sol then
      v_faltantes := v_faltantes || format('No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega, trim(to_char(v_stock,'FM999999990.###')), trim(to_char(v_sol,'FM999999990.###')));
    end if;
  end loop;
  if array_length(v_faltantes,1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n');
  end if;

  -- AF23 — ruta = movimiento del chofer: el conduce genera/usa su ruta.
  if v_ruta is null and v_cond_id is not null and p_proyecto_id is not null and p_vehiculo_id is not null then
    select nombre into v_dest from sgc.proyectos where id = p_proyecto_id;
    -- una ruta activa por chofer: si tiene una en curso hoy, se adjunta; si no, se crea.
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
    coalesce(p_id, gen_random_uuid()), coalesce(p_fecha, current_date), p_bodega_id, p_proyecto_id,
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

-- ── 4) AF16 — alto valor bloquea auto-recepción del chofer ──────────────────
-- Se extiende asignar_firma_pendiente: no se puede dejar pendiente de firma para
-- UNO MISMO (el chofer/creador) si el conduce lleva un artículo de alto valor —
-- exige que reciba/confirme el responsable (o remoto AF15 como excepción auditada).
create or replace function sgc.asignar_firma_pendiente(p_salida_id uuid, p_usuario_id uuid, p_nombre text)
 returns void
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_usuario_id is null then raise exception 'Falta a quién asignar la firma.'; end if;
  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
    or exists (select 1 from sgc.salidas_inventario s where s.id = p_salida_id
               and (s.creado_por = v_uid
                    or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = v_uid)))
  ) then
    raise exception 'No autorizado para asignar esta firma.';
  end if;

  -- AF16 — alto valor no admite auto-recepción del chofer.
  if p_usuario_id = v_uid and sgc.conduce_tiene_alto_valor(p_salida_id) then
    raise exception 'Este conduce lleva artículos de alto valor: la recepción debe confirmarla el responsable en obra (no puedes auto-recibirla).';
  end if;

  update sgc.salidas_inventario
     set firma_pendiente_usuario_id = p_usuario_id,
         firma_pendiente_nombre = nullif(trim(p_nombre),'')
   where id = p_salida_id;

  perform sgc.notificar(p_usuario_id, 'firma',
    'Firma de recepción pendiente',
    'Tienes una entrega de material por firmar.',
    '/transporte/por-firmar');
end;
$function$;
grant execute on function sgc.asignar_firma_pendiente(uuid, uuid, text) to authenticated, service_role;

-- ── 5) Trigger: al entregarse el conduce, cerrar su parada Y la ruta si aplica ─
-- (extiende tg_conduce_entregado_marca_parada) — cierra la ruta de una sola parada
-- (o multi-parada ya toda entregada) cuando su conduce se entrega. AF23.
create or replace function sgc.tg_conduce_entregado_marca_parada()
 returns trigger
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ruta uuid; v_pend int;
begin
  if new.ruta_parada_id is not null
     and new.estado in ('entregado','entregado_incompleto')
     and coalesce(old.estado,'') is distinct from new.estado then
    update sgc.ruta_paradas p set
      estado        = 'entregada',
      entregada_at  = coalesce(p.entregada_at, now()),
      foto_path     = coalesce(p.foto_path, new.recepcion_foto_path, new.entrega_foto_path),
      firma_path    = coalesce(p.firma_path, new.entrega_firma_path),
      entregado_a   = coalesce(p.entregado_a, new.entrega_receptor)
    where p.id = new.ruta_parada_id
      and p.estado <> 'entregada';

    -- AF23 — si ya no quedan paradas pendientes, la ruta finaliza.
    select ruta_id into v_ruta from sgc.ruta_paradas where id = new.ruta_parada_id;
    if v_ruta is not null then
      select count(*) into v_pend from sgc.ruta_paradas
        where ruta_id = v_ruta and estado not in ('entregada','omitida');
      if v_pend = 0 then
        update sgc.rutas set estado = 'completada', finalizada_at = coalesce(finalizada_at, now())
          where id = v_ruta and estado in ('planificada','en_curso');
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- El trigger ya existe apuntando a esta función; no hace falta recrearlo.
