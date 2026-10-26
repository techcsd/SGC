-- CY16 [HU-INV-14] -- visibilidad de sincronización con Odoo (solo lectura +
-- reintento autorizado, como pide la nota técnica: "no crear monitores
-- recurrentes ni cambiar la autoridad de stock como efecto secundario").
--
-- sgc.odoo_eventos/odoo_intentos no tienen NINGUNA policy ni grant a
-- authenticated (a propósito, CY6) -- las únicas puertas de entrada hoy son
-- odoo_v1_reclamar_eventos/finalizar_evento (admin|service_role, para el
-- PROCESADOR). Estas RPCs nuevas son para un HUMANO que mira la pantalla:
-- mismo gate que la pantalla hermana "Outbox atascado" (es_tecnologia()).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

create or replace function sgc.odoo_eventos_listar(
  p_agregado_tipo text default null, p_estado text default null, p_limite integer default 200
)
returns table (
  id uuid, agregado_tipo text, agregado_id text, accion text, revision integer,
  estado text, intentos integer, es_prueba boolean, error text,
  creado_en timestamptz, actualizado_en timestamptz
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
           e.estado, e.intentos, e.es_prueba, e.error, e.creado_en, e.actualizado_en
    from sgc.odoo_eventos e
    where (p_agregado_tipo is null or e.agregado_tipo = p_agregado_tipo)
      and (p_estado is null or e.estado = p_estado)
    order by e.creado_en desc
    limit greatest(1, least(500, coalesce(p_limite, 200)));
end;
$fn$;
comment on function sgc.odoo_eventos_listar is 'CY16 (#16) -- bandeja de solo lectura del outbox Odoo para Tecnología.';
revoke all on function sgc.odoo_eventos_listar(text, text, integer) from public, anon;
grant execute on function sgc.odoo_eventos_listar(text, text, integer) to authenticated;

-- Resumen por tipo/estado -- la "conciliación" que pide el criterio 5, acotada
-- a lo que hoy existe (conteos reales del outbox). Comparar línea por línea
-- contra Odoo de verdad necesita Fase C (nada se publica todavía) y queda
-- fuera de esta pieza, documentado en docs/ODOO-DIAGNOSTICO-CONTRATO.md.
create or replace function sgc.odoo_eventos_resumen()
returns table (agregado_tipo text, estado text, total bigint)
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
    select e.agregado_tipo, e.estado, count(*)
    from sgc.odoo_eventos e
    group by e.agregado_tipo, e.estado
    order by e.agregado_tipo, e.estado;
end;
$fn$;
comment on function sgc.odoo_eventos_resumen is 'CY16 (#16, criterio 5 acotado) -- conteos por tipo/estado del outbox. No compara contra Odoo real (nada se publica todavía, Fase C).';
revoke all on function sgc.odoo_eventos_resumen() from public, anon;
grant execute on function sgc.odoo_eventos_resumen() to authenticated;

-- Detalle de un evento: payload + resultado + historial de intentos (AT11 --
-- todo lo que se intentó enviar/el resultado recibido debe poder verse).
create or replace function sgc.odoo_evento_detalle(p_evento_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_evento sgc.odoo_eventos;
  v_intentos jsonb;
begin
  if not sgc.es_tecnologia() then
    raise exception 'Solo Tecnología puede ver el detalle de sincronización con Odoo' using errcode = '42501';
  end if;
  select * into v_evento from sgc.odoo_eventos where id = p_evento_id;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'procesador', i.procesador, 'estado_resultado', i.estado_resultado,
      'resultado', i.resultado, 'error', i.error,
      'reclamado_en', i.reclamado_en, 'finalizado_en', i.finalizado_en
    ) order by i.finalizado_en desc), '[]'::jsonb)
    into v_intentos
    from sgc.odoo_intentos i where i.evento_id = p_evento_id;

  return jsonb_build_object(
    'evento', to_jsonb(v_evento) - 'lease_token', -- el lease es un detalle interno del procesador, no se expone
    'intentos', v_intentos
  );
end;
$fn$;
comment on function sgc.odoo_evento_detalle is 'CY16 (#16, AT11) -- payload + resultado + historial de intentos de un evento del outbox.';
revoke all on function sgc.odoo_evento_detalle(uuid) from public, anon;
grant execute on function sgc.odoo_evento_detalle(uuid) to authenticated;

-- Reintento HUMANO autorizado (criterio 4): re-encola el evento para que lo
-- recoja el MISMO procesador en su próxima pasada (odoo_v1_reclamar_eventos),
-- sin editar IDs ni resultados desde el navegador. Solo tiene sentido sobre
-- un evento que ya falló/quedó incierto/bloqueado -- uno 'completado' no se
-- re-publica (idempotencia real: eso sería reabrir un documento ya resuelto).
create or replace function sgc.odoo_evento_reintentar(p_evento_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_evento sgc.odoo_eventos;
begin
  if not sgc.es_tecnologia() then
    raise exception 'Solo Tecnología puede reintentar una sincronización con Odoo' using errcode = '42501';
  end if;
  select * into v_evento from sgc.odoo_eventos where id = p_evento_id for update;
  if not found then
    raise exception 'Evento no encontrado';
  end if;
  if v_evento.estado not in ('error', 'incierto', 'bloqueado') then
    raise exception 'Solo se puede reintentar un evento en error/incierto/bloqueado (estado actual: %)', v_evento.estado;
  end if;

  update sgc.odoo_eventos
     set estado = 'pendiente', lease_token = null, lease_hasta = null, actualizado_en = now()
   where id = p_evento_id;

  insert into sgc.odoo_intentos (evento_id, procesador, lease_token, estado_resultado, resultado, error, reclamado_en)
    values (p_evento_id, 'reintento-manual', gen_random_uuid(), 'reintento', null,
            format('Reencolado manualmente por %s', coalesce(auth.uid()::text, 'desconocido')), now());

  return true;
end;
$fn$;
comment on function sgc.odoo_evento_reintentar is 'SGC Odoo foundation v1 (CY16, #16 criterio 4) -- re-encola un evento para el procesador real; nunca edita el resultado a mano.';
revoke all on function sgc.odoo_evento_reintentar(uuid) from public, anon;
grant execute on function sgc.odoo_evento_reintentar(uuid) to authenticated;

commit;
