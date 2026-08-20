-- ============================================================================
-- AT1–AT4 — Incentivo por uso de la app (choferes)
-- Ronda 19/08/2026 (tarde). Aditivo y retrocompatible.
--
-- Este informe DECIDE UN PAGO semanal, así que el diseño prioriza:
--   • exactitud + trazabilidad (cada número guarda las referencias que lo componen)
--   • configurable y VERSIONADO (un informe viejo conserva los pesos con que se calculó)
--   • justo (figura del AYUDANTE que suma al que trabajó acompañado — AT4)
--   • a prueba de inflado (marca patrones sospechosos, no bloquea)
--
-- Decisiones de Xaviel (20/08/2026):
--   AT1: solo trabajo COMPLETADO cuenta — ruta=completada, conduce=confirmado,
--        echada sin foto de tablero NO cuenta, inspección/reporte=enviado.
--   AT4: el ayudante suma IGUAL que el titular (factor 1, editable).
--   AT2/AT3: módulo "Incentivos" para los que deciden; el chofer NO lo ve (vive en
--        "Mi rendimiento", solo lo suyo). Declinar exige motivo; admin también aprueba;
--        se notifica al chofer; export para nómina; historial append-only con versión.
-- ============================================================================
set search_path = sgc, public;

-- ── Autorización: quién GESTIONA incentivos (decide/ve todos) ────────────────
-- Fuente única: módulo `incentivos` (admin lo tiene por array_append; a Logística
-- y Transportación y a Gerencia se les concede el módulo).
create or replace function sgc.puede_gestionar_incentivos()
returns boolean language sql stable security definer set search_path = sgc, public as $$
  select sgc.is_admin() or sgc.tiene_modulo('incentivos');
$$;
grant execute on function sgc.puede_gestionar_incentivos() to authenticated, service_role;

-- Dar el módulo a admin + los roles que deciden (idempotente).
update sgc.roles
   set modulos = array_append(modulos, 'incentivos')
 where codigo in ('admin','direccion','gerencia','logistica')
   and not ('incentivos' = any(modulos));

-- ── 1) Config VERSIONADA de puntaje ─────────────────────────────────────────
-- Cada guardado inserta una nueva versión (append-only). La activa (última con
-- activo=true) se usa al generar; el informe congela la versión que usó.
create table if not exists sgc.incentivo_config (
  version         int generated always as identity primary key,
  minimo_semanal  numeric not null default 10,
  -- pesos por renglón (editables desde la UI). Renglones v1:
  --   reporte_semanal · inspeccion · echada · ruta · conduce
  pesos           jsonb not null default
                   '{"reporte_semanal":1,"inspeccion":1,"echada":1,"ruta":1,"conduce":1}'::jsonb,
  ayudante_factor numeric not null default 1,   -- AT4: ayudante suma igual
  activo          boolean not null default true,
  nota            text,
  creado_por      uuid references sgc.usuarios(id),
  created_at      timestamptz not null default now()
);

-- Semilla de la primera versión si no hay ninguna.
insert into sgc.incentivo_config (minimo_semanal, pesos, ayudante_factor, nota)
select 10, '{"reporte_semanal":1,"inspeccion":1,"echada":1,"ruta":1,"conduce":1}'::jsonb, 1,
       'Configuración inicial (AT1). Pesos y mínimo editables desde Incentivos.'
where not exists (select 1 from sgc.incentivo_config);

-- ── 2) Participantes por actividad (AYUDANTE — AT4) ─────────────────────────
-- Aditiva: no toca los registros existentes. El titular se deriva del registro
-- de origen; aquí solo se guardan los ayudantes (rol='helper'). El titular NO
-- puede ser su propio ayudante (se valida en el RPC).
create table if not exists sgc.actividad_participantes (
  id            uuid primary key default gen_random_uuid(),
  activity_type text not null check (activity_type in ('ruta','conduce','echada','inspeccion','reporte_semanal')),
  activity_id   uuid not null,
  usuario_id    uuid not null references sgc.usuarios(id),
  rol           text not null default 'helper' check (rol in ('driver','helper')),
  creado_por    uuid references sgc.usuarios(id),
  created_at    timestamptz not null default now(),
  unique (activity_type, activity_id, usuario_id)
);
create index if not exists idx_actividad_part_lookup on sgc.actividad_participantes (activity_type, activity_id);
create index if not exists idx_actividad_part_usuario on sgc.actividad_participantes (usuario_id);

-- ── 3) Informe semanal por chofer ───────────────────────────────────────────
create table if not exists sgc.incentivo_semana (
  id             uuid primary key default gen_random_uuid(),
  anio           int not null,
  semana         int not null,          -- semana ISO (hora RD)
  inicio         date not null,         -- lunes
  fin            date not null,         -- domingo
  usuario_id     uuid not null references sgc.usuarios(id),
  conductor_id   uuid references sgc.conductores(id),
  config_version int not null references sgc.incentivo_config(version),
  pesos          jsonb not null,        -- snapshot de los pesos usados
  minimo         numeric not null,      -- snapshot del mínimo usado
  -- conteos por renglón: { renglon: {propio:int, ayudante:int, puntos:numeric,
  --   refs:[{id,tipo,fecha,ayudante}]} } — cada número es clickable a sus registros.
  conteos        jsonb not null default '{}'::jsonb,
  puntaje        numeric not null default 0,
  cumplio        boolean not null default false,
  -- AT1.f — marcas anti-inflado para revisión (no bloquean): [{tipo,ref_id,msg}]
  flags          jsonb not null default '[]'::jsonb,
  generado_at    timestamptz not null default now(),
  unique (anio, semana, usuario_id)
);
create index if not exists idx_incentivo_semana_periodo on sgc.incentivo_semana (anio, semana);
create index if not exists idx_incentivo_semana_usuario on sgc.incentivo_semana (usuario_id);

-- ── 4) Aprobación / declinación (append-only) ───────────────────────────────
create table if not exists sgc.incentivo_aprobacion (
  id            uuid primary key default gen_random_uuid(),
  informe_id    uuid not null references sgc.incentivo_semana(id) on delete cascade,
  decision      text not null check (decision in ('aprobado','declinado')),
  motivo        text,   -- AT3: obligatorio al declinar (se valida en RPC)
  puntaje       numeric not null,       -- snapshot al decidir
  config_version int not null,          -- snapshot de la versión de pesos vigente
  decidido_por  uuid not null references sgc.usuarios(id),
  decidido_en   timestamptz not null default now(),
  constraint incentivo_aprob_motivo_declina
    check (decision = 'aprobado' or (motivo is not null and length(trim(motivo)) > 0))
);
create index if not exists idx_incentivo_aprob_informe on sgc.incentivo_aprobacion (informe_id, decidido_en desc);

-- Decisión vigente por informe (la última gana; el historial conserva todo).
create or replace view sgc.v_incentivo_decision_vigente as
select distinct on (a.informe_id)
       a.informe_id, a.decision, a.motivo, a.decidido_por, a.decidido_en
  from sgc.incentivo_aprobacion a
 order by a.informe_id, a.decidido_en desc;

-- ── 5) Registro de envíos del correo (idempotencia + reenvío) ───────────────
create table if not exists sgc.incentivo_envio (
  id            uuid primary key default gen_random_uuid(),
  anio          int not null,
  semana        int not null,
  enviado_at    timestamptz not null default now(),
  destinatarios jsonb,
  ok            boolean not null default true,
  error         text,
  unique (anio, semana)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table sgc.incentivo_config        enable row level security;
alter table sgc.actividad_participantes enable row level security;
alter table sgc.incentivo_semana        enable row level security;
alter table sgc.incentivo_aprobacion    enable row level security;
alter table sgc.incentivo_envio         enable row level security;

-- Config: la ven los que gestionan; se escribe solo por RPC.
drop policy if exists "incentivo_config: select" on sgc.incentivo_config;
create policy "incentivo_config: select" on sgc.incentivo_config
  for select to authenticated using (sgc.puede_gestionar_incentivos());

-- Participantes: los ve quien gestiona, el titular/creador, o el propio ayudante
-- (AT4: "X te marcó como su ayudante" — así una designación falsa se detecta).
drop policy if exists "actividad_part: select" on sgc.actividad_participantes;
create policy "actividad_part: select" on sgc.actividad_participantes
  for select to authenticated using (
    sgc.puede_gestionar_incentivos() or usuario_id = auth.uid() or creado_por = auth.uid()
  );

-- Informe: lo ve quien gestiona (todos) o el chofer dueño (solo el suyo — "Mi rendimiento").
drop policy if exists "incentivo_semana: select" on sgc.incentivo_semana;
create policy "incentivo_semana: select" on sgc.incentivo_semana
  for select to authenticated using (
    sgc.puede_gestionar_incentivos() or usuario_id = auth.uid()
  );

-- Aprobaciones: quien gestiona, o el chofer dueño del informe (ve su resultado).
drop policy if exists "incentivo_aprob: select" on sgc.incentivo_aprobacion;
create policy "incentivo_aprob: select" on sgc.incentivo_aprobacion
  for select to authenticated using (
    sgc.puede_gestionar_incentivos()
    or exists (select 1 from sgc.incentivo_semana s where s.id = informe_id and s.usuario_id = auth.uid())
  );

-- Envíos: solo gestión.
drop policy if exists "incentivo_envio: select" on sgc.incentivo_envio;
create policy "incentivo_envio: select" on sgc.incentivo_envio
  for select to authenticated using (sgc.puede_gestionar_incentivos());

grant select on sgc.incentivo_config, sgc.actividad_participantes, sgc.incentivo_semana,
                sgc.incentivo_aprobacion, sgc.incentivo_envio to authenticated;
grant select on sgc.v_incentivo_decision_vigente to authenticated;
grant all on sgc.incentivo_config, sgc.actividad_participantes, sgc.incentivo_semana,
             sgc.incentivo_aprobacion, sgc.incentivo_envio to service_role;

-- ============================================================================
-- Helpers de semana ISO (hora RD)
-- ============================================================================
-- Lunes de la semana ISO (año, semana) → date.
create or replace function sgc.incentivo_semana_inicio(p_anio int, p_semana int)
returns date language sql immutable as $$
  select to_date(p_anio::text || '-' || lpad(p_semana::text, 2, '0'), 'IYYY-IW');
$$;

-- ============================================================================
-- AYUDANTE (AT4): marcar / quitar
-- ============================================================================
create or replace function sgc.marcar_ayudante(
  p_activity_type text, p_activity_id uuid, p_usuario_id uuid
) returns uuid
language plpgsql security definer set search_path = sgc, public as $$
declare v_id uuid; v_titular uuid;
begin
  if p_activity_type not in ('ruta','conduce','echada','inspeccion','reporte_semanal') then
    raise exception 'Tipo de actividad inválido' using errcode = 'AT400';
  end if;
  -- El titular no puede ser su propio ayudante.
  select case p_activity_type
           when 'ruta'     then coalesce((select c.usuario_id from sgc.rutas r left join sgc.conductores c on c.id = r.conductor_id where r.id = p_activity_id), (select creado_por from sgc.rutas where id = p_activity_id))
           when 'conduce'  then coalesce((select c.usuario_id from sgc.salidas_inventario s left join sgc.conductores c on c.id = s.conductor_id where s.id = p_activity_id), (select entregado_por from sgc.salidas_inventario where id = p_activity_id))
           when 'echada'   then (select registrado_por from sgc.registros_combustible where id = p_activity_id)
           else (select creado_por from sgc.checklists_vehiculo where id = p_activity_id)
         end
    into v_titular;
  if v_titular = p_usuario_id then
    raise exception 'El titular no puede ser su propio ayudante' using errcode = 'AT409';
  end if;
  insert into sgc.actividad_participantes (activity_type, activity_id, usuario_id, rol, creado_por)
  values (p_activity_type, p_activity_id, p_usuario_id, 'helper', auth.uid())
  on conflict (activity_type, activity_id, usuario_id) do update set rol = 'helper'
  returning id into v_id;
  -- Aviso al ayudante (transparencia AT4.d).
  perform sgc.notificar(p_usuario_id, 'info', 'Te marcaron como ayudante',
    'Se registró tu participación como ayudante en una actividad de esta semana.', '/mi-rendimiento');
  return v_id;
end;
$$;
grant execute on function sgc.marcar_ayudante(text, uuid, uuid) to authenticated, service_role;

create or replace function sgc.quitar_ayudante(
  p_activity_type text, p_activity_id uuid, p_usuario_id uuid
) returns void
language sql security definer set search_path = sgc, public as $$
  delete from sgc.actividad_participantes
   where activity_type = p_activity_type and activity_id = p_activity_id
     and usuario_id = p_usuario_id and rol = 'helper';
$$;
grant execute on function sgc.quitar_ayudante(text, uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- GENERAR el informe de una semana (idempotente: recalcula y reemplaza)
-- Cuenta SOLO trabajo completado (AT1) y excluye datos de prueba (es_prueba).
-- ============================================================================
create or replace function sgc.incentivo_generar_semana(p_anio int, p_semana int)
returns int
language plpgsql security definer set search_path = sgc, public as $$
declare
  v_inicio date := sgc.incentivo_semana_inicio(p_anio, p_semana);
  v_fin    date := sgc.incentivo_semana_inicio(p_anio, p_semana) + 6;
  v_cfg    sgc.incentivo_config%rowtype;
  v_factor numeric;
  v_count  int := 0;
begin
  select * into v_cfg from sgc.incentivo_config where activo order by version desc limit 1;
  if not found then
    raise exception 'No hay configuración de incentivo activa' using errcode = 'AT404';
  end if;
  v_factor := coalesce(v_cfg.ayudante_factor, 1);

  with
  -- Eventos TITULARES (rol driver) — un renglón por registro completado en la semana.
  titulares as (
    -- Reporte semanal del vehículo (plantilla frecuencia='semanal').
    select ck.creado_por as usuario_id, 'reporte_semanal'::text as renglon, ck.id as ref_id, ck.fecha as ref_fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia = 'semanal' and not ck.es_prueba and ck.creado_por is not null
       and ck.fecha between v_inicio and v_fin
    union all
    -- Inspección / pre-uso (cualquier checklist NO semanal).
    select ck.creado_por, 'inspeccion', ck.id, ck.fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia <> 'semanal' and not ck.es_prueba and ck.creado_por is not null
       and ck.fecha between v_inicio and v_fin
    union all
    -- Echada CON foto de tablero (sin evidencia NO cuenta — AT1).
    select rc.registrado_por, 'echada', rc.id, rc.fecha
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null
       and coalesce(nullif(trim(rc.foto_tablero_path), ''), null) is not null
       and rc.fecha between v_inicio and v_fin
    union all
    -- Ruta COMPLETADA (con su fin dentro de la semana; fallback a fecha).
    select coalesce(c.usuario_id, r.creado_por), 'ruta', r.id, r.fecha
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
     where r.estado = 'completada' and not r.es_prueba
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha)
             between v_inicio and v_fin
       and coalesce(c.usuario_id, r.creado_por) is not null
    union all
    -- Conduce CONFIRMADO por el receptor (recibido_por no nulo).
    select coalesce(c.usuario_id, s.entregado_por), 'conduce', s.id, s.fecha
      from sgc.salidas_inventario s
      left join sgc.conductores c on c.id = s.conductor_id
     where s.recibido_por is not null and not s.es_prueba
       and coalesce((s.recibido_en at time zone 'America/Santo_Domingo')::date,
                    (s.entregado_en at time zone 'America/Santo_Domingo')::date, s.fecha)
             between v_inicio and v_fin
       and coalesce(c.usuario_id, s.entregado_por) is not null
  ),
  -- Eventos AYUDANTE — mismo renglón para quien acompañó (AT4).
  ayudantes as (
    select ap.usuario_id, t.renglon, t.ref_id, t.ref_fecha
      from sgc.actividad_participantes ap
      join titulares t on t.renglon = ap.activity_type and t.ref_id = ap.activity_id
     where ap.rol = 'helper'
  ),
  eventos as (
    select usuario_id, renglon, ref_id, ref_fecha, false as es_ayudante from titulares
    union all
    select usuario_id, renglon, ref_id, ref_fecha, true  as es_ayudante from ayudantes
  ),
  por_renglon as (
    select e.usuario_id, e.renglon,
           count(*) filter (where not e.es_ayudante) as propio,
           count(*) filter (where e.es_ayudante)     as ayudante,
           (count(*) filter (where not e.es_ayudante)
            + count(*) filter (where e.es_ayudante) * v_factor)
             * coalesce((v_cfg.pesos->>e.renglon)::numeric, 0) as puntos,
           jsonb_agg(jsonb_build_object('id', e.ref_id, 'tipo', e.renglon,
                     'fecha', e.ref_fecha, 'ayudante', e.es_ayudante)
                     order by e.ref_fecha) as refs
      from eventos e
     group by e.usuario_id, e.renglon
  ),
  agg as (
    select usuario_id,
           jsonb_object_agg(renglon, jsonb_build_object(
             'propio', propio, 'ayudante', ayudante, 'puntos', puntos, 'refs', refs)) as conteos,
           sum(puntos) as puntaje
      from por_renglon group by usuario_id
  ),
  -- Anti-inflado (AT1.f): rutas 0km/0min y echadas duplicadas (mismo minuto).
  flags_ruta as (
    select coalesce(c.usuario_id, r.creado_por) as usuario_id,
           jsonb_build_object('tipo','ruta_sin_metrica','ref_id', r.id,
             'msg','Ruta completada con 0 km o 0 min — revisar') as flag
      from sgc.rutas r left join sgc.conductores c on c.id = r.conductor_id
     where r.estado='completada' and not r.es_prueba
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) between v_inicio and v_fin
       and (coalesce(r.km_real,0) = 0 or coalesce(r.tiempo_real_min,0) = 0)
       and coalesce(c.usuario_id, r.creado_por) is not null
  ),
  flags_echada as (
    select rc.registrado_por as usuario_id,
           jsonb_build_object('tipo','echada_duplicada','ref_id', rc.id,
             'msg','Echada registrada en el mismo minuto que otra — revisar') as flag
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null
       and rc.fecha between v_inicio and v_fin
       and exists (
         select 1 from sgc.registros_combustible r2
          where r2.id <> rc.id and r2.registrado_por = rc.registrado_por
            and date_trunc('minute', r2.created_at) = date_trunc('minute', rc.created_at))
  ),
  flags_all as (
    select usuario_id, jsonb_agg(flag) as flags
      from (select * from flags_ruta union all select * from flags_echada) f
     group by usuario_id
  )
  insert into sgc.incentivo_semana as ins
    (anio, semana, inicio, fin, usuario_id, conductor_id, config_version, pesos, minimo,
     conteos, puntaje, cumplio, flags, generado_at)
  select p_anio, p_semana, v_inicio, v_fin, a.usuario_id,
         (select id from sgc.conductores c where c.usuario_id = a.usuario_id limit 1),
         v_cfg.version, v_cfg.pesos, v_cfg.minimo_semanal,
         a.conteos, a.puntaje, (a.puntaje >= v_cfg.minimo_semanal),
         coalesce(fa.flags, '[]'::jsonb), now()
    from agg a
    left join flags_all fa on fa.usuario_id = a.usuario_id
  on conflict (anio, semana, usuario_id) do update
    set conteos = excluded.conteos, puntaje = excluded.puntaje, cumplio = excluded.cumplio,
        flags = excluded.flags, pesos = excluded.pesos, minimo = excluded.minimo,
        config_version = excluded.config_version, conductor_id = excluded.conductor_id,
        generado_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function sgc.incentivo_generar_semana(int, int) to authenticated, service_role;

-- ============================================================================
-- LECTURA
-- ============================================================================
-- Listado de gestión (una semana) con la decisión vigente.
create or replace function sgc.incentivo_listado(p_anio int, p_semana int)
returns table (
  informe_id uuid, usuario_id uuid, nombre text, conductor_id uuid,
  puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb, flags jsonb,
  decision text, motivo text, decidido_por uuid, decidido_por_nombre text, decidido_en timestamptz
) language sql stable security definer set search_path = sgc, public as $$
  select s.id, s.usuario_id, u.nombre, s.conductor_id,
         s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags,
         v.decision, v.motivo, v.decidido_por, du.nombre, v.decidido_en
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
    left join sgc.usuarios du on du.id = v.decidido_por
   where s.anio = p_anio and s.semana = p_semana
     and sgc.puede_gestionar_incentivos()
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$$;
grant execute on function sgc.incentivo_listado(int, int) to authenticated, service_role;

-- Semanas disponibles (para el selector).
create or replace function sgc.incentivo_semanas()
returns table (anio int, semana int, inicio date, fin date, choferes int, cumplieron int)
language sql stable security definer set search_path = sgc, public as $$
  select s.anio, s.semana, s.inicio, s.fin, count(*)::int, count(*) filter (where s.cumplio)::int
    from sgc.incentivo_semana s
   where sgc.puede_gestionar_incentivos()
   group by s.anio, s.semana, s.inicio, s.fin
   order by s.anio desc, s.semana desc;
$$;
grant execute on function sgc.incentivo_semanas() to authenticated, service_role;

-- Historial de decisiones de un informe (append-only, para auditar).
create or replace function sgc.incentivo_historial(p_informe_id uuid)
returns table (decision text, motivo text, puntaje numeric, config_version int,
               decidido_por uuid, decidido_por_nombre text, decidido_en timestamptz)
language sql stable security definer set search_path = sgc, public as $$
  select a.decision, a.motivo, a.puntaje, a.config_version, a.decidido_por, u.nombre, a.decidido_en
    from sgc.incentivo_aprobacion a
    left join sgc.usuarios u on u.id = a.decidido_por
   where a.informe_id = p_informe_id
     and (sgc.puede_gestionar_incentivos()
          or exists (select 1 from sgc.incentivo_semana s where s.id = a.informe_id and s.usuario_id = auth.uid()))
   order by a.decidido_en desc;
$$;
grant execute on function sgc.incentivo_historial(uuid) to authenticated, service_role;

-- "Mi rendimiento" — el chofer ve SOLO lo suyo (todas sus semanas) + su decisión.
create or replace function sgc.incentivo_mi_rendimiento()
returns table (
  informe_id uuid, anio int, semana int, inicio date, fin date,
  puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb,
  decision text, decidido_en timestamptz
) language sql stable security definer set search_path = sgc, public as $$
  select s.id, s.anio, s.semana, s.inicio, s.fin,
         s.puntaje, s.minimo, s.cumplio, s.conteos,
         v.decision, v.decidido_en
    from sgc.incentivo_semana s
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
   where s.usuario_id = auth.uid()
   order by s.anio desc, s.semana desc;
$$;
grant execute on function sgc.incentivo_mi_rendimiento() to authenticated, service_role;

-- ============================================================================
-- DECIDIR (aprobar / declinar) — AT3
-- ============================================================================
create or replace function sgc.incentivo_decidir(
  p_informe_id uuid, p_decision text, p_motivo text default null
) returns void
language plpgsql security definer set search_path = sgc, public as $$
declare v_inf sgc.incentivo_semana%rowtype;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado para decidir incentivos' using errcode = '42501';
  end if;
  if p_decision not in ('aprobado','declinado') then
    raise exception 'Decisión inválida' using errcode = 'AT400';
  end if;
  if p_decision = 'declinado' and (p_motivo is null or length(trim(p_motivo)) = 0) then
    raise exception 'Al declinar debes indicar el motivo' using errcode = 'AT422';
  end if;
  select * into v_inf from sgc.incentivo_semana where id = p_informe_id;
  if not found then
    raise exception 'Informe no encontrado' using errcode = 'AT404';
  end if;

  insert into sgc.incentivo_aprobacion (informe_id, decision, motivo, puntaje, config_version, decidido_por)
  values (p_informe_id, p_decision, nullif(trim(p_motivo), ''), v_inf.puntaje, v_inf.config_version, auth.uid());

  -- Notificar al chofer su resultado (en "Mi rendimiento").
  if p_decision = 'aprobado' then
    perform sgc.notificar(v_inf.usuario_id, 'exito', 'Incentivo aprobado',
      format('Cumpliste el puntaje esta semana. ¡Tu incentivo fue aprobado!'), '/mi-rendimiento');
  else
    perform sgc.notificar(v_inf.usuario_id, 'info', 'Resultado de tu incentivo',
      format('Tu incentivo de la semana no fue aprobado. Motivo: %s', p_motivo), '/mi-rendimiento');
  end if;
end;
$$;
grant execute on function sgc.incentivo_decidir(uuid, text, text) to authenticated, service_role;

-- Acción masiva: aprobar todos los que cumplieron y siguen pendientes.
create or replace function sgc.incentivo_aprobar_cumplieron(p_anio int, p_semana int)
returns int
language plpgsql security definer set search_path = sgc, public as $$
declare v_id uuid; v_n int := 0;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  for v_id in
    select s.id from sgc.incentivo_semana s
     where s.anio = p_anio and s.semana = p_semana and s.cumplio
       and not exists (select 1 from sgc.v_incentivo_decision_vigente v
                        where v.informe_id = s.id and v.decision = 'aprobado')
  loop
    perform sgc.incentivo_decidir(v_id, 'aprobado', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function sgc.incentivo_aprobar_cumplieron(int, int) to authenticated, service_role;

-- ============================================================================
-- CONFIG — editar (nueva versión) y leer la activa
-- ============================================================================
create or replace function sgc.incentivo_config_actual()
returns sgc.incentivo_config
language sql stable security definer set search_path = sgc, public as $$
  select * from sgc.incentivo_config where activo order by version desc limit 1;
$$;
grant execute on function sgc.incentivo_config_actual() to authenticated, service_role;

create or replace function sgc.incentivo_set_config(
  p_minimo numeric, p_pesos jsonb, p_ayudante_factor numeric, p_nota text default null
) returns int
language plpgsql security definer set search_path = sgc, public as $$
declare v_version int;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.incentivo_config set activo = false where activo;
  insert into sgc.incentivo_config (minimo_semanal, pesos, ayudante_factor, activo, nota, creado_por)
  values (p_minimo, p_pesos, coalesce(p_ayudante_factor, 1), true, p_nota, auth.uid())
  returning version into v_version;
  return v_version;
end;
$$;
grant execute on function sgc.incentivo_set_config(numeric, jsonb, numeric, text) to authenticated, service_role;

-- ============================================================================
-- ENVÍO del correo (idempotente) + CRON de los lunes 10:00 AM RD (14:00 UTC)
-- ============================================================================
-- Dispara la edge function `incentivo-semanal` (PDF + email a los roles con el
-- módulo incentivos). Idempotente: si ya se envió OK y no se fuerza, no reenvía.
create or replace function sgc.incentivo_enviar_semana(
  p_anio int, p_semana int, p_forzar boolean default false
) returns text
language plpgsql security definer set search_path = sgc, public as $$
declare v_url text; v_secret text; v_ya boolean;
begin
  if not (sgc.puede_gestionar_incentivos() or auth.uid() is null) then
    -- auth.uid() is null => llamada del cron (service context)
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select exists (select 1 from sgc.incentivo_envio where anio = p_anio and semana = p_semana and ok)
    into v_ya;
  if v_ya and not p_forzar then
    return 'ya_enviado';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  v_url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/incentivo-semanal';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
    body := jsonb_build_object('anio', p_anio, 'semana', p_semana)
  );
  return 'enviando';
end;
$$;
grant execute on function sgc.incentivo_enviar_semana(int, int, boolean) to authenticated, service_role;

-- Wrapper del cron: genera y envía el informe de la SEMANA ANTERIOR completa.
create or replace function sgc.incentivo_cron_lunes()
returns void
language plpgsql security definer set search_path = sgc, public as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;  -- semana pasada
  v_anio int  := extract(isoyear from v_ref)::int;
  v_sem  int  := extract(week    from v_ref)::int;
begin
  perform sgc.incentivo_generar_semana(v_anio, v_sem);
  perform sgc.incentivo_enviar_semana(v_anio, v_sem, false);
end;
$$;
grant execute on function sgc.incentivo_cron_lunes() to service_role;

-- Cron: lunes 10:00 AM RD = 14:00 UTC.
do $$ begin perform cron.unschedule('sgc-incentivo-semanal-lunes'); exception when others then null; end $$;
select cron.schedule('sgc-incentivo-semanal-lunes', '0 14 * * 1',
  $cron$ select sgc.incentivo_cron_lunes(); $cron$);
