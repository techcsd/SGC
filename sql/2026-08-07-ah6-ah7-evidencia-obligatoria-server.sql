-- =============================================================================
-- PROMPT-9 FASE 4 (AH6, AH7) — Evidencia OBLIGATORIA server-side al confirmar
-- entregas/recepciones. Re-reporte de AF13: la regla debe vivir en el servidor,
-- no solo en la UI. Aditivo (endurece RPCs existentes; conserva toda su lógica).
--
--  AH7 — la foto de evidencia NUNCA es opcional en una confirmación.
--  AH6 — recibir un conduce exige foto + firma (no solo un botón). La firma del
--        receptor es obligatoria salvo el caso legítimo de recepción DEJADA
--        PENDIENTE / remota (AF15): ahí la firma la aporta después el autorizado
--        vía `firmar_conduce` (que ya exige la imagen de firma).
--
-- Caminos cubiertos (todos los de confirmación que existían sin evidencia):
--   1) entregar_conduce            (app + web salidas.service)
--   2) confirmar_recepcion_salida  (web salidas.service)
--   3) registrar_confirmacion_recepcion (app inventario.service; presencial+remota)
-- =============================================================================

begin;

-- ── 1) entregar_conduce: foto SIEMPRE; firma salvo pendiente/remota ──────────
create or replace function sgc.entregar_conduce(p_salida_id uuid, p_items jsonb, p_receptor text, p_firma_url text, p_foto_url text, p_notas text default null)
returns text
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_item jsonb;
  v_pendiente boolean;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotencia: un reenvío de quien ya entregó pasa en silencio.
  if v_salida.estado in ('entregado', 'entregado_incompleto') then
    if v_salida.entregado_por = auth.uid() then return v_salida.estado; end if;
    raise exception 'Este conduce ya fue entregado.';
  end if;
  if v_salida.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota')
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No eres el conductor asignado a este conduce.';
  end if;

  -- AH7 — foto de evidencia OBLIGATORIA en toda confirmación de entrega.
  if nullif(trim(coalesce(p_foto_url,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la entrega.';
  end if;
  -- AH6 — firma del receptor obligatoria, salvo entrega dejada pendiente/remota
  -- (receptor ausente: la firma del autorizado se aporta luego vía firmar_conduce).
  v_pendiente := (v_salida.firma_pendiente_usuario_id is not null)
                 or coalesce(v_salida.firma_pendiente_almacen, false);
  if nullif(trim(coalesce(p_firma_url,'')),'') is null and not v_pendiente then
    raise exception 'Falta la firma de recepción. Pide la firma o marca la entrega como pendiente (receptor ausente).';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    update sgc.detalle_salidas
    set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  update sgc.salidas_inventario set
    estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    entregado_por = auth.uid(),
    entregado_en = now(),
    entrega_receptor = p_receptor,
    entrega_firma_path = p_firma_url,
    entrega_foto_path = p_foto_url,
    recibido_en = now(),
    notas_recepcion = coalesce(p_notas, notas_recepcion)
  where id = p_salida_id;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$function$;

-- ── 2) confirmar_recepcion_salida: foto OBLIGATORIA (cierra el "botón viejo") ─
create or replace function sgc.confirmar_recepcion_salida(p_salida_id uuid, p_items jsonb, p_notas text, p_receptor text default null, p_foto_path text default null)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_autorizado boolean; v_incompleto boolean; v_item jsonb;
  v_recibida numeric; v_enviada numeric; v_nombre text;
  v_bodega_obra_id uuid; v_entrada_id uuid; v_notas text;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Salida no encontrada.'; end if;
  if v_salida.estado <> 'despachado' then raise exception 'Esta salida ya tiene una recepción confirmada.'; end if;

  select sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  into v_autorizado;
  if not v_autorizado then raise exception 'No autorizado para confirmar esta entrega.'; end if;

  -- AH7 — foto de evidencia OBLIGATORIA.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la recepción.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_recibida := (v_item->>'cantidad_recibida')::numeric;
    if v_recibida is not null and v_recibida < 0 then
      raise exception 'La cantidad recibida no puede ser negativa.';
    end if;
    select d.cantidad, a.nombre into v_enviada, v_nombre
    from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
    where d.id = (v_item->>'detalle_id')::uuid and d.salida_id = p_salida_id;
    if v_recibida is not null and v_enviada is not null and v_recibida > v_enviada then
      raise exception 'La cantidad recibida (%) de "%" no puede ser mayor que la enviada (%).',
        v_recibida, coalesce(v_nombre,'artículo'), v_enviada;
    end if;
    update sgc.detalle_salidas set cantidad_recibida = v_recibida
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  v_notas := concat_ws(' · ', nullif(p_notas,''),
    case when nullif(p_receptor,'') is not null then 'Recibió: '||p_receptor end);

  update sgc.salidas_inventario
  set estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
      recibido_por = auth.uid(), recibido_en = now(),
      notas_recepcion = v_notas,
      recepcion_foto_path = coalesce(p_foto_path, recepcion_foto_path)
  where id = p_salida_id;

  if v_salida.proyecto_id is not null then
    select id into v_bodega_obra_id from sgc.bodegas where proyecto_id = v_salida.proyecto_id limit 1;
    if v_bodega_obra_id is not null and v_bodega_obra_id <> v_salida.bodega_id then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, salida_id
      ) values (
        current_date, v_bodega_obra_id, 'Recepción de material despachado a la obra',
        v_notas, auth.uid(), 'recepcion_obra', v_salida.proyecto_id, p_salida_id
      ) returning id into v_entrada_id;
      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
      select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id and coalesce(d.cantidad_recibida, d.cantidad) > 0;
    end if;
  end if;

  return v_incompleto;
end;
$function$;

-- ── 3) registrar_confirmacion_recepcion: al menos 1 foto (presencial y remota) ─
create or replace function sgc.registrar_confirmacion_recepcion(p_entidad_tipo text, p_entidad_id uuid, p_modo text default 'presencial', p_fotos text[] default '{}', p_notas text default null, p_checklist jsonb default null, p_aportado_por uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_modo text := coalesce(p_modo, 'presencial');
  v_es_prueba boolean := false;
  v_id uuid;
  v_fotos_n int := coalesce(array_length(array(select f from unnest(coalesce(p_fotos,'{}')) f where nullif(trim(f),'') is not null), 1), 0);
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_entidad_tipo not in ('entrada', 'salida', 'conduce') then
    raise exception 'Tipo de entidad inválido: %', p_entidad_tipo;
  end if;
  if v_modo not in ('presencial', 'remota') then
    raise exception 'Modo inválido: %', v_modo;
  end if;

  if v_modo = 'remota' then
    if not sgc.puede_confirmar_remoto() then
      raise exception 'Sin permiso para confirmación remota';
    end if;
  else
    if not sgc.puede_confirmar_recepcion() then
      raise exception 'Sin permiso para confirmar recepción';
    end if;
  end if;

  -- AH7 — al menos una foto de evidencia (en remota, la aporta quien está en obra).
  if v_fotos_n < 1 then
    raise exception 'La foto de evidencia es obligatoria para confirmar la recepción.';
  end if;

  if p_entidad_tipo = 'entrada' then
    select coalesce(es_prueba, false) into v_es_prueba from sgc.entradas_inventario where id = p_entidad_id;
  elsif p_entidad_tipo = 'salida' then
    select coalesce(es_prueba, false) into v_es_prueba from sgc.salidas_inventario where id = p_entidad_id;
  end if;

  insert into sgc.recepcion_confirmaciones (
    entidad_tipo, entidad_id, confirmado_por, modo, aportado_por,
    fotos, notas, checklist, es_prueba, es_prueba_origen
  ) values (
    p_entidad_tipo, p_entidad_id, v_uid, v_modo,
    case when v_modo = 'remota' then p_aportado_por else null end,
    coalesce(p_fotos, '{}'), p_notas, p_checklist,
    coalesce(v_es_prueba, false), case when coalesce(v_es_prueba,false) then 'heredado' else 'manual' end
  ) returning id into v_id;

  return v_id;
end;
$function$;

commit;
