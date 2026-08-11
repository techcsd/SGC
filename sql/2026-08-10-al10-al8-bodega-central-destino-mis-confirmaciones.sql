-- =============================================================================
-- PROMPT-3 FASE 3 (AL10 + AL8) — Ronda 10/08/2026 (IDs AL). SGC padre.
-- Aditivo, idempotente, retrocompatible.
--
-- AL10 — Bodega Central (y almacenes centrales) como DESTINO válido al crear
--   conduce. Hoy el destino es solo `proyecto_id` (obra). Se añade
--   `salidas_inventario.destino_almacen_id` (FK bodegas). La entrega a un almacén
--   genera la entrada a ESE almacén AL CONFIRMARSE (regla stock-al-confirmar AK8).
--   La matriz de confirmadores AK4 se extiende para destino=almacén (roles de
--   almacén + globales + can_confirm_reception; decisión Xaviel: ingeniero/
--   residente/responsable + elevados admin/jefe_flota/gerencia/logística).
--
-- AL8 — "Mis confirmaciones": historial del propio confirmador (lo que ÉL
--   confirmó) — subconjunto del historial global AK1.
-- =============================================================================

begin;

-- ── 0) Nuevo destino: almacén central ────────────────────────────────────────
alter table sgc.salidas_inventario
  add column if not exists destino_almacen_id uuid references sgc.bodegas(id) on delete set null;
comment on column sgc.salidas_inventario.destino_almacen_id is
  'AL10 — destino del conduce cuando es un almacén central (Bodega Central), no una obra. Excluyente con proyecto_id como destino.';
create index if not exists idx_salidas_destino_almacen on sgc.salidas_inventario(destino_almacen_id) where destino_almacen_id is not null;

-- ── 1) Selects de destino para la web/app (obras + almacenes centrales) ───────
-- Reusa el contrato canónico AH9 destinos_transporte(); expone además una lista
-- simple de almacenes centrales (bodegas sin obra) para el selector de destino.
create or replace function sgc.almacenes_destino()
returns table (id uuid, nombre text, es_central boolean, es_principal boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select b.id, b.nombre::text,
         (b.proyecto_id is null) as es_central,
         coalesce(b.es_principal, false) as es_principal
  from sgc.bodegas b
  where coalesce(b.activo, true)
    and b.proyecto_id is null           -- almacenes centrales (no de obra)
    and ((not coalesce(b.es_prueba, false)) or sgc.is_admin())
  order by coalesce(b.es_principal, false) desc, b.nombre;
$$;
grant execute on function sgc.almacenes_destino() to authenticated, service_role;
comment on function sgc.almacenes_destino() is
  'AL10 — almacenes centrales (bodegas sin proyecto) elegibles como destino de un conduce (Bodega Central primero). es_prueba oculto a no-admin.';

-- ── 2) Parámetro: roles que confirman entregas a un almacén central ──────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('confirmacion_roles_almacen',
   'almacenista,jefe_almacen,encargado_almacen,logistica,gerente_proyectos',
   'AL10 — roles que confirman entregas cuyo destino es un almacén central (además de los roles globales de supervisión y usuarios con can_confirm_reception).')
on conflict (clave) do nothing;

-- ── 3) confirmadores_de_conduce: soportar destino = almacén central ──────────
-- Mantiene todas las ramas de obra (no-op si no hay proyecto) y añade la rama de
-- almacén cuando destino_almacen_id no es nulo.
create or replace function sgc.confirmadores_de_conduce(p_salida_id uuid)
returns table (usuario_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with s as (select * from sgc.salidas_inventario where id = p_salida_id),
  glob as (select unnest(sgc.param_csv('confirmacion_roles_globales',
             'admin,direccion,gerencia,gerente_proyectos,jefe_flota,logistica,ingeniero_oficina')) as codigo),
  obra as (select unnest(sgc.param_csv('confirmacion_roles_obra',
             'capataz,ingeniero_campo,gerente_produccion')) as codigo),
  alma as (select unnest(sgc.param_csv('confirmacion_roles_almacen',
             'almacenista,jefe_almacen,encargado_almacen,logistica,gerente_proyectos')) as codigo)
  -- (A) Responsables/residentes activos de la obra destino
  select pr.usuario_id
    from sgc.proyecto_responsables pr, s
    where pr.proyecto_id = s.proyecto_id and coalesce(pr.activo, true) and pr.usuario_id is not null
  union
  -- (B) Firmante pendiente designado (recepción dejada pendiente / remota)
  select s.firma_pendiente_usuario_id from s where s.firma_pendiente_usuario_id is not null
  union
  -- (C) Usuarios con flag can_confirm_reception vinculados a la obra destino
  select u.id
    from sgc.usuarios u, s
    where coalesce(u.can_confirm_reception, false)
      and s.proyecto_id is not null
      and exists (
        select 1 from sgc.proyecto_empleados pe
          join sgc.empleados e on e.id = pe.empleado_id
        where pe.proyecto_id = s.proyecto_id and e.usuario_id = u.id and coalesce(pe.activo, true))
  union
  -- (D) Roles de obra SOLO si están vinculados a ESTA obra
  select ur.usuario_id
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id, s
    where r.codigo in (select codigo from obra)
      and (
        exists (select 1 from sgc.proyecto_responsables pr
                where pr.proyecto_id = s.proyecto_id and pr.usuario_id = ur.usuario_id and coalesce(pr.activo, true))
        or exists (select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
                   where pe.proyecto_id = s.proyecto_id and e.usuario_id = ur.usuario_id and coalesce(pe.activo, true))
      )
  union
  -- (E) Roles globales de supervisión (company-wide, cualquier obra o almacén)
  select ur.usuario_id
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where r.codigo in (select codigo from glob)
  union
  -- (F) AL10 — destino ALMACÉN CENTRAL: roles de almacén + can_confirm_reception.
  select ur.usuario_id
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id, s
    where s.destino_almacen_id is not null
      and r.codigo in (select codigo from alma)
  union
  select u.id
    from sgc.usuarios u, s
    where s.destino_almacen_id is not null
      and coalesce(u.can_confirm_reception, false);
$$;
grant execute on function sgc.confirmadores_de_conduce(uuid) to authenticated, service_role;

-- ── 4) Wrapper de creación con destino almacén (AL10) ────────────────────────
-- 15 args (14 originales + p_destino_almacen_id, sin default → sin ambigüedad con
-- la firma de 14). El 14-arg legacy se conserva como wrapper (null).
create or replace function sgc.crear_conduce_simple(
  p_id                     uuid,
  p_fecha                  date,
  p_bodega_id              uuid,
  p_proyecto_id            uuid,
  p_observaciones          text,
  p_vehiculo_id            uuid,
  p_ruta_id                uuid,
  p_items                  jsonb,
  p_despachante_nombre     text,
  p_despachante_usuario_id uuid,
  p_despachante_empleado_id uuid,
  p_carga_foto_path        text,
  p_firma_chofer_path      text,
  p_firma_despachante_path text,
  p_destino_almacen_id     uuid            -- AL10 (sin default)
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  -- Reusa el 14-arg (crea salida + firmas + despachante) y luego fija el destino
  -- almacén. proyecto_id y destino_almacen_id son excluyentes como destino.
  v_id := sgc.crear_conduce_simple(
    p_id, p_fecha, p_bodega_id, p_proyecto_id, p_observaciones, p_vehiculo_id,
    p_ruta_id, p_items, p_despachante_nombre, p_despachante_usuario_id,
    p_despachante_empleado_id, p_carga_foto_path, p_firma_chofer_path, p_firma_despachante_path);
  if p_destino_almacen_id is not null then
    update sgc.salidas_inventario
      set destino_almacen_id = p_destino_almacen_id,
          motivo = case when p_proyecto_id is null then 'traslado_almacen' else motivo end
      where id = v_id;
  end if;
  return v_id;
end;
$$;
grant execute on function sgc.crear_conduce_simple(
  uuid, date, uuid, uuid, text, uuid, uuid, jsonb, text, uuid, uuid, text, text, text, uuid
) to authenticated, service_role;

-- ── 5) conduce_confirmar_receptor: entrada al almacén destino (AL10) ─────────
-- Igual que AJ8 pero: (a) autoriza también al confirmador de la matriz (para
-- destino almacén sin proyecto), y (b) la entrada de inventario va al almacén
-- destino (destino_almacen_id) o, si es obra, a la bodega de la obra.
create or replace function sgc.conduce_confirmar_receptor(
  p_salida_id uuid,
  p_foto_path text,
  p_firma_path text,
  p_checklist jsonb default null,
  p_items     jsonb default null,
  p_notas     text  default null
) returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_item jsonb; v_incompleto boolean; v_recibida numeric; v_enviada numeric; v_nombre text;
  v_autorizado boolean; v_bodega_destino_id uuid; v_entrada_id uuid; v_notas text;
  v_receptor_nombre text; v_proyecto_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;
  if v_s.recibido_por is not null then
    raise exception 'Esta entrega ya fue confirmada.';
  end if;

  -- Anti-suplantación: el chofer/emisor no confirma su propia entrega (salvo admin).
  if sgc.es_chofer_de_conduce(p_salida_id) and not sgc.is_admin() then
    raise exception 'La recepción debe confirmarla el responsable del destino desde SU dispositivo, no el transportista.';
  end if;

  -- Autorizado = admin, puede_confirmar_recepcion, receptor de obra, o confirmador
  -- de la matriz (cubre destino almacén central).
  v_autorizado := sgc.is_admin()
    or sgc.puede_confirmar_recepcion()
    or exists (select 1 from sgc.receptores_de_destino(p_salida_id) r where r.usuario_id = v_uid)
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_autorizado then
    raise exception 'No estás autorizado para confirmar la recepción de este destino.';
  end if;

  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la recepción.';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma de recepción es obligatoria.';
  end if;

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
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
  end if;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  v_notas := concat_ws(' · ', nullif(p_notas,''), 'Confirmado por el receptor en su dispositivo');

  update sgc.salidas_inventario set
    estado             = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    recibido_por       = v_uid,
    recibido_en        = now(),
    recepcion_foto_path= coalesce(p_foto_path, recepcion_foto_path),
    notas_recepcion    = coalesce(v_notas, notas_recepcion)
  where id = p_salida_id;

  select nombre into v_receptor_nombre from sgc.usuarios where id = v_uid;
  delete from sgc.salida_firmas where salida_id = p_salida_id and rol = 'receptor';
  insert into sgc.salida_firmas (salida_id, rol, nombre, usuario_id, firma_path, metodo, firmado_en)
  values (p_salida_id, 'receptor', coalesce(v_receptor_nombre,'Receptor'), v_uid, p_firma_path, 'pad', now());

  insert into sgc.recepcion_confirmaciones (
    entidad_tipo, entidad_id, confirmado_por, modo, fotos, notas, checklist,
    es_prueba, es_prueba_origen
  ) values (
    'salida', p_salida_id, v_uid, 'presencial', array[p_foto_path], p_notas, p_checklist,
    coalesce(v_s.es_prueba, false), case when coalesce(v_s.es_prueba,false) then 'heredado' else 'manual' end
  );

  -- Entrada de inventario al destino: almacén central (AL10) o bodega de la obra.
  v_bodega_destino_id := v_s.destino_almacen_id;
  if v_bodega_destino_id is null and v_s.proyecto_id is not null then
    select id into v_bodega_destino_id from sgc.bodegas where proyecto_id = v_s.proyecto_id limit 1;
  end if;
  if v_bodega_destino_id is not null and v_bodega_destino_id <> v_s.bodega_id
     and not exists (select 1 from sgc.entradas_inventario where salida_id = p_salida_id) then
    insert into sgc.entradas_inventario (
      fecha, bodega_id, referencia, observaciones, creado_por,
      origen_tipo, origen_proyecto_id, salida_id
    ) values (
      current_date, v_bodega_destino_id,
      case when v_s.destino_almacen_id is not null then 'Recepción de material trasladado al almacén'
           else 'Recepción de material despachado a la obra' end,
      v_notas, v_uid,
      case when v_s.destino_almacen_id is not null then 'traslado_almacen' else 'recepcion_obra' end,
      v_s.proyecto_id, p_salida_id
    ) returning id into v_entrada_id;
    insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
    select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id and coalesce(d.cantidad_recibida, d.cantidad) > 0;
  end if;

  if v_s.creado_por is not null then
    perform sgc.notificar(v_s.creado_por, 'entrega',
      'Entrega confirmada',
      'El receptor confirmó la recepción de tu conduce.',
      '/transporte/mis-conduces');
  end if;

  return sgc.conduce_fase(p_salida_id);
end;
$$;
grant execute on function sgc.conduce_confirmar_receptor(uuid, text, text, jsonb, jsonb, text) to authenticated, service_role;

-- ── 6) AL8 — "Mis confirmaciones": lo que YO confirmé ────────────────────────
create or replace function sgc.mis_confirmaciones(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  id uuid, fecha date, created_at timestamptz,
  proyecto_id uuid, destino text, bodega text,
  estado text, fase text,
  entregado_por uuid, entregado_por_nombre text, entregado_en timestamptz,
  recibido_en timestamptz,
  tiene_foto boolean, tiene_firma boolean, incompleta boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    s.id, s.fecha, s.created_at,
    s.proyecto_id,
    coalesce(p.nombre, ba.nombre)::text as destino,
    b.nombre::text,
    s.estado, sgc.conduce_fase(s.id),
    s.entregado_por, ue.nombre, s.entregado_en,
    s.recibido_en,
    (s.recepcion_foto_path is not null),
    exists (select 1 from sgc.salida_firmas sf where sf.salida_id = s.id and sf.rol = 'receptor'),
    (s.estado = 'entregado_incompleto')
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   ba on ba.id = s.destino_almacen_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.usuarios ue on ue.id = s.entregado_por
  where s.recibido_por = auth.uid()
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
  order by s.recibido_en desc nulls last, s.created_at desc
  limit 500;
$$;
grant execute on function sgc.mis_confirmaciones(date, date) to authenticated, service_role;
comment on function sgc.mis_confirmaciones(date, date) is
  'AL8 — historial del propio confirmador: conduces que YO confirmé (recibido_por=auth.uid()). Subconjunto de confirmaciones_historial (AK1). El detalle usa confirmacion_detalle().';

commit;
