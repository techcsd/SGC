-- 2026-10-08-ck15-trabajos-transporte.sql
-- CK14/CK15/CK16 — "Trabajos de transporte" (bandeja de Misael) + eventos del chofer +
-- panel "Mis choferes". Fuente única por UNIÓN de lo que ya existe (apoyos en
-- solicitudes_movimiento + conduces despachados sin chofer) + actividades manuales.
-- Tabla solo para lo que no tiene hogar (actividades manuales + eventos del chofer).
-- Gate: es_flota_elevado() (Misael = jefe_flota + logística).
--   node scripts/apply-migration.mjs sql/2026-10-08-ck15-trabajos-transporte.sql --env dev

begin;

-- ── Actividades manuales (lo que Misael inventa, no viene de una solicitud) ────────
create table if not exists sgc.trabajos_manual (
  id          uuid primary key default gen_random_uuid(),
  descripcion text not null,
  proyecto_id uuid references sgc.proyectos(id),
  dia         date not null default current_date,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','asignada','en_proceso','por_confirmar','completada','cancelada')),
  conductor_id uuid references sgc.conductores(id),
  vehiculo_id uuid references sgc.vehiculos(id),
  ruta_id     uuid references sgc.rutas(id),
  orden       int not null default 0,
  nota        text,
  creado_por  uuid references sgc.usuarios(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table sgc.trabajos_manual enable row level security;
drop policy if exists trabajos_manual_sel on sgc.trabajos_manual;
create policy trabajos_manual_sel on sgc.trabajos_manual for select to authenticated
  using (sgc.es_flota_elevado() or creado_por = auth.uid()
         or exists (select 1 from sgc.conductores c where c.id = conductor_id and c.usuario_id = auth.uid()));
grant select on sgc.trabajos_manual to authenticated, service_role;

-- ── Eventos del chofer sobre un trabajo (CK14) ────────────────────────────────────
create table if not exists sgc.trabajo_eventos (
  id          uuid primary key default gen_random_uuid(),
  origen      text not null check (origen in ('apoyo','requisicion','manual')),
  origen_id   uuid not null,
  evento      text not null check (evento in ('en_camino','llegue','trabajando','termine','problema')),
  nota        text,
  lat         double precision,
  lng         double precision,
  foto_path   text,
  por         uuid references sgc.usuarios(id),
  hora_cliente timestamptz,
  client_id   uuid unique,
  created_at  timestamptz not null default now()
);
create index if not exists idx_trabajo_eventos_origen on sgc.trabajo_eventos(origen, origen_id);
alter table sgc.trabajo_eventos enable row level security;
drop policy if exists trabajo_eventos_sel on sgc.trabajo_eventos;
create policy trabajo_eventos_sel on sgc.trabajo_eventos for select to authenticated
  using (sgc.es_flota_elevado() or por = auth.uid());
grant select on sgc.trabajo_eventos to authenticated, service_role;

-- ── Listado unificado de tickets (apoyos + conduces sin chofer + manuales) ─────────
create or replace function sgc.trabajos_transporte_listado(
  p_dia date default null, p_estado text default null, p_conductor_id uuid default null)
returns table(origen text, origen_id uuid, tipo text, descripcion text, proyecto_id uuid,
              proyecto text, dia date, estado text, conductor_id uuid, conductor text,
              vehiculo_id uuid, ruta_id uuid, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with t as (
    -- Apoyos de transporte
    select 'apoyo'::text origen, s.id origen_id, s.tipo_apoyo tipo,
           coalesce(s.descripcion, s.que_se_mueve) descripcion, s.proyecto_id,
           s.dia, s.estado, s.conductor_id, null::uuid vehiculo_id, s.ruta_id, s.created_at
      from sgc.solicitudes_movimiento s
     where coalesce(s.es_prueba,false) = false
    union all
    -- Conduces despachados listos para salir sin chofer (requisición/salida)
    select 'requisicion'::text, si.id, 'conduce'::text,
           'Conduce por asignar', si.proyecto_id,
           si.fecha, 'pendiente'::text, si.conductor_id, si.vehiculo_id, si.ruta_id, si.created_at
      from sgc.salidas_inventario si
     where si.estado = 'despachado' and si.conductor_id is null and si.anulado_por is null
       and coalesce(si.es_prueba,false) = false
    union all
    -- Actividades manuales
    select 'manual'::text, m.id, 'actividad'::text, m.descripcion, m.proyecto_id,
           m.dia, m.estado, m.conductor_id, m.vehiculo_id, m.ruta_id, m.created_at
      from sgc.trabajos_manual m
  )
  select t.origen, t.origen_id, t.tipo, t.descripcion, t.proyecto_id,
         p.nombre, t.dia, t.estado, t.conductor_id, c.nombre, t.vehiculo_id, t.ruta_id, t.created_at
    from t
    left join sgc.proyectos p on p.id = t.proyecto_id
    left join sgc.conductores c on c.id = t.conductor_id
   where sgc.es_flota_elevado()
     and (p_dia is null or t.dia = p_dia)
     and (p_estado is null or t.estado = p_estado)
     and (p_conductor_id is null or t.conductor_id = p_conductor_id)
   order by t.created_at desc;
$function$;
grant execute on function sgc.trabajos_transporte_listado(date,text,uuid) to authenticated, service_role;

-- ── Crear actividad manual ────────────────────────────────────────────────────────
create or replace function sgc.actividad_crear(
  p_descripcion text, p_proyecto_id uuid default null, p_dia date default null, p_conductor_id uuid default null)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_id uuid;
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado.' using errcode='42501'; end if;
  if nullif(trim(p_descripcion),'') is null then raise exception 'Describe la actividad.' using errcode='22023'; end if;
  insert into sgc.trabajos_manual (descripcion, proyecto_id, dia, conductor_id, estado, creado_por)
  values (trim(p_descripcion), p_proyecto_id, coalesce(p_dia, current_date), p_conductor_id,
          case when p_conductor_id is not null then 'asignada' else 'pendiente' end, auth.uid())
  returning id into v_id;
  if p_conductor_id is not null then
    perform sgc.notificar((select usuario_id from sgc.conductores where id=p_conductor_id),
      'solicitud_movimiento', 'Nueva actividad asignada', left(trim(p_descripcion),80), '/transporte/mis-trabajos');
  end if;
  return v_id;
end;
$function$;
grant execute on function sgc.actividad_crear(text,uuid,date,uuid) to authenticated, service_role;

-- ── Asignar un ticket a un chofer (reusa el planificar de cada fuente) ─────────────
create or replace function sgc.trabajo_asignar(
  p_origen text, p_origen_id uuid, p_conductor_id uuid, p_vehiculo_id uuid default null, p_dia date default null)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_cond_usuario uuid;
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado.' using errcode='42501'; end if;
  if p_conductor_id is null then raise exception 'Elige un chofer.' using errcode='22023'; end if;

  if p_origen = 'apoyo' then
    perform sgc.planificar_solicitud_con_ruta(p_origen_id, p_vehiculo_id, p_conductor_id, p_dia, null);
  elsif p_origen = 'requisicion' then
    perform sgc.asignar_chofer_conduce(p_origen_id, p_conductor_id, p_vehiculo_id);
  elsif p_origen = 'manual' then
    update sgc.trabajos_manual
       set conductor_id = p_conductor_id, vehiculo_id = p_vehiculo_id,
           estado = case when estado='pendiente' then 'asignada' else estado end,
           dia = coalesce(p_dia, dia), updated_at = now()
     where id = p_origen_id;
    select usuario_id into v_cond_usuario from sgc.conductores where id = p_conductor_id;
    if v_cond_usuario is not null then
      perform sgc.notificar(v_cond_usuario, 'solicitud_movimiento', 'Actividad asignada',
        (select left(descripcion,80) from sgc.trabajos_manual where id=p_origen_id), '/transporte/mis-trabajos');
    end if;
  else
    raise exception 'Origen inválido.' using errcode='22023';
  end if;
end;
$function$;
grant execute on function sgc.trabajo_asignar(text,uuid,uuid,uuid,date) to authenticated, service_role;

-- ── El chofer reporta su trabajo (CK14) ───────────────────────────────────────────
create or replace function sgc.trabajo_evento_chofer(
  p_origen text, p_origen_id uuid, p_evento text, p_nota text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_foto_path text default null, p_client_id uuid default null, p_hora_cliente timestamptz default null)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_estado_actual text;
  v_nuevo text;
  v_tiene_otro boolean;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode='42501'; end if;
  if p_evento not in ('en_camino','llegue','trabajando','termine','problema') then
    raise exception 'Evento inválido.' using errcode='22023';
  end if;

  -- Idempotencia por client_id (outbox).
  if p_client_id is not null then
    select id into v_id from sgc.trabajo_eventos where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  insert into sgc.trabajo_eventos (origen, origen_id, evento, nota, lat, lng, foto_path, por, hora_cliente, client_id)
  values (p_origen, p_origen_id, p_evento, nullif(trim(p_nota),''), p_lat, p_lng, nullif(p_foto_path,''),
          v_uid, coalesce(p_hora_cliente, now()), p_client_id)
  returning id into v_id;

  -- Mueve el ticket: primer evento → en_proceso; "termine" → por_confirmar.
  v_nuevo := case when p_evento = 'termine' then 'por_confirmar' else 'en_proceso' end;
  if p_origen = 'apoyo' then
    select estado into v_estado_actual from sgc.solicitudes_movimiento where id = p_origen_id;
    if v_estado_actual in ('asignada','en_proceso') or (p_evento='termine' and v_estado_actual='en_proceso') then
      update sgc.solicitudes_movimiento set estado = v_nuevo where id = p_origen_id
        and estado not in ('completada','cancelada');
    end if;
  elsif p_origen = 'manual' then
    update sgc.trabajos_manual set estado = v_nuevo, updated_at = now()
     where id = p_origen_id and estado not in ('completada','cancelada');
  end if;
  -- (requisicion/conduce: su estado lo gobierna el flujo de entrega del conduce)

  -- Estado del chofer: en_ruta mientras trabaja; vuelve a disponible al terminar si no
  -- tiene otro trabajo en curso. NO pisa descanso/almuerzo/inactivo/otros (son suyos, CI5).
  select estado into v_estado_actual from sgc.chofer_estado where usuario_id = v_uid;
  if v_estado_actual is null or v_estado_actual in ('disponible','en_ruta') then
    if p_evento = 'termine' then
      select exists (
        select 1 from sgc.trabajos_manual m where m.conductor_id in (select id from sgc.conductores where usuario_id=v_uid)
          and m.estado = 'en_proceso' and m.id <> p_origen_id
      ) into v_tiene_otro;
      perform sgc._set_chofer_estado(v_uid, case when v_tiene_otro then 'en_ruta' else 'disponible' end, null, 'auto');
    elsif p_evento in ('en_camino','llegue','trabajando') then
      perform sgc._set_chofer_estado(v_uid, 'en_ruta', null, 'auto');
    end if;
  end if;

  -- Avisos: al ingeniero en camino/llegué/terminé; a Misael en problema.
  if p_evento = 'problema' then
    perform sgc._notificar_referentes_movimiento('Un chofer reportó un problema',
      coalesce(nullif(trim(p_nota),''), 'Sin detalle'), '/transporte/mis-choferes');
  end if;
  return v_id;
end;
$function$;
grant execute on function sgc.trabajo_evento_chofer(text,uuid,text,text,double precision,double precision,text,uuid,timestamptz) to authenticated, service_role;

-- ── Panel "Mis choferes" (CK16) ───────────────────────────────────────────────────
create or replace function sgc.mis_choferes_panel()
returns table(conductor_id uuid, usuario_id uuid, nombre text, telefono text,
              estado text, estado_desde timestamptz, trabajos_hoy bigint, en_proceso bigint,
              vehiculo_en_uso text, ultima_senal timestamptz, bateria int)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select c.id, c.usuario_id, coalesce(u.nombre, c.nombre)::text, coalesce(c.telefono, u.telefono)::text,
         coalesce(ce.estado, 'sin_estado'), ce.desde,
         (select count(*) from sgc.trabajos_manual m where m.conductor_id = c.id and m.dia = current_date)
           + (select count(*) from sgc.solicitudes_movimiento s where s.conductor_id = c.id and s.dia = current_date),
         (select count(*) from sgc.trabajos_manual m where m.conductor_id = c.id and m.estado='en_proceso')
           + (select count(*) from sgc.solicitudes_movimiento s where s.conductor_id = c.id and s.estado='en_proceso'),
         (select v.placa from sgc.vehiculo_usos uu join sgc.vehiculos v on v.id=uu.vehiculo_id
           where uu.usuario_id = c.usuario_id and uu.fin_at is null order by uu.inicio_at desc limit 1),
         up.capturado_en, up.bateria
    from sgc.conductores c
    left join sgc.usuarios u on u.id = c.usuario_id
    left join sgc.chofer_estado ce on ce.usuario_id = c.usuario_id
    left join sgc.chofer_ultima_posicion up on up.usuario_id = c.usuario_id
   where sgc.es_flota_elevado() and coalesce(c.activo, true)
   order by case coalesce(ce.estado,'') when 'en_ruta' then 0 else 1 end, coalesce(u.nombre, c.nombre);
$function$;
grant execute on function sgc.mis_choferes_panel() to authenticated, service_role;

commit;
