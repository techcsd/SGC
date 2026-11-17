-- DS-24 (ronda DS, 16-nov-2026; issues #57 resto/#24): compras.
--  1) Motivo de rechazo OBLIGATORIO (>= 10 caracteres) tambien en solicitudes de material (la de compra ya lo exigia),
--     y el motivo de compra queda en su campo propio `motivo_rechazo` (antes solo en `notas`).
--  2) Panel de solicitudes vencidas con cierre masivo con motivo (Compras / Inventario / admin).
--  3) Metrica «entradas con OC» para el tablero de adopcion.
-- ADITIVA: solo create or replace de funciones existentes (misma firma) + funciones nuevas + 1 parametro.

insert into sgc.parametros (clave, valor, descripcion) values
  ('solicitud_vencida_dias', '7', 'DS-24: dias sin respuesta tras los que una solicitud de compra/material pendiente se considera vencida (panel de cierre masivo).')
on conflict (clave) do nothing;

create or replace function sgc.rechazar_solicitud_material(p_solicitud_id uuid, p_notas text default null)
returns void language plpgsql as $function$
declare
  v_sol sgc.solicitudes_material%rowtype;
begin
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;

  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esta solicitud ya fue procesada.'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para rechazar solicitudes de materiales.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() and not sgc.puede_autoaprobar_requisicion() then
    raise exception 'No puedes rechazar tu propia solicitud.';
  end if;
  -- DS-24: el motivo es obligatorio (misma regla que la solicitud de compra).
  if length(btrim(coalesce(p_notas, ''))) < 10 then
    raise exception 'El motivo del rechazo debe tener al menos 10 caracteres.' using errcode = '22023';
  end if;

  update sgc.solicitudes_material
     set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
         motivo_rechazo = btrim(p_notas),
         updated_at = now()
   where id = p_solicitud_id;
end;
$function$;

create or replace function sgc.rechazar_solicitud_compra(p_solicitud_id uuid, p_notas text default null)
returns void language plpgsql as $function$
declare
  v_sol sgc.solicitudes_compra%rowtype;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esta solicitud ya fue procesada.'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'No autorizado para rechazar solicitudes de compra.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes rechazar tu propia solicitud.';
  end if;
  if length(btrim(coalesce(p_notas,''))) < 10 then
    raise exception 'El motivo del rechazo debe tener al menos 10 caracteres.' using errcode = '22023';
  end if;

  update sgc.solicitudes_compra
  set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
      notas = btrim(p_notas), motivo_rechazo = btrim(p_notas), updated_at = now()
  where id = p_solicitud_id;
end;
$function$;

-- Panel: pendientes con mas de `solicitud_vencida_dias` dias sin respuesta (compra y material; sin pruebas).
create or replace function sgc.solicitudes_vencidas_listar()
returns table (tipo text, id uuid, folio text, descripcion text, proyecto text, solicitante text, creada_en timestamptz, dias integer)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_dias integer;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario')) then
    raise exception 'No tienes acceso a las solicitudes vencidas.' using errcode = '42501';
  end if;
  select coalesce(nullif(valor, '')::integer, 7) into v_dias from sgc.parametros where clave = 'solicitud_vencida_dias';
  v_dias := coalesce(v_dias, 7);
  return query
    select 'compra'::text, c.id, upper(left(replace(c.id::text, '-', ''), 8)), coalesce(nullif(c.titulo, ''), nullif(c.notas, ''), 'Solicitud de compra'),
           p.nombre::text, u.nombre::text, c.created_at, (extract(day from now() - c.created_at))::integer
      from sgc.solicitudes_compra c
      left join sgc.proyectos p on p.id = c.proyecto_id
      left join sgc.usuarios u on u.id = c.solicitante_id
     where c.estado = 'pendiente' and c.created_at < now() - make_interval(days => v_dias)
       and (sgc.is_admin() or sgc.tiene_modulo('compras'))
    union all
    select 'material'::text, m.id, 'REQ-' || coalesce(m.folio::text, upper(left(replace(m.id::text, '-', ''), 8))), coalesce(nullif(m.notas, ''), 'Solicitud de material'),
           p.nombre::text, u.nombre::text, m.created_at, (extract(day from now() - m.created_at))::integer
      from sgc.solicitudes_material m
      left join sgc.proyectos p on p.id = m.proyecto_id
      left join sgc.usuarios u on u.id = m.solicitante_id
     where m.estado = 'pendiente' and coalesce(m.es_prueba, false) = false and m.created_at < now() - make_interval(days => v_dias)
       and (sgc.is_admin() or sgc.tiene_modulo('inventario'))
    order by 7;
end $fn$;

-- Cierre masivo con motivo obligatorio. p_items = [{"tipo":"compra|material","id":"<uuid>"}]. Devuelve cuantas cerro.
-- Compra -> rechazada (con motivo); material -> cancelada (con motivo y quien/cuando cerro). Avisa al solicitante.
create or replace function sgc.solicitudes_vencidas_cerrar(p_items jsonb, p_motivo text)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_item jsonb; v_n integer := 0; v_c sgc.solicitudes_compra%rowtype; v_m sgc.solicitudes_material%rowtype; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if length(v_motivo) < 10 then raise exception 'El motivo del cierre debe tener al menos 10 caracteres.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'No hay solicitudes seleccionadas.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Demasiadas solicitudes en una sola operación (máximo 200).' using errcode = '22023'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if v_item->>'tipo' = 'compra' then
      if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No autorizado para cerrar solicitudes de compra.' using errcode = '42501'; end if;
      select * into v_c from sgc.solicitudes_compra where id = (v_item->>'id')::uuid and estado = 'pendiente' for update;
      if found then
        update sgc.solicitudes_compra set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
               notas = 'Cierre por vencimiento: ' || v_motivo, motivo_rechazo = v_motivo, updated_at = now() where id = v_c.id;
        perform sgc.notificar(v_c.solicitante_id, 'info', 'Solicitud de compra cerrada', 'Se cerró por falta de respuesta: ' || v_motivo, '/compras/solicitar');
        v_n := v_n + 1;
      end if;
    elsif v_item->>'tipo' = 'material' then
      if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then raise exception 'No autorizado para cerrar solicitudes de material.' using errcode = '42501'; end if;
      select * into v_m from sgc.solicitudes_material where id = (v_item->>'id')::uuid and estado = 'pendiente' for update;
      if found then
        update sgc.solicitudes_material set estado = 'cancelada', cancelada_motivo = 'Cierre por vencimiento: ' || v_motivo,
               cerrada_por = auth.uid(), cerrada_en = now(), atendido_por = auth.uid(), atendido_en = now(), updated_at = now() where id = v_m.id;
        perform sgc.notificar(v_m.solicitante_id, 'info', 'Solicitud de material cerrada', 'Se cerró por falta de respuesta: ' || v_motivo, '/inventario/requisiciones');
        v_n := v_n + 1;
      end if;
    else
      raise exception 'Tipo de solicitud desconocido.' using errcode = '22023';
    end if;
  end loop;
  return v_n;
end $fn$;

-- Metrica de adopcion: entradas de inventario que nacieron de una OC (vs. entradas sueltas). Sin pruebas ni rechazadas.
create or replace function sgc.adopcion_entradas_con_oc(p_desde date default (current_date - 30), p_hasta date default current_date)
returns table (total bigint, con_oc bigint, pct numeric)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('direccion')) then
    raise exception 'No tienes acceso a esta métrica.' using errcode = '42501';
  end if;
  return query
    select count(*), count(*) filter (where e.orden_compra_id is not null),
           case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where e.orden_compra_id is not null) / count(*), 1) end
      from sgc.entradas_inventario e
     where coalesce(e.es_prueba, false) = false and coalesce(e.rechazada, false) = false and e.fecha between p_desde and p_hasta;
end $fn$;

revoke all on function sgc.solicitudes_vencidas_listar(), sgc.solicitudes_vencidas_cerrar(jsonb, text), sgc.adopcion_entradas_con_oc(date, date) from public, anon;
grant execute on function sgc.solicitudes_vencidas_listar(), sgc.solicitudes_vencidas_cerrar(jsonb, text), sgc.adopcion_entradas_con_oc(date, date) to authenticated; -- gatean adentro
