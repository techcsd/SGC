-- ════════════════════════════════════════════════════════════════════════════
-- AY11 — Módulo NUEVO: "Solicitud de movimiento" (logística de transporte)
-- ════════════════════════════════════════════════════════════════════════════
-- Un ingeniero solicita al departamento de transporte que muevan material/equipo
-- de un origen a un destino, con prioridad y fecha de requerimiento. Los roles
-- referentes (jefe de flota, logística, guarda-almacén, coord. compras, gerencia)
-- ven TODAS, crean la ruta y la asignan a un chofer; la solicitud queda vinculada y
-- su estado sigue a la ruta. El ingeniero ve SOLO las suyas y puede cancelar mientras
-- esté 'pendiente' (decisión Xaviel). Aditivo/retrocompatible.
--
-- Estados: pendiente → planificada (ruta creada) → en_curso → completada / cancelada.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = sgc, public;

-- ── Helper: ¿el usuario actual es un referente de logística? ──────────────────
create or replace function sgc.es_referente_movimiento()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin() or exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo in ('admin','direccion','gerencia','jefe_flota','logistica','coord_compras','guarda_almacen')
  );
$$;
grant execute on function sgc.es_referente_movimiento() to authenticated, service_role;

-- ── Tabla ────────────────────────────────────────────────────────────────────
create table if not exists sgc.solicitudes_movimiento (
  id                  uuid primary key default gen_random_uuid(),
  solicitante_id      uuid not null references sgc.usuarios(id),
  proyecto_id         uuid references sgc.proyectos(id),
  que_se_mueve        text not null,
  tipo_carga          text not null default 'materiales' check (tipo_carga in ('materiales','equipo','otros')),
  origen_tipo         text not null default 'almacen'    check (origen_tipo in ('almacen','obra','proveedor','otro')),
  origen_texto        text,
  origen_bodega_id    uuid references sgc.bodegas(id),
  origen_proyecto_id  uuid references sgc.proyectos(id),
  destino_tipo        text not null default 'obra'       check (destino_tipo in ('almacen','obra','proveedor','otro')),
  destino_texto       text,
  destino_bodega_id   uuid references sgc.bodegas(id),
  destino_proyecto_id uuid references sgc.proyectos(id),
  prioridad           text not null default 'media'      check (prioridad in ('baja','media','alta','urgente')),
  fecha_solicitud     date not null default current_date,
  fecha_requerimiento date,
  estado              text not null default 'pendiente'  check (estado in ('pendiente','planificada','en_curso','completada','cancelada')),
  notas               text,
  ruta_id             uuid references sgc.rutas(id) on delete set null,
  conductor_id        uuid references sgc.conductores(id),
  completada_por      uuid references sgc.usuarios(id),
  completada_at       timestamptz,
  cancelada_por       uuid references sgc.usuarios(id),
  cancelada_at        timestamptz,
  motivo_cancelacion  text,
  es_prueba           boolean not null default false,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table sgc.solicitudes_movimiento is
  'AY11 — solicitudes de movimiento de material/equipo de un ingeniero al depto. de transporte. Ciclo pendiente→planificada→en_curso→completada/cancelada, vinculado a una ruta.';

create index if not exists idx_sol_mov_estado   on sgc.solicitudes_movimiento(estado);
create index if not exists idx_sol_mov_solicita on sgc.solicitudes_movimiento(solicitante_id);
create index if not exists idx_sol_mov_proyecto on sgc.solicitudes_movimiento(proyecto_id);
create index if not exists idx_sol_mov_ruta     on sgc.solicitudes_movimiento(ruta_id) where ruta_id is not null;
create index if not exists idx_sol_mov_prueba   on sgc.solicitudes_movimiento(es_prueba) where es_prueba;

-- Herencia de es_prueba (proyecto de prueba → solicitud de prueba).
drop trigger if exists trg_heredar_es_prueba on sgc.solicitudes_movimiento;
create trigger trg_heredar_es_prueba before insert on sgc.solicitudes_movimiento
  for each row execute function sgc.tg_heredar_es_prueba();

-- updated_at
create or replace function sgc.tg_sol_mov_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_sol_mov_touch on sgc.solicitudes_movimiento;
create trigger trg_sol_mov_touch before update on sgc.solicitudes_movimiento
  for each row execute function sgc.tg_sol_mov_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table sgc.solicitudes_movimiento enable row level security;

drop policy if exists "sol_mov: select" on sgc.solicitudes_movimiento;
create policy "sol_mov: select" on sgc.solicitudes_movimiento
  for select to authenticated
  using (solicitante_id = auth.uid() or created_by = auth.uid() or sgc.es_referente_movimiento());

-- es_prueba oculto a no-admin (restrictiva, patrón T2b).
drop policy if exists "sol_mov: es_prueba oculta" on sgc.solicitudes_movimiento;
create policy "sol_mov: es_prueba oculta" on sgc.solicitudes_movimiento
  as restrictive for select to authenticated
  using (not es_prueba or sgc.is_admin());

-- Escritura solo por RPCs SECURITY DEFINER (sin policies de write directo).
grant select on sgc.solicitudes_movimiento to authenticated;
grant select, insert, update on sgc.solicitudes_movimiento to service_role;

-- ── Notificar a los referentes (varios roles) ────────────────────────────────
create or replace function sgc._notificar_referentes_movimiento(p_titulo text, p_msg text, p_ruta text)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_rol text;
begin
  foreach v_rol in array array['jefe_flota','logistica','coord_compras','guarda_almacen','gerencia','direccion'] loop
    perform sgc.notificar_rol(v_rol, 'solicitud_movimiento', p_titulo, p_msg, p_ruta);
  end loop;
end $$;

-- ── Crear solicitud (ingeniero) ──────────────────────────────────────────────
create or replace function sgc.crear_solicitud_movimiento(
  p_proyecto_id uuid,
  p_que_se_mueve text,
  p_tipo_carga text default 'materiales',
  p_origen_tipo text default 'almacen',
  p_origen_texto text default null,
  p_origen_bodega_id uuid default null,
  p_origen_proyecto_id uuid default null,
  p_destino_tipo text default 'obra',
  p_destino_texto text default null,
  p_destino_bodega_id uuid default null,
  p_destino_proyecto_id uuid default null,
  p_prioridad text default 'media',
  p_fecha_requerimiento date default null,
  p_notas text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_proy text; v_sol text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_que_se_mueve,'')),'') is null then
    raise exception 'Describe qué se va a mover.';
  end if;

  insert into sgc.solicitudes_movimiento (
    solicitante_id, proyecto_id, que_se_mueve, tipo_carga,
    origen_tipo, origen_texto, origen_bodega_id, origen_proyecto_id,
    destino_tipo, destino_texto, destino_bodega_id, destino_proyecto_id,
    prioridad, fecha_requerimiento, notas, created_by
  ) values (
    v_uid, p_proyecto_id, trim(p_que_se_mueve), coalesce(p_tipo_carga,'materiales'),
    coalesce(p_origen_tipo,'almacen'), nullif(trim(p_origen_texto),''), p_origen_bodega_id, p_origen_proyecto_id,
    coalesce(p_destino_tipo,'obra'), nullif(trim(p_destino_texto),''), p_destino_bodega_id, p_destino_proyecto_id,
    coalesce(p_prioridad,'media'), p_fecha_requerimiento, nullif(trim(p_notas),''), v_uid
  ) returning id into v_id;

  select nombre into v_proy from sgc.proyectos where id = p_proyecto_id;
  select nombre into v_sol  from sgc.usuarios  where id = v_uid;
  perform sgc._notificar_referentes_movimiento(
    'Nueva solicitud de movimiento',
    coalesce(v_sol,'Un ingeniero')||' solicitó mover: '||left(trim(p_que_se_mueve),80)||
      coalesce(' · '||v_proy,'')||' · prioridad '||coalesce(p_prioridad,'media'),
    '/flota/solicitudes-movimiento');
  return v_id;
end $$;
grant execute on function sgc.crear_solicitud_movimiento(uuid,text,text,text,text,uuid,uuid,text,text,uuid,uuid,text,date,text) to authenticated, service_role;

-- ── Listar (RLS-aware: ingeniero ve las suyas; referente ve todas + filtros) ──
create or replace function sgc.solicitudes_movimiento_listar(
  p_estado text default null, p_proyecto_id uuid default null,
  p_prioridad text default null, p_desde date default null, p_hasta date default null
) returns table (
  id uuid, solicitante text, proyecto_id uuid, proyecto text, que_se_mueve text, tipo_carga text,
  origen text, destino text, prioridad text, estado text,
  fecha_solicitud date, fecha_requerimiento date, notas text,
  ruta_id uuid, conductor text, es_prueba boolean, dias_para_requerimiento int, created_at timestamptz
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select s.id,
         us.nombre as solicitante,
         s.proyecto_id, p.nombre as proyecto,
         s.que_se_mueve, s.tipo_carga,
         coalesce(nullif(s.origen_texto,''), bo.nombre, po.nombre, s.origen_tipo)  as origen,
         coalesce(nullif(s.destino_texto,''), bd.nombre, pd.nombre, s.destino_tipo) as destino,
         s.prioridad, s.estado, s.fecha_solicitud, s.fecha_requerimiento, s.notas,
         s.ruta_id,
         (select u2.nombre from sgc.conductores c left join sgc.usuarios u2 on u2.id = c.usuario_id where c.id = s.conductor_id) as conductor,
         coalesce(s.es_prueba,false) as es_prueba,
         case when s.fecha_requerimiento is null then null else (s.fecha_requerimiento - current_date) end as dias_para_requerimiento,
         s.created_at
  from sgc.solicitudes_movimiento s
  left join sgc.usuarios  us on us.id = s.solicitante_id
  left join sgc.proyectos p  on p.id  = s.proyecto_id
  left join sgc.bodegas   bo on bo.id = s.origen_bodega_id
  left join sgc.proyectos po on po.id = s.origen_proyecto_id
  left join sgc.bodegas   bd on bd.id = s.destino_bodega_id
  left join sgc.proyectos pd on pd.id = s.destino_proyecto_id
  where (p_estado    is null or s.estado    = p_estado)
    and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
    and (p_prioridad is null or s.prioridad = p_prioridad)
    and (p_desde     is null or s.fecha_solicitud >= p_desde)
    and (p_hasta     is null or s.fecha_solicitud <= p_hasta)
  order by
    case s.estado when 'pendiente' then 0 when 'planificada' then 1 when 'en_curso' then 2 else 3 end,
    case s.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
    s.fecha_requerimiento nulls last, s.created_at desc;
$$;
grant execute on function sgc.solicitudes_movimiento_listar(text,uuid,text,date,date) to authenticated, service_role;

-- ── Cancelar (ingeniero solo si 'pendiente'; referente en cualquier estado no terminal) ──
create or replace function sgc.cancelar_solicitud_movimiento(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_s sgc.solicitudes_movimiento%rowtype; v_ref boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_s from sgc.solicitudes_movimiento where id = p_id;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado in ('completada','cancelada') then raise exception 'La solicitud ya está %.', v_s.estado; end if;

  v_ref := sgc.es_referente_movimiento();
  if not v_ref then
    if v_s.solicitante_id <> v_uid then raise exception 'No autorizado.' using errcode='42501'; end if;
    if v_s.estado <> 'pendiente' then
      raise exception 'Solo puedes cancelar tu solicitud mientras está pendiente. Ya está planificada; pídele al referente que la gestione.';
    end if;
  end if;

  update sgc.solicitudes_movimiento
     set estado='cancelada', cancelada_por=v_uid, cancelada_at=now(), motivo_cancelacion=nullif(trim(p_motivo),'')
   where id = p_id;

  perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento', 'Solicitud de movimiento cancelada',
    'Tu solicitud "'||left(v_s.que_se_mueve,60)||'" fue cancelada.', '/flota/solicitudes-movimiento');
end $$;
grant execute on function sgc.cancelar_solicitud_movimiento(uuid,text) to authenticated, service_role;

-- ── Planificar con ruta (referente): crea la ruta y vincula la solicitud ──────
create or replace function sgc.planificar_solicitud_con_ruta(
  p_id uuid, p_vehiculo_id uuid, p_conductor_id uuid,
  p_fecha date default null, p_notas text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare
  v_s sgc.solicitudes_movimiento%rowtype;
  v_ruta uuid; v_cond_usuario uuid; v_origen text; v_destino text;
begin
  if not sgc.es_referente_movimiento() then raise exception 'No autorizado.' using errcode='42501'; end if;
  select * into v_s from sgc.solicitudes_movimiento where id = p_id;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado not in ('pendiente','planificada') then
    raise exception 'La solicitud no está en un estado planificable (%).', v_s.estado;
  end if;
  if p_conductor_id is null then raise exception 'Elige un chofer.'; end if;

  v_origen  := coalesce(nullif(v_s.origen_texto,''),  (select nombre from sgc.bodegas where id=v_s.origen_bodega_id),   (select nombre from sgc.proyectos where id=v_s.origen_proyecto_id),  'Origen');
  v_destino := coalesce(nullif(v_s.destino_texto,''), (select nombre from sgc.bodegas where id=v_s.destino_bodega_id),  (select nombre from sgc.proyectos where id=v_s.destino_proyecto_id), 'Destino');

  insert into sgc.rutas (tipo, vehiculo_id, conductor_id, origen, destino, destino_proyecto_id, fecha, estado, notas, creado_por, es_prueba)
  values ('material', p_vehiculo_id, p_conductor_id, v_origen, v_destino,
          coalesce(v_s.destino_proyecto_id, v_s.proyecto_id), coalesce(p_fecha, current_date),
          'planificada', coalesce(nullif(trim(p_notas),''), 'Solicitud de movimiento: '||left(v_s.que_se_mueve,80)),
          auth.uid(), coalesce(v_s.es_prueba,false))
  returning id into v_ruta;

  update sgc.solicitudes_movimiento
     set estado='planificada', ruta_id=v_ruta, conductor_id=p_conductor_id
   where id = p_id;

  -- Avisar al chofer y al solicitante.
  select usuario_id into v_cond_usuario from sgc.conductores where id = p_conductor_id;
  if v_cond_usuario is not null then
    perform sgc.notificar(v_cond_usuario, 'solicitud_movimiento', 'Ruta asignada (solicitud de movimiento)',
      'Se te asignó mover: '||left(v_s.que_se_mueve,70)||' ('||v_origen||' → '||v_destino||').', '/flota/rutas');
  end if;
  perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento', 'Tu solicitud fue planificada',
    'Se creó una ruta para "'||left(v_s.que_se_mueve,60)||'".', '/flota/solicitudes-movimiento');
  return v_ruta;
end $$;
grant execute on function sgc.planificar_solicitud_con_ruta(uuid,uuid,uuid,date,text) to authenticated, service_role;

-- ── Completar a mano (solo referente) ────────────────────────────────────────
create or replace function sgc.completar_solicitud_movimiento(p_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_s sgc.solicitudes_movimiento%rowtype;
begin
  if not sgc.es_referente_movimiento() then raise exception 'No autorizado.' using errcode='42501'; end if;
  select * into v_s from sgc.solicitudes_movimiento where id = p_id;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado in ('completada','cancelada') then raise exception 'La solicitud ya está %.', v_s.estado; end if;
  update sgc.solicitudes_movimiento
     set estado='completada', completada_por=auth.uid(), completada_at=now() where id = p_id;
  perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento', 'Solicitud de movimiento completada',
    'Tu solicitud "'||left(v_s.que_se_mueve,60)||'" se marcó como completada.', '/flota/solicitudes-movimiento');
end $$;
grant execute on function sgc.completar_solicitud_movimiento(uuid) to authenticated, service_role;

-- ── Choferes cerca de un punto (asistencia logística v1) ─────────────────────
-- Devuelve choferes con posición reciente (≤2h) dentro del radio, por cercanía.
create or replace function sgc.solicitud_choferes_cercanos(
  p_lat numeric, p_lng numeric, p_radio_km numeric default 15
) returns table (
  usuario_id uuid, nombre text, vehiculo text, lat numeric, lng numeric,
  distancia_km numeric, actualizado timestamptz
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  with base as (
    select cup.usuario_id, u.nombre::text as nombre,
           (v.placa||' — '||v.marca||' '||v.modelo)::text as vehiculo,
           cup.lat, cup.lng, cup.updated_at,
           -- Haversine (km), radio terrestre 6371.
           (6371 * acos( least(1, greatest(-1,
              cos(radians(p_lat)) * cos(radians(cup.lat)) * cos(radians(cup.lng) - radians(p_lng))
              + sin(radians(p_lat)) * sin(radians(cup.lat))
           )))) as distancia_km
    from sgc.chofer_ultima_posicion cup
    join sgc.usuarios u on u.id = cup.usuario_id
    left join sgc.vehiculos v on v.id = cup.vehiculo_id
    where cup.updated_at > now() - interval '2 hours'
      and (sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_referente_movimiento())
  )
  select usuario_id, nombre, vehiculo, lat, lng, round(distancia_km::numeric, 2), updated_at
  from base
  where distancia_km <= coalesce(p_radio_km, 15)
  order by distancia_km asc;
$$;
grant execute on function sgc.solicitud_choferes_cercanos(numeric,numeric,numeric) to authenticated, service_role;

-- ── Conteo pendientes (badge en Flota, para referentes) ──────────────────────
create or replace function sgc.solicitudes_movimiento_pendientes_count()
returns integer language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select count(*)::int from sgc.solicitudes_movimiento s
  where s.estado = 'pendiente'
    and (s.solicitante_id = auth.uid() or sgc.es_referente_movimiento())
    and (not coalesce(s.es_prueba,false) or sgc.is_admin());
$$;
grant execute on function sgc.solicitudes_movimiento_pendientes_count() to authenticated, service_role;

-- ── Auto-sync: ruta terminal → solicitud completada ──────────────────────────
create or replace function sgc.tg_sol_mov_ruta_sync() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_s sgc.solicitudes_movimiento%rowtype;
begin
  if NEW.estado is distinct from OLD.estado and NEW.estado in ('completada','entregada','recibida') then
    for v_s in select * from sgc.solicitudes_movimiento
               where ruta_id = NEW.id and estado in ('planificada','en_curso') loop
      update sgc.solicitudes_movimiento
         set estado='completada', completada_at=now()
       where id = v_s.id;
      perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento', 'Solicitud de movimiento completada',
        'La ruta de tu solicitud "'||left(v_s.que_se_mueve,60)||'" se completó.', '/flota/solicitudes-movimiento');
    end loop;
  elsif NEW.estado is distinct from OLD.estado and NEW.estado in ('en_camino','en_curso') then
    update sgc.solicitudes_movimiento set estado='en_curso'
     where ruta_id = NEW.id and estado = 'planificada';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_sol_mov_ruta_sync on sgc.rutas;
create trigger trg_sol_mov_ruta_sync after update of estado on sgc.rutas
  for each row execute function sgc.tg_sol_mov_ruta_sync();

-- ── Cron: recordar solicitudes con requerimiento cercano sin planificar ──────
create or replace function sgc.recordatorio_solicitudes_movimiento()
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_n int;
begin
  select count(*) into v_n from sgc.solicitudes_movimiento
   where estado = 'pendiente' and not coalesce(es_prueba,false)
     and fecha_requerimiento is not null
     and fecha_requerimiento <= current_date + 1;
  if v_n > 0 then
    perform sgc._notificar_referentes_movimiento(
      'Solicitudes de movimiento por vencer',
      'Hay '||v_n||' solicitud(es) con fecha de requerimiento hoy/mañana sin planificar.',
      '/flota/solicitudes-movimiento');
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'sgc-recordatorio-solicitudes-movimiento') then
      perform cron.unschedule('sgc-recordatorio-solicitudes-movimiento');
    end if;
    perform cron.schedule('sgc-recordatorio-solicitudes-movimiento', '0 12 * * *',
      $cron$ select sgc.recordatorio_solicitudes_movimiento(); $cron$);
  end if;
end $$;
