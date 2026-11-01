-- sql/2026-10-30-de4-transferencias.sql — Ronda DE (PROMPT-128 F5, DE4/DE-11/DE-12)
-- Causa real (docs/de-f0-verificacion.md): la oferta de Misael nunca se creó en
-- el servidor (0 filas en conduce_transferencias en ~6 semanas de prod); Xaviel
-- SÍ es chofer válido (se descartan C1/C2 de CONTEXTO-62). El bug latente que
-- esto además destapa: `ofrecer_transferencia_conduce` insertaba la oferta
-- IGUAL aunque el destino no tuviera usuario — solo se saltaba el push, dejando
-- una oferta "fantasma" que el receptor nunca puede ver ni aceptar, y el
-- ofertante cree que funcionó. Esta migración la rechaza desde el inicio.
--
--   node scripts/apply-migration.mjs sql/2026-10-30-de4-transferencias.sql --env dev

-- ── 0) Columnas para el recordatorio (una vez por lado) ───────────────────────
alter table sgc.conduce_transferencias add column if not exists recordada_receptor_en timestamptz;
alter table sgc.conduce_transferencias add column if not exists recordada_ofertante_en timestamptz;

-- ── 1) choferes_activos(): +tiene_usuario, +obra; solo los que PUEDEN recibir,
--      sin duplicados por usuario_id (cambia el shape → drop primero). ──────────
drop function if exists sgc.choferes_activos();
create function sgc.choferes_activos()
returns table(conductor_id uuid, nombre text, tiene_usuario boolean, obra text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select q.conductor_id, q.nombre, true as tiene_usuario, q.obra
  from (
    select distinct on (c.usuario_id)
      c.id as conductor_id, coalesce(u.nombre, c.nombre) as nombre,
      (select p.nombre from sgc.salidas_inventario s
         join sgc.proyectos p on p.id = s.proyecto_id
        where s.conductor_id = c.id
        order by s.created_at desc limit 1) as obra
    from sgc.conductores c
    join sgc.usuarios u on u.id = c.usuario_id
    where coalesce(c.activo, true)
      and (not sgc.es_usuario_demo() or sgc.es_usuario_demo(c.usuario_id))
    order by c.usuario_id, c.updated_at desc nulls last
  ) q
  order by q.nombre;
$function$;
grant execute on function sgc.choferes_activos() to authenticated;

-- ── 2) ofrecer_transferencia_conduce: rechaza destino sin usuario (DR423) ANTES
--      de insertar nada (hoy insertaba igual y solo se saltaba el push: oferta
--      fantasma). Push apunta a /transporte/conduce-transferencias (DE-12c). ──
create or replace function sgc.ofrecer_transferencia_conduce(p_salida_id uuid, p_a_conductor_id uuid, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_salida sgc.salidas_inventario%rowtype;
  v_chk jsonb;
  v_a_usuario uuid; v_a_nombre text; v_de_nombre text; v_id uuid; v_es_prueba boolean; v_fase text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado'; end if;

  -- CM4: misma regla que la web/app (conduce_puede_transferir). Mensaje claro si no se puede.
  v_chk := sgc.conduce_puede_transferir(p_salida_id);
  if not coalesce((v_chk->>'puede')::boolean, false) then
    raise exception '%', coalesce(v_chk->>'motivo', 'Este conduce no se puede transferir.') using errcode = 'DR423';
  end if;

  if p_a_conductor_id = v_salida.conductor_id then
    raise exception 'El conduce ya está a cargo de ese chofer';
  end if;

  select c.usuario_id, coalesce(u.nombre, c.nombre) into v_a_usuario, v_a_nombre
  from sgc.conductores c left join sgc.usuarios u on u.id = c.usuario_id
  where c.id = p_a_conductor_id and coalesce(c.activo,true);
  if not found then
    raise exception 'Chofer destino no válido';
  end if;
  -- DE-11 — rechazo explícito ANTES de insertar: sin esto, la oferta se creaba
  -- igual y quedaba "fantasma" (el receptor nunca podía verla ni aceptarla).
  if v_a_usuario is null then
    raise exception '% no tiene usuario en el sistema; no puede recibir transferencias.', coalesce(v_a_nombre, 'Este chofer') using errcode = 'DR423';
  end if;

  v_fase := sgc.conduce_fase(p_salida_id);
  v_es_prueba := coalesce(v_salida.es_prueba, false);
  -- El receptor designado (firma_pendiente_usuario_id) NO se toca: la firma la hace la obra.
  insert into sgc.conduce_transferencias (
    salida_id, de_conductor_id, a_conductor_id, ofrecida_por, notas,
    fase_al_transferir, es_prueba, es_prueba_origen)
  values (p_salida_id, v_salida.conductor_id, p_a_conductor_id, v_uid, nullif(trim(p_notas),''),
          v_fase, v_es_prueba, case when v_es_prueba then 'heredado' else 'manual' end)
  returning id into v_id;

  select nombre into v_de_nombre from sgc.usuarios where id = v_uid;
  perform sgc.notificar(v_a_usuario, 'transporte',
    'Te ofrecen un conduce',
    format('%s quiere transferirte la responsabilidad de un conduce. Revísalo y acéptalo con foto y firma.',
           coalesce(v_de_nombre,'Un chofer')),
    '/transporte/conduce-transferencias');

  return v_id;
end;
$function$;
grant execute on function sgc.ofrecer_transferencia_conduce(uuid, uuid, text) to authenticated;

-- ── 3) cancelar_transferencia_conduce — DE-12a: el que ofrece puede cancelar. ──
create or replace function sgc.cancelar_transferencia_conduce(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t sgc.conduce_transferencias%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_t from sgc.conduce_transferencias where id = p_id for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_t.estado <> 'ofrecida' then
    raise exception 'Esta transferencia ya no está pendiente (estado: %).', v_t.estado;
  end if;
  if not (v_t.ofrecida_por = v_uid or sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo quien ofreció, Flota o un administrador puede cancelar esta transferencia.' using errcode = '42501';
  end if;

  update sgc.conduce_transferencias
     set estado = 'cancelada', resuelta_en = now()
   where id = p_id;
end;
$function$;
grant execute on function sgc.cancelar_transferencia_conduce(uuid) to authenticated;

-- ── 4) mis_transferencias_ofrecidas — DE-12a: lo que YO ofrecí, con estado. ───
create or replace function sgc.mis_transferencias_ofrecidas()
returns table(
  id uuid, salida_id uuid, estado text, ofrecida_en timestamptz, resuelta_en timestamptz,
  a_conductor_id uuid, a_nombre text, a_tiene_usuario boolean, notas text,
  conduce_obra text, conduce_bodega text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select t.id, t.salida_id, t.estado, t.ofrecida_en, t.resuelta_en,
         t.a_conductor_id, coalesce(ua.nombre, ac.nombre), (ac.usuario_id is not null), t.notas,
         p.nombre, b.nombre
  from sgc.conduce_transferencias t
  join sgc.salidas_inventario s on s.id = t.salida_id
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas b on b.id = s.bodega_id
  left join sgc.conductores ac on ac.id = t.a_conductor_id
  left join sgc.usuarios ua on ua.id = ac.usuario_id
  where t.ofrecida_por = auth.uid()
    and (not coalesce(t.es_prueba,false) or sgc.is_admin())
  order by t.ofrecida_en desc
  limit 100;
$function$;
grant execute on function sgc.mis_transferencias_ofrecidas() to authenticated;

-- ── 5) Vista para Flota/admin — DE-12e: "Transferencias pendientes" con antigüedad. ──
create or replace function sgc.transferencias_pendientes_flota()
returns table(
  id uuid, salida_id uuid, ofrecida_en timestamptz, antiguedad_horas numeric,
  de_nombre text, a_nombre text, a_tiene_usuario boolean, notas text,
  conduce_obra text, conduce_bodega text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select t.id, t.salida_id, t.ofrecida_en,
         round(extract(epoch from (now() - t.ofrecida_en)) / 3600, 1),
         coalesce(ud.nombre, dc.nombre), coalesce(ua.nombre, ac.nombre), (ac.usuario_id is not null),
         t.notas, p.nombre, b.nombre
  from sgc.conduce_transferencias t
  join sgc.salidas_inventario s on s.id = t.salida_id
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas b on b.id = s.bodega_id
  left join sgc.conductores dc on dc.id = t.de_conductor_id
  left join sgc.usuarios ud on ud.id = dc.usuario_id
  left join sgc.conductores ac on ac.id = t.a_conductor_id
  left join sgc.usuarios ua on ua.id = ac.usuario_id
  where t.estado = 'ofrecida'
    and (sgc.is_admin() or sgc.es_flota_elevado())
    and (not coalesce(t.es_prueba,false) or sgc.is_admin())
  order by t.ofrecida_en asc;
$function$;
grant execute on function sgc.transferencias_pendientes_flota() to authenticated;

-- ── 6) Cron de recordatorio — DE-12d: 4h receptor, 12h ofertante, una vez c/u. ──
create or replace function sgc.recordar_transferencias_pendientes()
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_t record;
begin
  for v_t in
    select t.id, t.salida_id, t.ofrecida_en, ac.usuario_id as a_usuario, t.ofrecida_por,
           coalesce(ud.nombre, dc.nombre) as de_nombre
    from sgc.conduce_transferencias t
    left join sgc.conductores ac on ac.id = t.a_conductor_id
    left join sgc.conductores dc on dc.id = t.de_conductor_id
    left join sgc.usuarios ud on ud.id = dc.usuario_id
    where t.estado = 'ofrecida' and not coalesce(t.es_prueba,false)
      and (
        (t.recordada_receptor_en is null and t.ofrecida_en <= now() - interval '4 hours' and ac.usuario_id is not null)
        or
        (t.recordada_ofertante_en is null and t.ofrecida_en <= now() - interval '12 hours')
      )
  loop
    if v_t.a_usuario is not null then
      perform sgc.notificar(v_t.a_usuario, 'transporte',
        'Tienes una transferencia sin responder',
        format('%s te ofreció un conduce hace horas. Acéptalo o recházalo.', coalesce(v_t.de_nombre,'Un chofer')),
        '/transporte/conduce-transferencias');
      update sgc.conduce_transferencias set recordada_receptor_en = now() where id = v_t.id and recordada_receptor_en is null;
    end if;
    if v_t.ofrecida_en <= now() - interval '12 hours' then
      perform sgc.notificar(v_t.ofrecida_por, 'transporte',
        'Tu transferencia sigue sin respuesta',
        'La oferta de conduce que hiciste lleva más de 12 horas sin que el chofer la acepte. Puedes cancelarla.',
        '/transporte/conduce-transferencias');
      update sgc.conduce_transferencias set recordada_ofertante_en = now() where id = v_t.id and recordada_ofertante_en is null;
    end if;
  end loop;
end;
$function$;

select cron.schedule(
  'sgc-recordar-transferencias',
  '*/30 * * * *',
  $cron$ select sgc.recordar_transferencias_pendientes(); $cron$
);
