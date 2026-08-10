-- =============================================================================
-- PROMPT-1 FASE 1 (AK4 + AK1) — Ronda 10/08/2026. SGC padre.
-- Aditivo, idempotente, retrocompatible.
--
-- AK4 (BUG): la "entrega por confirmar" le llega a TODOS. Dos vectores:
--   (A) Bandeja/badge mis_entregas_por_confirmar(): `or sgc.tiene_modulo('inventario')`
--       => cualquiera con módulo inventario ve TODAS las entregas de TODAS las obras.
--   (B) Notificación en conduce_marcar_entregado(): recorre receptores_de_destino(),
--       que UNE todo el roster proyecto_empleados (peones con cuenta) y NO excluye
--       al chofer/emisor => al chofer le llega "confirma tu propia entrega" y a
--       cualquier empleado raso de la obra.
--
-- FIX: función canónica sgc.confirmadores_de_conduce() = responsables vinculados a
--   la obra destino + capataz/roles de obra vinculados a ESA obra + roles elevados
--   de supervisión (company-wide). Configurable por parámetros (no hardcode, patrón
--   AJ6). Notificación, bandeja y push AF7 usan la MISMA fuente. El emisor se excluye.
--
-- AK1: historial de confirmaciones (RPCs para web y app) sobre recepcion_confirmaciones
--   + salidas_inventario, con visibilidad por matriz.
-- =============================================================================

begin;

-- ── 0) Parámetros de la matriz de destinatarios (validables por Xaviel) ───────
insert into sgc.parametros (clave, valor, descripcion) values
  ('confirmacion_roles_globales',
   'admin,direccion,gerencia,gerente_proyectos,jefe_flota,logistica,ingeniero_oficina',
   'AK4 — roles de supervisión que reciben/ven TODAS las confirmaciones de entrega, de cualquier obra (CSV roles.codigo).'),
  ('confirmacion_roles_obra',
   'capataz,ingeniero_campo,gerente_produccion',
   'AK4 — roles que reciben la confirmación SOLO si están vinculados a la obra destino del conduce (CSV roles.codigo).')
on conflict (clave) do nothing;

-- ── 1) Función canónica: destinatarios de confirmación de un conduce ──────────
-- Fuente ÚNICA de verdad para notificación + bandeja + push. NO incluye al emisor.
create or replace function sgc.confirmadores_de_conduce(p_salida_id uuid)
returns table (usuario_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with s as (select * from sgc.salidas_inventario where id = p_salida_id),
  glob as (select unnest(sgc.param_csv('confirmacion_roles_globales',
             'admin,direccion,gerencia,gerente_proyectos,jefe_flota,logistica,ingeniero_oficina')) as codigo),
  obra as (select unnest(sgc.param_csv('confirmacion_roles_obra',
             'capataz,ingeniero_campo,gerente_produccion')) as codigo)
  -- (A) Responsables/residentes activos de la obra destino
  select pr.usuario_id
    from sgc.proyecto_responsables pr, s
    where pr.proyecto_id = s.proyecto_id and coalesce(pr.activo, true) and pr.usuario_id is not null
  union
  -- (B) Firmante pendiente designado (recepción dejada pendiente / remota)
  select s.firma_pendiente_usuario_id from s where s.firma_pendiente_usuario_id is not null
  union
  -- (C) Usuarios con flag can_confirm_reception (capataz puntual AF14) vinculados a la obra
  select u.id
    from sgc.usuarios u, s
    where coalesce(u.can_confirm_reception, false)
      and exists (
        select 1 from sgc.proyecto_empleados pe
          join sgc.empleados e on e.id = pe.empleado_id
        where pe.proyecto_id = s.proyecto_id and e.usuario_id = u.id and coalesce(pe.activo, true))
  union
  -- (D) Roles de obra (capataz, ing. campo, gte. producción) SOLO si están vinculados a ESTA obra
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
  -- (E) Roles globales de supervisión (company-wide, cualquier obra)
  select ur.usuario_id
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where r.codigo in (select codigo from glob);
$$;
grant execute on function sgc.confirmadores_de_conduce(uuid) to authenticated, service_role;

comment on function sgc.confirmadores_de_conduce(uuid) is
  'AK4 — matriz canónica de destinatarios de confirmación de entrega (responsables de la obra destino + roles de obra vinculados + roles globales de supervisión). Fuente única para notificación/bandeja/push. Configurable por parámetros confirmacion_roles_globales / confirmacion_roles_obra.';

-- ── 2) ¿El usuario actual es destinatario de confirmación de este conduce? ────
create or replace function sgc.es_confirmador_de_conduce(p_salida_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or exists (select 1 from sgc.confirmadores_de_conduce(p_salida_id) c where c.usuario_id = auth.uid());
$$;
grant execute on function sgc.es_confirmador_de_conduce(uuid) to authenticated, service_role;

-- ── 3) Reescribir la NOTIFICACIÓN de "entregado" con la matriz + excluir emisor ─
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

  -- Idempotencia: si ya lo entregó este mismo chofer, pasa en silencio.
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

  -- Foto de entrega OBLIGATORIA (AH7). La firma la aporta el receptor al confirmar.
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

  -- AK4: aviso SOLO a la matriz de confirmadores (in-app + push AF7), EXCLUYENDO
  -- al chofer/emisor. Best-effort.
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

-- ── 4) Reescribir la BANDEJA/COUNT: quitar el broadcast por módulo inventario ──
drop function if exists sgc.mis_entregas_por_confirmar_count();
drop function if exists sgc.mis_entregas_por_confirmar();
create or replace function sgc.mis_entregas_por_confirmar()
returns table (
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text,
  estado text, fase text, entregado_en timestamptz, entrega_foto_path text,
  created_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id, p.nombre, b.nombre, s.estado,
         sgc.conduce_fase(s.id), s.entregado_en, s.entrega_foto_path, s.created_at
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  where s.estado in ('entregado','entregado_incompleto')
    and s.recibido_por is null
    and not exists (select 1 from sgc.recepcion_confirmaciones rc
                    where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id = s.id)
    and not (sgc.es_chofer_de_conduce(s.id) and not sgc.is_admin())  -- el que entregó no confirma
    and sgc.es_confirmador_de_conduce(s.id)                          -- AK4: matriz canónica
  order by s.entregado_en desc nulls last, s.created_at desc;
$$;
grant execute on function sgc.mis_entregas_por_confirmar() to authenticated, service_role;

create or replace function sgc.mis_entregas_por_confirmar_count()
returns integer
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int from sgc.mis_entregas_por_confirmar();
$$;
grant execute on function sgc.mis_entregas_por_confirmar_count() to authenticated, service_role;

-- ── 5) AK1 — Historial de confirmaciones de entrega ──────────────────────────
-- Visibilidad: admin/roles globales ven todo; responsables ven las de sus obras;
-- el chofer/emisor ve las suyas. Se listan conduces ya confirmados (recibido_por
-- no nulo) o con evidencia de recepción registrada.
create or replace function sgc.confirmaciones_historial(
  p_desde       date default null,
  p_hasta       date default null,
  p_proyecto_id uuid default null,
  p_estado      text default null   -- 'completa' | 'incompleta' | null (todas)
)
returns table (
  id uuid, fecha date, created_at timestamptz,
  proyecto_id uuid, proyecto text, bodega text,
  estado text, fase text,
  entregado_por uuid, entregado_por_nombre text, entregado_en timestamptz,
  recibido_por uuid, recibido_por_nombre text, recibido_en timestamptz,
  tiene_foto boolean, tiene_firma boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    s.id, s.fecha, s.created_at,
    s.proyecto_id, p.nombre, b.nombre,
    s.estado, sgc.conduce_fase(s.id),
    s.entregado_por, ue.nombre, s.entregado_en,
    s.recibido_por, ur.nombre, s.recibido_en,
    (s.recepcion_foto_path is not null),
    exists (select 1 from sgc.salida_firmas sf where sf.salida_id = s.id and sf.rol = 'receptor')
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.usuarios ue on ue.id = s.entregado_por
  left join sgc.usuarios ur on ur.id = s.recibido_por
  where s.recibido_por is not null
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
    and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
    and (p_estado is null
         or (p_estado = 'incompleta' and s.estado = 'entregado_incompleto')
         or (p_estado = 'completa'   and s.estado = 'entregado'))
    and (
      sgc.is_admin()
      or exists (select 1 from sgc.usuarios_roles ur2 join sgc.roles r on r.id = ur2.rol_id
                 where ur2.usuario_id = auth.uid()
                   and r.codigo in (select unnest(sgc.param_csv('confirmacion_roles_globales',
                         'admin,direccion,gerencia,gerente_proyectos,jefe_flota,logistica,ingeniero_oficina'))))
      or s.entregado_por = auth.uid()
      or s.creado_por    = auth.uid()
      or s.recibido_por  = auth.uid()
      or exists (select 1 from sgc.proyecto_responsables prr
                 where prr.proyecto_id = s.proyecto_id and prr.usuario_id = auth.uid() and coalesce(prr.activo, true))
    )
  order by s.recibido_en desc nulls last, s.created_at desc
  limit 500;
$$;
grant execute on function sgc.confirmaciones_historial(date, date, uuid, text) to authenticated, service_role;

comment on function sgc.confirmaciones_historial(date, date, uuid, text) is
  'AK1 — historial filtrable de confirmaciones de entrega (fecha/obra/estado). Visibilidad por matriz: admin/roles globales todo; responsables sus obras; chofer/emisor lo suyo.';

-- Detalle de una confirmación (para app; la web reusa el detalle del conduce).
create or replace function sgc.confirmacion_detalle(p_salida_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_out jsonb;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;
  if not (sgc.is_admin()
          or v_s.entregado_por = auth.uid() or v_s.creado_por = auth.uid() or v_s.recibido_por = auth.uid()
          or sgc.es_confirmador_de_conduce(p_salida_id)) then
    raise exception 'No autorizado para ver esta confirmación.';
  end if;

  select jsonb_build_object(
    'id', v_s.id,
    'fecha', v_s.fecha,
    'created_at', v_s.created_at,
    'estado', v_s.estado,
    'fase', sgc.conduce_fase(v_s.id),
    'proyecto', (select nombre from sgc.proyectos where id = v_s.proyecto_id),
    'bodega',   (select nombre from sgc.bodegas   where id = v_s.bodega_id),
    'entregado_por', v_s.entregado_por,
    'entregado_por_nombre', (select nombre from sgc.usuarios where id = v_s.entregado_por),
    'entregado_en', v_s.entregado_en,
    'entrega_foto_path', v_s.entrega_foto_path,
    'recibido_por', v_s.recibido_por,
    'recibido_por_nombre', (select nombre from sgc.usuarios where id = v_s.recibido_por),
    'recibido_en', v_s.recibido_en,
    'recepcion_foto_path', v_s.recepcion_foto_path,
    'notas_recepcion', v_s.notas_recepcion,
    'items', (select jsonb_agg(jsonb_build_object(
                'articulo', a.nombre, 'cantidad', d.cantidad, 'cantidad_recibida', d.cantidad_recibida))
              from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
              where d.salida_id = v_s.id),
    'firmas', (select jsonb_agg(jsonb_build_object(
                'rol', sf.rol, 'nombre', sf.nombre, 'firma_path', sf.firma_path, 'firmado_en', sf.firmado_en))
               from sgc.salida_firmas sf where sf.salida_id = v_s.id),
    'confirmaciones', (select jsonb_agg(jsonb_build_object(
                'confirmado_por', rc.confirmado_por, 'modo', rc.modo, 'fotos', rc.fotos,
                'notas', rc.notas, 'checklist', rc.checklist, 'fecha', rc.created_at))
               from sgc.recepcion_confirmaciones rc
               where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id = v_s.id)
  ) into v_out;
  return v_out;
end;
$$;
grant execute on function sgc.confirmacion_detalle(uuid) to authenticated, service_role;

commit;
