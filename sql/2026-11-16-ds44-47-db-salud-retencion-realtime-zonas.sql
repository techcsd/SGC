-- DS-44 (#68) Realtime: publicacion alineada con los suscriptores reales de src/, podado reversible y apagado por defecto
-- DS-45 (#69) lista de zonas horarias cacheada (reemplaza pg_timezone_names, 897 ms/llamada)
-- DS-47 (#72) retencion por tabla con parametros + cron (auditoria se ARCHIVA, no se borra)
-- Aditiva e idempotente. Sin secretos ni ids.

-- ───────────── #72 retencion ─────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('retencion_domain_checks_dias',     '90', 'DS-47/#72 - dias de retencion de domain_checks (0 = apagado)'),
  ('retencion_notif_entregas_dias',    '0',  'DS-47/#72 - dias de retencion de notif_entregas (0 = apagado; propuesta 180)'),
  ('retencion_weather_snapshots_dias', '0',  'DS-47/#72 - dias de retencion de weather_snapshots (0 = apagado; propuesta 90)'),
  ('retencion_app_error_reports_dias', '0',  'DS-47/#72 - dias de retencion de app_error_reports (0 = apagado; propuesta 180)'),
  ('retencion_auditoria_dias',         '0',  'DS-47/#72 - dias tras los cuales la auditoria se ARCHIVA en sgc.auditoria_archivo (0 = apagado; propuesta del issue 365)')
on conflict (clave) do nothing;
-- gps_retencion_dias (90) ya existe: lo usa sgc.purgar_posiciones_viejas() con su cron diario.

create table if not exists sgc.auditoria_archivo (like sgc.auditoria);
alter table sgc.auditoria_archivo enable row level security;
revoke all on sgc.auditoria_archivo from anon, authenticated;
create index if not exists auditoria_archivo_creado_idx on sgc.auditoria_archivo (creado_en);

create or replace function sgc.purgar_retencion_tablas()
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_res jsonb := '{}'::jsonb;
  v_dias int;
  v_n int;
  r record;
begin
  for r in
    select * from (values
      ('domain_checks',     'checked_at',   'retencion_domain_checks_dias'),
      ('notif_entregas',    'created_at',   'retencion_notif_entregas_dias'),
      ('weather_snapshots', 'capturado_en', 'retencion_weather_snapshots_dias'),
      ('app_error_reports', 'created_at',   'retencion_app_error_reports_dias')
    ) t(tabla, col, clave)
  loop
    v_dias := coalesce(nullif((select valor from sgc.parametros where clave = r.clave), '')::int, 0);
    if v_dias >= 7 then
      execute format('delete from sgc.%I where %I < now() - make_interval(days => $1)', r.tabla, r.col) using v_dias;
      get diagnostics v_n = row_count;
      v_res := v_res || jsonb_build_object(r.tabla, v_n);
    end if;
  end loop;

  -- auditoria: se archiva (mueve), nunca se pierde
  v_dias := coalesce(nullif((select valor from sgc.parametros where clave = 'retencion_auditoria_dias'), '')::int, 0);
  if v_dias >= 30 then
    with mov as (
      delete from sgc.auditoria where creado_en < now() - make_interval(days => v_dias) returning *
    )
    insert into sgc.auditoria_archivo select * from mov;
    get diagnostics v_n = row_count;
    v_res := v_res || jsonb_build_object('auditoria_archivada', v_n);
  end if;

  v_n := sgc.purgar_posiciones_viejas();   -- gps_retencion_dias
  v_res := v_res || jsonb_build_object('chofer_posiciones', v_n);
  return v_res;
end $$;
revoke all on function sgc.purgar_retencion_tablas() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'sgc-retencion-tablas') then
    perform cron.schedule('sgc-retencion-tablas', '15 4 * * *', 'select sgc.purgar_retencion_tablas();');
  end if;
end $$;

-- ───────────── #69 zonas horarias cacheadas ─────────────
create table if not exists sgc.zonas_horarias (
  nombre text primary key,
  abreviatura text,
  utc_offset interval
);
alter table sgc.zonas_horarias enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'sgc.zonas_horarias'::regclass and polname = 'zonas_horarias_lectura') then
    create policy zonas_horarias_lectura on sgc.zonas_horarias for select to authenticated using (true);
  end if;
end $$;
revoke all on sgc.zonas_horarias from anon;
grant select on sgc.zonas_horarias to authenticated;

create or replace function sgc.zonas_horarias_refrescar()
returns integer language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_n int;
begin
  insert into sgc.zonas_horarias (nombre, abreviatura, utc_offset)
  select name, abbrev, utc_offset from pg_catalog.pg_timezone_names
  on conflict (nombre) do update set abreviatura = excluded.abreviatura, utc_offset = excluded.utc_offset;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function sgc.zonas_horarias_refrescar() from public, anon, authenticated;
select sgc.zonas_horarias_refrescar();

-- ───────────── #68 Realtime ─────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('realtime_podar_activo', 'false', 'DS-44/#68 - si es true, realtime_sincronizar_publicacion(true) QUITA de supabase_realtime las tablas sgc sin suscriptor. Apagado hasta confirmar que csd-app no suscribe otras (revisar en dry-run).'),
  ('realtime_tablas_extra', '',      'DS-44/#68 - CSV de tablas sgc adicionales a conservar en la publicacion (p.ej. las que suscribe la app movil)')
on conflict (clave) do nothing;

create table if not exists sgc.realtime_publicacion_respaldo (
  tabla text primary key,
  quitada_en timestamptz not null default now()
);
alter table sgc.realtime_publicacion_respaldo enable row level security;
revoke all on sgc.realtime_publicacion_respaldo from anon, authenticated;

-- Tablas con suscriptor real en src/ (auditoria DS-44: .channel()/postgres_changes).
create or replace function sgc.realtime_tablas_con_suscriptor()
returns text[] language sql immutable as $$
  select array[
    'agente_eventos','agente_aprobaciones','agente_acciones',
    'mensajes','conversacion_participantes','notificaciones',
    'tareas','tarea_comentarios',
    'aprobaciones_legales','solicitudes_ausencia','solicitudes_material','solicitudes_compra',
    'checklists_vehiculo','alertas_cuadre','weather_alerts',
    'chofer_ultima_posicion','salidas_inventario','vehiculo_usos','registros_combustible','bitacoras'
  ]::text[];
$$;

-- p_aplicar=false: solo lista (dry-run). true: agrega las que faltan y, si realtime_podar_activo, quita las que sobran.
create or replace function sgc.realtime_sincronizar_publicacion(p_aplicar boolean default false)
returns table(tabla text, accion text)
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_usadas text[] := sgc.realtime_tablas_con_suscriptor() || sgc.param_csv('realtime_tablas_extra', '');
  v_podar boolean := coalesce((select valor from sgc.parametros where clave = 'realtime_podar_activo'), 'false') = 'true';
  t text;
begin
  for t in select u from unnest(v_usadas) u
            where exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'sgc' and c.relname = u and c.relkind = 'r')
              and not exists (select 1 from pg_publication_tables p
                               where p.pubname = 'supabase_realtime' and p.schemaname = 'sgc' and p.tablename = u)
  loop
    tabla := t; accion := case when p_aplicar then 'agregada' else 'agregaria' end;
    if p_aplicar then execute format('alter publication supabase_realtime add table sgc.%I', t); end if;
    return next;
  end loop;

  for t in select p.tablename::text from pg_publication_tables p
            where p.pubname = 'supabase_realtime' and p.schemaname = 'sgc' and p.tablename <> all(v_usadas)
  loop
    tabla := t;
    if p_aplicar and v_podar then
      execute format('alter publication supabase_realtime drop table sgc.%I', t);
      insert into sgc.realtime_publicacion_respaldo (tabla) values (t) on conflict on constraint realtime_publicacion_respaldo_pkey do update set quitada_en = now();
      accion := 'quitada';
    else
      accion := case when p_aplicar then 'sobra (poda apagada)' else 'quitaria' end;
    end if;
    return next;
  end loop;
end $$;
revoke all on function sgc.realtime_sincronizar_publicacion(boolean) from public, anon, authenticated;

-- Reversa: vuelve a publicar todo lo que la poda quito.
create or replace function sgc.realtime_restaurar_publicacion()
returns integer language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare r record; v_n int := 0;
begin
  for r in select tabla from sgc.realtime_publicacion_respaldo loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='sgc' and c.relname = r.tabla and c.relkind='r')
       and not exists (select 1 from pg_publication_tables p where p.pubname='supabase_realtime' and p.schemaname='sgc' and p.tablename = r.tabla) then
      execute format('alter publication supabase_realtime add table sgc.%I', r.tabla);
      v_n := v_n + 1;
    end if;
  end loop;
  delete from sgc.realtime_publicacion_respaldo;
  return v_n;
end $$;
revoke all on function sgc.realtime_restaurar_publicacion() from public, anon, authenticated;

-- Alinea: agrega las tablas con suscriptor que falten (idempotente; la poda sigue apagada por defecto).
select * from sgc.realtime_sincronizar_publicacion(true);
