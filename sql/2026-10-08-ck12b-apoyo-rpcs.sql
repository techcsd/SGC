-- 2026-10-08-ck12b-apoyo-rpcs.sql
-- CK12/CK13 — RPCs de "Apoyo de transporte": crear (idempotente + foto), agregar foto,
-- listado, detalle y cambiar_estado (matriz de transiciones por rol en el servidor).
-- Evoluciona solicitudes_movimiento (ck12). Los RPCs viejos (crear_solicitud_movimiento*,
-- completar/cancelar) siguen válidos (rows nuevas caen a tipo_apoyo='movimiento_interno').
--   node scripts/apply-migration.mjs sql/2026-10-08-ck12b-apoyo-rpcs.sql --env dev

begin;

-- Idempotencia por client_id (outbox de la app).
alter table sgc.solicitudes_movimiento add column if not exists client_id uuid;
create unique index if not exists uq_solicitudes_movimiento_client_id
  on sgc.solicitudes_movimiento(client_id) where client_id is not null;

-- ── Crear un apoyo de transporte (idempotente por client_id) ──────────────────────
create or replace function sgc.apoyo_transporte_crear(
  p_tipo_apoyo text,
  p_proyecto_id uuid,
  p_dia date,
  p_descripcion text,
  p_destino_tipo text default null,
  p_destino_texto text default null,
  p_destino_bodega_id uuid default null,
  p_destino_proyecto_id uuid default null,
  p_es_danado boolean default false,
  p_client_id uuid default null)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_tipo text := lower(coalesce(nullif(trim(p_tipo_apoyo),''),'movimiento_interno'));
  v_desc text := nullif(trim(p_descripcion),'');
  v_dest_tipo text;
  v_dest_texto text;
  v_proy text; v_sol text;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode='42501'; end if;
  if v_tipo not in ('movimiento_interno','retiro_material','bote') then
    raise exception 'Tipo de apoyo inválido.' using errcode='22023';
  end if;
  if v_desc is null or length(v_desc) < 3 then
    raise exception 'Describe qué hay que mover (mínimo 3 caracteres).' using errcode='22023';
  end if;

  -- Idempotencia.
  if p_client_id is not null then
    select id into v_id from sgc.solicitudes_movimiento where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- Destino por tipo: bote → vertedero fijo; retiro → almacén; interno → lo que venga.
  if v_tipo = 'bote' then
    v_dest_tipo := 'otro'; v_dest_texto := 'Bote (vertedero)';
  elsif v_tipo = 'retiro_material' then
    v_dest_tipo := coalesce(nullif(p_destino_tipo,''),'almacen'); v_dest_texto := nullif(trim(p_destino_texto),'');
  else
    v_dest_tipo := coalesce(nullif(p_destino_tipo,''),'obra'); v_dest_texto := nullif(trim(p_destino_texto),'');
  end if;

  insert into sgc.solicitudes_movimiento (
    solicitante_id, proyecto_id, tipo_apoyo, dia, descripcion, que_se_mueve,
    origen_tipo, origen_proyecto_id,
    destino_tipo, destino_texto, destino_bodega_id, destino_proyecto_id,
    estado, created_by, client_id
  ) values (
    v_uid, p_proyecto_id, v_tipo, coalesce(p_dia, current_date), v_desc, v_desc,
    'obra', p_proyecto_id,
    v_dest_tipo, v_dest_texto, p_destino_bodega_id, p_destino_proyecto_id,
    'pendiente', v_uid, p_client_id
  ) returning id into v_id;

  insert into sgc.apoyo_transporte_eventos (solicitud_id, de, a, por, nota)
  values (v_id, null, 'pendiente', v_uid, 'Creó el apoyo de transporte');

  -- Aviso a los referentes de transporte (Misael, Raykler, etc.).
  select nombre into v_proy from sgc.proyectos where id = p_proyecto_id;
  select nombre into v_sol  from sgc.usuarios  where id = v_uid;
  perform sgc._notificar_referentes_movimiento(
    'Nuevo apoyo de transporte',
    coalesce(v_sol,'Un ingeniero')||' pidió '||
      case v_tipo when 'retiro_material' then 'un retiro de material'
                  when 'bote' then 'un bote' else 'un movimiento' end||
      ': '||left(v_desc,80)||coalesce(' · '||v_proy,''),
    '/transporte/apoyo');

  -- Nota: el enlace al retiro bg4 (p_es_danado) se completa en una iteración posterior.
  return v_id;
end;
$function$;
grant execute on function sgc.apoyo_transporte_crear(text,uuid,date,text,text,text,uuid,uuid,boolean,uuid) to authenticated, service_role;

-- ── Agregar una foto (idempotente por client_id de la foto) ───────────────────────
create or replace function sgc.apoyo_transporte_agregar_foto(
  p_solicitud_id uuid, p_path text, p_client_id uuid default null)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode='42501'; end if;
  if not sgc.puede_ver_apoyo(p_solicitud_id) then
    raise exception 'No autorizado.' using errcode='42501';
  end if;
  if p_client_id is not null then
    select id into v_id from sgc.apoyo_transporte_fotos where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into sgc.apoyo_transporte_fotos (solicitud_id, path, tomada_por, client_id)
  values (p_solicitud_id, p_path, v_uid, p_client_id)
  returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function sgc.apoyo_transporte_agregar_foto(uuid,text,uuid) to authenticated, service_role;

-- ── Cambiar estado (matriz por rol; CK13) ─────────────────────────────────────────
create or replace function sgc.apoyo_transporte_cambiar_estado(
  p_id uuid, p_estado text, p_nota text default null, p_client_id uuid default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s sgc.solicitudes_movimiento%rowtype;
  v_elevado boolean := sgc.es_referente_movimiento();
  v_es_suyo boolean;
  v_destino text := lower(coalesce(nullif(trim(p_estado),''),''));
  v_nota text := nullif(trim(p_nota),'');
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode='42501'; end if;
  select * into v_s from sgc.solicitudes_movimiento where id = p_id;
  if not found then raise exception 'Apoyo no encontrado.' using errcode='22023'; end if;

  v_es_suyo := v_s.solicitante_id = v_uid or v_s.created_by = v_uid
               or (v_s.proyecto_id is not null and sgc.es_miembro_obra(v_s.proyecto_id));

  if not (v_elevado or v_es_suyo) then
    raise exception 'No puedes cambiar el estado de este apoyo.' using errcode='42501';
  end if;
  if v_s.estado in ('completada','cancelada') then
    raise exception 'El apoyo ya está %.', v_s.estado using errcode='22023';
  end if;
  if v_destino not in ('asignada','en_proceso','por_confirmar','completada','cancelada') then
    raise exception 'Estado inválido.' using errcode='22023';
  end if;

  -- Reglas por rol (CK13):
  --  • cancelar: el solicitante solo en pendiente; el referente siempre.
  --  • completar / confirmar: el solicitante o el referente ("he knows when it finish").
  --  • volver de por_confirmar a en_proceso ("no se ha hecho"): nota obligatoria.
  if v_destino = 'cancelada' then
    if not v_elevado and v_s.estado <> 'pendiente' then
      raise exception 'Solo puedes cancelar mientras está pendiente; pídele al referente que la gestione.' using errcode='42501';
    end if;
  elsif v_destino = 'en_proceso' and v_s.estado = 'por_confirmar' then
    if v_nota is null then
      raise exception 'Escribe por qué aún no se ha hecho.' using errcode='22023';
    end if;
  elsif v_destino = 'asignada' then
    -- asignar es cosa del referente (lo hace al dar el ticket a un chofer).
    if not v_elevado then raise exception 'Solo transporte asigna el apoyo.' using errcode='42501'; end if;
  end if;

  update sgc.solicitudes_movimiento
     set estado = v_destino,
         completada_por = case when v_destino='completada' then v_uid else completada_por end,
         completada_at  = case when v_destino='completada' then now() else completada_at end,
         cancelada_por  = case when v_destino='cancelada' then v_uid else cancelada_por end,
         cancelada_at   = case when v_destino='cancelada' then now() else cancelada_at end,
         motivo_cancelacion = case when v_destino='cancelada' then coalesce(v_nota, motivo_cancelacion) else motivo_cancelacion end
   where id = p_id;

  insert into sgc.apoyo_transporte_eventos (solicitud_id, de, a, por, nota)
  values (p_id, v_s.estado, v_destino, v_uid, v_nota);

  -- Avisos a los involucrados.
  if v_s.solicitante_id is not null and v_s.solicitante_id <> v_uid then
    perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento',
      'Tu apoyo de transporte cambió de estado',
      'Ahora está: '||v_destino||coalesce(' — '||v_nota,'')||'.',
      '/transporte/apoyo');
  end if;
  if v_destino in ('por_confirmar','en_proceso') then
    perform sgc._notificar_referentes_movimiento(
      'Apoyo de transporte: '||v_destino,
      left(coalesce(v_s.descripcion, v_s.que_se_mueve),80)||coalesce(' — '||v_nota,''),
      '/transporte/apoyo');
  end if;
end;
$function$;
grant execute on function sgc.apoyo_transporte_cambiar_estado(uuid,text,text,uuid) to authenticated, service_role;

-- ── Detalle (con fotos + línea de tiempo) ─────────────────────────────────────────
create or replace function sgc.apoyo_transporte_detalle(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_json jsonb;
begin
  if not sgc.puede_ver_apoyo(p_id) then raise exception 'No autorizado.' using errcode='42501'; end if;
  select to_jsonb(s) ||
    jsonb_build_object(
      'proyecto', (select nombre from sgc.proyectos where id = s.proyecto_id),
      'solicitante', (select nombre from sgc.usuarios where id = s.solicitante_id),
      'conductor', (select c.nombre from sgc.conductores c where c.id = s.conductor_id),
      'fotos', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'path',f.path) order by f.created_at)
                         from sgc.apoyo_transporte_fotos f where f.solicitud_id = s.id), '[]'::jsonb),
      'eventos', coalesce((select jsonb_agg(jsonb_build_object('de',e.de,'a',e.a,'nota',e.nota,
                             'por',(select nombre from sgc.usuarios where id=e.por),'created_at',e.created_at)
                             order by e.created_at) from sgc.apoyo_transporte_eventos e where e.solicitud_id = s.id), '[]'::jsonb)
    )
    into v_json
    from sgc.solicitudes_movimiento s where s.id = p_id;
  return v_json;
end;
$function$;
grant execute on function sgc.apoyo_transporte_detalle(uuid) to authenticated, service_role;

-- ── Listado (filtros opcionales) ──────────────────────────────────────────────────
create or replace function sgc.apoyo_transporte_listado(
  p_tipo text default null, p_estado text default null, p_proyecto_id uuid default null, p_dia date default null)
returns table(id uuid, tipo_apoyo text, proyecto_id uuid, proyecto text, dia date, descripcion text,
              estado text, solicitante text, conductor_id uuid, ruta_id uuid,
              foto_path text, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select s.id, s.tipo_apoyo, s.proyecto_id, p.nombre, s.dia, coalesce(s.descripcion, s.que_se_mueve),
         s.estado, u.nombre, s.conductor_id, s.ruta_id,
         (select f.path from sgc.apoyo_transporte_fotos f where f.solicitud_id = s.id order by f.created_at limit 1),
         s.created_at
    from sgc.solicitudes_movimiento s
    left join sgc.proyectos p on p.id = s.proyecto_id
    left join sgc.usuarios  u on u.id = s.solicitante_id
   where sgc.puede_ver_apoyo(s.id)
     and (not coalesce(s.es_prueba,false) or sgc.is_admin())
     and (p_tipo is null or s.tipo_apoyo = p_tipo)
     and (p_estado is null or s.estado = p_estado)
     and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
     and (p_dia is null or s.dia = p_dia)
   order by s.created_at desc;
$function$;
grant execute on function sgc.apoyo_transporte_listado(text,text,uuid,date) to authenticated, service_role;

commit;
