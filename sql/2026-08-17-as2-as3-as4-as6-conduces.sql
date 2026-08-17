-- ============================================================================
-- PROMPT-17 (AS) — FASE 1 — Conduces: firma remota del despachante (AS2),
--   despachante reflejado + labels (AS3), origen≠destino (AS4),
--   confirmaciones visibles al chofer que entregó (AS6). SGC padre.
--   Aditivo / retrocompatible. Migración fechada.
-- ----------------------------------------------------------------------------
-- Contexto (CONTEXTO-ACTUALIZACION-8.md):
--   AS2: al emitir con despachante ELEGIDO (usuario del sistema), el conduce
--        queda "pendiente de firma del despachante" → él firma desde SU sesión
--        (server-side sólo su auth.uid). El chofer TRANSITA pero NO puede marcar
--        "entregado" hasta esa firma (regla confirmada por Xaviel). Sin bypass de
--        admin para firmar en nombre de (anti-suplantación). Filosofía = AJ8.
--   AS3: el despachante SÍ se persistía (AI2) pero el contrato de lectura
--        (conduce_detalle_app) no lo exponía y el "Entregado por" leía la firma
--        emisor/entregado_por (a veces vacíos) → "ENTREGADO POR: —". Aquí se
--        expone el despachante + labels server-side (motivo/estado/fase).
--   AS4: origen ≠ destino (mismo almacén, Bodega Central incluida). Guard por
--        trigger (cubre insert de crear_conduce_transportista y el UPDATE del
--        wrapper de destino-almacén AL10).
--   AS6: el chofer que entregó ve las confirmaciones de sus entregas — ya lo
--        cubre confirmaciones_historial (entregado_por = auth.uid()); se refuerza
--        el detalle y se documenta.
-- ============================================================================

set search_path = sgc, public;

-- ════════════════════════════════════════════════════════════════════════════
-- AS3 — Labels server-side (FUENTE ÚNICA para app / web / PDF)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.label_motivo_salida(p_motivo text)
returns text language sql immutable as $$
  select case p_motivo
    when 'uso_proyecto'     then 'Uso en proyecto'
    when 'traslado_almacen' then 'Traslado a almacén (Bodega Central)'
    when 'venta'            then 'Venta'
    when 'merma'            then 'Merma / Pérdida'
    when 'devolucion'       then 'Devolución a proveedor'
    when 'ajuste'           then 'Ajuste de inventario'
    when 'otro'             then 'Otro'
    else initcap(replace(coalesce(p_motivo,''), '_', ' '))
  end;
$$;

create or replace function sgc.label_estado_salida(p_estado text)
returns text language sql immutable as $$
  select case p_estado
    when 'despachado'           then 'Despachado'
    when 'entregado'            then 'Entregado'
    when 'entregado_incompleto' then 'Entregado (incompleto)'
    when 'anulado'              then 'Eliminado'
    else initcap(replace(coalesce(p_estado,''), '_', ' '))
  end;
$$;

create or replace function sgc.label_fase_conduce(p_fase text)
returns text language sql immutable as $$
  select case p_fase
    when 'emitido'                       then 'Emitido'
    when 'en_transito'                   then 'En tránsito'
    when 'entregando'                    then 'Entregando'
    when 'entregado'                     then 'Entregado'
    when 'confirmado'                    then 'Confirmado'
    when 'pendiente_firma'               then 'Pendiente de firma'
    when 'pendiente_firma_despachante'   then 'Pendiente de firma del despachante'
    else initcap(replace(coalesce(p_fase,''), '_', ' '))
  end;
$$;

grant execute on function sgc.label_motivo_salida(text)  to authenticated, service_role;
grant execute on function sgc.label_estado_salida(text)  to authenticated, service_role;
grant execute on function sgc.label_fase_conduce(text)   to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS2 — Firma remota del despachante (anti-suplantación)
-- ════════════════════════════════════════════════════════════════════════════
-- "Pendiente de firma del despachante" = hay un despachante que es USUARIO del
-- sistema (puede firmar en su sesión) y aún no existe la firma emisor. Los
-- conduces sin despachante-usuario (ferretería/empleado/nombre libre) NO quedan
-- pendientes (retrocompat: el pad de emisión clásico los cubre).
create or replace function sgc.conduce_firma_despachante_pendiente(p_salida_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1 from sgc.salidas_inventario s
    where s.id = p_salida_id
      and s.despachante_usuario_id is not null
      and coalesce(s.estado,'') <> 'anulado'
      and not exists (
        select 1 from sgc.salida_firmas sf
        where sf.salida_id = s.id and sf.rol = 'emisor'));
$$;
grant execute on function sgc.conduce_firma_despachante_pendiente(uuid) to authenticated, service_role;

-- El despachante firma DESDE SU sesión. Sólo su propio auth.uid puede firmar
-- (sin bypass de admin — la excepción de "firmar en nombre de" no existe).
create or replace function sgc.conduce_firmar_despachante(
  p_salida_id uuid,
  p_firma_path text
) returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma es obligatoria.';
  end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  if v_s.despachante_usuario_id is null then
    raise exception 'Este conduce no tiene un despachante del sistema para firmar.';
  end if;
  -- Anti-suplantación: sólo el despachante designado firma, desde SU sesión.
  if v_s.despachante_usuario_id <> v_uid then
    raise exception 'Sólo el despachante designado puede firmar este conduce, desde su propia sesión.';
  end if;
  if exists (select 1 from sgc.salida_firmas sf where sf.salida_id = p_salida_id and sf.rol = 'emisor') then
    return 'ya_firmado';
  end if;

  select coalesce(nullif(v_s.despachante_nombre,''), u.nombre, 'Despachante')
    into v_nombre from sgc.usuarios u where u.id = v_uid;

  perform sgc.firmar_conduce(
    p_salida_id, 'emisor', coalesce(v_nombre,'Despachante'),
    p_firma_path, null, 'Despachante', 'pad', v_uid);

  -- Aviso al chofer/creador: ya puede entregar.
  if v_s.creado_por is distinct from v_uid then
    perform sgc.notificar(
      v_s.creado_por, 'conduce',
      'Conduce firmado por el despachante',
      'El despachante firmó el conduce '||('CND-'||upper(left(p_salida_id::text,8)))||'. Ya puedes marcar la entrega.',
      '/transporte/mis-conduces');
  end if;

  return 'firmado';
end;
$$;
grant execute on function sgc.conduce_firmar_despachante(uuid, text) to authenticated, service_role;

-- Bandeja "por firmar" del despachante + badge.
create or replace function sgc.mis_conduces_por_firmar()
returns table (
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text,
  estado text, fase text, created_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id,
         coalesce(p.nombre, da.nombre) as destino, b.nombre as bodega,
         s.estado, sgc.conduce_fase(s.id), s.created_at
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.bodegas   da on da.id = s.destino_almacen_id
  where s.despachante_usuario_id = auth.uid()
    and coalesce(s.estado,'') <> 'anulado'
    and not exists (select 1 from sgc.salida_firmas sf where sf.salida_id = s.id and sf.rol = 'emisor')
    and ((not coalesce(s.es_prueba, false)) or sgc.is_admin())
  order by s.created_at desc;
$$;
grant execute on function sgc.mis_conduces_por_firmar() to authenticated, service_role;

create or replace function sgc.mis_conduces_por_firmar_count()
returns integer language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$ select count(*)::int from sgc.mis_conduces_por_firmar(); $$;
grant execute on function sgc.mis_conduces_por_firmar_count() to authenticated, service_role;

-- ── crear_conduce_simple (14-arg): notificar al despachante-usuario cuando queda
--    pendiente de su firma (el pad en el teléfono del chofer se elimina → la firma
--    del despachante llega null y él firma remoto). Recrea AI2 + aviso al final.
create or replace function sgc.crear_conduce_simple(
  p_id                     uuid,
  p_fecha                  date,
  p_bodega_id              uuid,
  p_proyecto_id            uuid,
  p_observaciones          text,
  p_vehiculo_id            uuid,
  p_ruta_id                uuid,
  p_items                  jsonb,
  p_despachante_nombre     text  default null,
  p_despachante_usuario_id uuid  default null,
  p_despachante_empleado_id uuid default null,
  p_carga_foto_path        text  default null,
  p_firma_chofer_path      text  default null,
  p_firma_despachante_path text  default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id            uuid;
  v_chofer_nombre text;
  v_desp_nombre   text;
begin
  v_id := sgc.crear_conduce_transportista(
    p_id, p_fecha, p_bodega_id, p_proyecto_id, p_observaciones,
    p_vehiculo_id, p_ruta_id, p_items
  );

  update sgc.salidas_inventario set
    despachante_nombre      = nullif(p_despachante_nombre, ''),
    despachante_usuario_id  = p_despachante_usuario_id,
    despachante_empleado_id = p_despachante_empleado_id,
    carga_foto_path         = nullif(p_carga_foto_path, '')
  where id = v_id;

  if nullif(p_firma_chofer_path, '') is not null then
    select nombre into v_chofer_nombre from sgc.usuarios where id = auth.uid();
    perform sgc.firmar_conduce(
      v_id, 'transportista', coalesce(nullif(v_chofer_nombre, ''), 'Chofer'),
      p_firma_chofer_path, null, 'Chofer', 'pad', auth.uid()
    );
  end if;

  -- Firma del despachante: si vino (flujo legacy en el mismo teléfono) se registra;
  -- si NO vino y el despachante es usuario del sistema → queda pendiente de su
  -- firma remota (AS2) y se le avisa.
  if nullif(p_firma_despachante_path, '') is not null then
    v_desp_nombre := coalesce(
      nullif(p_despachante_nombre, ''),
      (select nombre from sgc.usuarios  where id = p_despachante_usuario_id),
      (select nombre from sgc.empleados where id = p_despachante_empleado_id),
      'Despachante');
    perform sgc.firmar_conduce(
      v_id, 'emisor', v_desp_nombre,
      p_firma_despachante_path, null, 'Despachante', 'pad', p_despachante_usuario_id);
  elsif p_despachante_usuario_id is not null then
    perform sgc.notificar(
      p_despachante_usuario_id, 'conduce_firma',
      'Tienes un conduce por firmar',
      'Se emitió un conduce contigo como despachante. Revísalo y fírmalo desde tu app.',
      '/transporte/por-firmar');
  end if;

  return v_id;
end;
$$;
grant execute on function sgc.crear_conduce_simple(
  uuid, date, uuid, uuid, text, uuid, uuid, jsonb, text, uuid, uuid, text, text, text
) to authenticated, service_role;

-- ── conduce_marcar_entregado: bloquear "entregado" si falta la firma del
--    despachante (AS2). Recrea AK4 + guard.
create or replace function sgc.conduce_marcar_entregado(
  p_salida_id uuid,
  p_foto_path text,
  p_items     jsonb default null,
  p_notas     text  default null
) returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_item jsonb; v_incompleto boolean; v_r record; v_proy text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  if v_s.estado in ('entregado','entregado_incompleto') then
    if v_s.entregado_por = v_uid then return v_s.estado; end if;
    raise exception 'Este conduce ya fue entregado.';
  end if;
  if v_s.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_chofer_de_conduce(p_salida_id)) then
    raise exception 'No eres el conductor asignado a este conduce.';
  end if;

  -- AS2 — no se puede ENTREGAR sin la firma del despachante (transitar sí).
  if sgc.conduce_firma_despachante_pendiente(p_salida_id) then
    raise exception 'Falta la firma del despachante. No puedes marcar la entrega hasta que el despachante firme el conduce desde su sesión.'
      using errcode = 'DR456';
  end if;

  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de entrega es obligatoria para marcar el conduce como entregado.';
  end if;

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
      update sgc.detalle_salidas
        set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
        where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
    end loop;
  end if;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and cantidad_recibida is not null and cantidad_recibida < cantidad
  ) into v_incompleto;

  update sgc.salidas_inventario set
    estado           = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    entregado_por    = v_uid,
    entregado_en     = now(),
    entregando_at    = coalesce(entregando_at, now()),
    transito_at      = coalesce(transito_at, now()),
    entrega_foto_path= coalesce(p_foto_path, entrega_foto_path),
    notas_recepcion  = coalesce(p_notas, notas_recepcion)
  where id = p_salida_id;

  select nombre into v_proy from sgc.proyectos where id = v_s.proyecto_id;
  for v_r in
    select c.usuario_id
      from sgc.confirmadores_de_conduce(p_salida_id) c
      where c.usuario_id is distinct from v_uid
        and c.usuario_id is distinct from v_s.creado_por
        and c.usuario_id is distinct from v_s.entregado_por
  loop
    perform sgc.notificar(
      v_r.usuario_id, 'entrega',
      'Tienes una entrega por confirmar',
      'Llegó material a '||coalesce(v_proy,'la obra')||'. Confírmalo desde tu app (checklist, foto y firma).',
      '/transporte/por-confirmar');
  end loop;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$$;
grant execute on function sgc.conduce_marcar_entregado(uuid, text, jsonb, text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS4 — origen ≠ destino (mismo almacén, Bodega Central incluida)
-- ════════════════════════════════════════════════════════════════════════════
-- Guard por trigger: cubre el INSERT (crear_conduce_transportista) y el UPDATE
-- del wrapper de destino-almacén AL10 (que fija destino_almacen_id después).
create or replace function sgc.tg_conduce_origen_distinto_destino()
returns trigger
language plpgsql
as $$
begin
  if new.destino_almacen_id is not null
     and new.bodega_id is not null
     and new.destino_almacen_id = new.bodega_id then
    raise exception 'El almacén de origen y el de destino no pueden ser el mismo.'
      using errcode = 'DR455';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_conduce_origen_destino on sgc.salidas_inventario;
create trigger trg_conduce_origen_destino
  before insert or update of destino_almacen_id, bodega_id on sgc.salidas_inventario
  for each row execute function sgc.tg_conduce_origen_distinto_destino();

-- ════════════════════════════════════════════════════════════════════════════
-- AS3 — conduce_detalle_app: despachante + labels + firma pendiente (contrato PDF)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.conduce_detalle_app(p_salida_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_out jsonb;
  v_puede boolean;
  v_fase text;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  v_puede := sgc.is_admin()
    or v_s.creado_por = auth.uid()
    or v_s.entregado_por = auth.uid()
    or v_s.recibido_por = auth.uid()
    or v_s.despachante_usuario_id = auth.uid()
    or exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = auth.uid())
    or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_puede then
    raise exception 'No autorizado para ver este conduce.';
  end if;

  v_fase := sgc.conduce_fase(v_s.id);

  select jsonb_build_object(
    'id', v_s.id,
    'numero', 'CND-' || upper(left(v_s.id::text, 8)),
    'fecha', v_s.fecha,
    'created_at', v_s.created_at,
    'estado', v_s.estado,
    'estado_label', sgc.label_estado_salida(v_s.estado),
    'fase', v_fase,
    'fase_label', sgc.label_fase_conduce(v_fase),
    'motivo', v_s.motivo,
    'motivo_label', sgc.label_motivo_salida(v_s.motivo),
    'responsable', v_s.responsable,
    'observaciones', v_s.observaciones,
    'proyecto_id', v_s.proyecto_id,
    'proyecto', (select nombre from sgc.proyectos where id = v_s.proyecto_id),
    'bodega_id', v_s.bodega_id,
    'bodega', (select nombre from sgc.bodegas where id = v_s.bodega_id),
    'destino_almacen_id', v_s.destino_almacen_id,
    'destino_almacen', (select nombre from sgc.bodegas where id = v_s.destino_almacen_id),
    'conductor_id', v_s.conductor_id,
    'conductor', (select u.nombre from sgc.conductores c
                    left join sgc.usuarios u on u.id = c.usuario_id
                  where c.id = v_s.conductor_id),
    -- AS3 — despachante (quien entrega el material al chofer). "Entregado por".
    'despachante', coalesce(
        nullif(v_s.despachante_nombre,''),
        (select nombre from sgc.usuarios  where id = v_s.despachante_usuario_id),
        (select nombre from sgc.empleados where id = v_s.despachante_empleado_id)),
    'despachante_usuario_id', v_s.despachante_usuario_id,
    'despachante_empleado_id', v_s.despachante_empleado_id,
    'carga_foto_path', v_s.carga_foto_path,
    'firma_despachante_pendiente', sgc.conduce_firma_despachante_pendiente(v_s.id),
    'creado_por', v_s.creado_por,
    'creado_por_nombre', (select nombre from sgc.usuarios where id = v_s.creado_por),
    'entregado_por', v_s.entregado_por,
    'entregado_por_nombre', (select nombre from sgc.usuarios where id = v_s.entregado_por),
    'entregado_en', v_s.entregado_en,
    'entrega_foto_path', v_s.entrega_foto_path,
    'entrega_receptor', v_s.entrega_receptor,
    'entrega_firma_path', v_s.entrega_firma_path,
    'firma_path', v_s.firma_path,
    'firma_pendiente_nombre', v_s.firma_pendiente_nombre,
    'recibido_por', v_s.recibido_por,
    'recibido_por_nombre', (select nombre from sgc.usuarios where id = v_s.recibido_por),
    'recibido_en', v_s.recibido_en,
    'recepcion_foto_path', v_s.recepcion_foto_path,
    'notas_recepcion', v_s.notas_recepcion,
    'ruta_id', v_s.ruta_id,
    'es_prueba', coalesce(v_s.es_prueba, false),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'detalle_id', d.id,
                'articulo_id', d.articulo_id,
                'articulo', a.nombre,
                'codigo', a.codigo,
                'unidad', a.unidad,
                'propiedad', a.propiedad,
                'cantidad', d.cantidad,
                'cantidad_recibida', d.cantidad_recibida)
                order by a.nombre)
              from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
              where d.salida_id = v_s.id), '[]'::jsonb),
    'firmas', coalesce((select jsonb_agg(jsonb_build_object(
                'rol', sf.rol, 'nombre', sf.nombre, 'firma_path', sf.firma_path, 'firmado_en', sf.firmado_en))
               from sgc.salida_firmas sf where sf.salida_id = v_s.id), '[]'::jsonb),
    'transferencias', coalesce((select jsonb_agg(jsonb_build_object(
                'id', t.id, 'estado', t.estado, 'fase_al_transferir', t.fase_al_transferir,
                'de', (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.de_conductor_id),
                'a',  (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.a_conductor_id),
                'ofrecida_en', t.ofrecida_en, 'resuelta_en', t.resuelta_en)
                order by t.ofrecida_en)
               from sgc.conduce_transferencias t where t.salida_id = v_s.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
grant execute on function sgc.conduce_detalle_app(uuid) to authenticated, service_role;

comment on function sgc.conduce_detalle_app(uuid) is
  'AL9/AL13/AL4/AO4/AS3 — contrato ÚNICO del conduce (vista/PDF). Ahora incluye despachante (Entregado por), labels server-side (motivo/estado/fase) y firma_despachante_pendiente. Visibilidad: portador/creador/entregó/recibió/despachante/confirmador/flota/inventario/admin.';

-- ════════════════════════════════════════════════════════════════════════════
-- AS6 — el chofer que entregó ve las confirmaciones de SUS entregas
-- ────────────────────────────────────────────────────────────────────────────
-- Ya cubierto: confirmaciones_historial() incluye `s.entregado_por = auth.uid()`
-- y `s.creado_por = auth.uid()` en su visibilidad (AK1), y confirmacion_detalle()
-- autoriza a quien entregó. No requiere cambio de contrato server-side; el lado
-- app (PROMPT-18) debe mostrar la bandeja/detalle al chofer. Se deja constancia.
-- ════════════════════════════════════════════════════════════════════════════
