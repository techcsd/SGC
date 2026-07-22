-- ============================================================================
-- Actualización 4 — T4: estaciones de combustible (catálogo) + conciliación con
-- el informe de Total Energies.
-- ----------------------------------------------------------------------------
-- 1) Catálogo administrable sgc.estaciones_combustible (Total Energies default).
-- 2) Tablas de conciliación (cabecera + detalle) para comparar lo registrado en
--    la plataforma vs el informe de la estación; RPC security-definer que
--    persiste todo y notifica a flota elevados si hay discrepancias.
-- Aditivo/retrocompatible/idempotente. El RPC de combustible NO cambia de firma
-- (la estación sigue viajando como texto).
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Catálogo de estaciones ────────────────────────────────────────────────
create table if not exists sgc.estaciones_combustible (
  id      integer generated always as identity primary key,
  nombre  text not null unique,
  orden   integer not null default 100,
  activo  boolean not null default true,
  created_at timestamptz not null default now()
);

insert into sgc.estaciones_combustible (nombre, orden) values
  ('Total Energies', 1), ('Shell', 2), ('Esso', 3), ('Sunix', 4),
  ('United', 5), ('Texaco', 6), ('Otro', 99)
on conflict (nombre) do nothing;

alter table sgc.estaciones_combustible enable row level security;
drop policy if exists "estaciones: select" on sgc.estaciones_combustible;
create policy "estaciones: select" on sgc.estaciones_combustible for select to authenticated using (true);
drop policy if exists "estaciones: admin" on sgc.estaciones_combustible;
create policy "estaciones: admin" on sgc.estaciones_combustible for all to authenticated
  using (sgc.is_admin() or sgc.es_flota_elevado())
  with check (sgc.is_admin() or sgc.es_flota_elevado());
grant select on sgc.estaciones_combustible to authenticated, service_role;
grant insert, update, delete on sgc.estaciones_combustible to authenticated, service_role;

-- ── 2) Conciliación de combustible ───────────────────────────────────────────
create table if not exists sgc.conciliaciones_combustible (
  id                uuid primary key default gen_random_uuid(),
  estacion          text not null default 'Total Energies',
  fecha_desde       date,
  fecha_hasta       date,
  nombre_archivo    text,
  total_informe_filas   integer not null default 0,
  total_matches         integer not null default 0,
  total_solo_plataforma integer not null default 0,
  total_solo_informe    integer not null default 0,
  total_diferencias     integer not null default 0,
  monto_plataforma  numeric not null default 0,
  monto_informe     numeric not null default 0,
  galones_plataforma numeric not null default 0,
  galones_informe    numeric not null default 0,
  notas             text,
  creado_por        uuid references sgc.usuarios(id),
  created_at        timestamptz not null default now()
);

create table if not exists sgc.conciliacion_combustible_detalle (
  id               uuid primary key default gen_random_uuid(),
  conciliacion_id  uuid not null references sgc.conciliaciones_combustible(id) on delete cascade,
  tipo             text not null check (tipo in ('match','diferencia','solo_plataforma','solo_informe')),
  registro_id      uuid references sgc.registros_combustible(id) on delete set null,
  vehiculo_id      uuid references sgc.vehiculos(id) on delete set null,
  identificador    text,           -- placa/tarjeta del informe
  fecha            date,
  galones_plataforma numeric,
  galones_informe    numeric,
  monto_plataforma   numeric,
  monto_informe      numeric,
  diferencia_galones numeric,
  diferencia_monto   numeric
);
create index if not exists idx_concil_detalle_cid on sgc.conciliacion_combustible_detalle(conciliacion_id);

alter table sgc.conciliaciones_combustible enable row level security;
alter table sgc.conciliacion_combustible_detalle enable row level security;

drop policy if exists "concil: elevado" on sgc.conciliaciones_combustible;
create policy "concil: elevado" on sgc.conciliaciones_combustible for all to authenticated
  using (sgc.is_admin() or sgc.es_flota_elevado())
  with check (sgc.is_admin() or sgc.es_flota_elevado());
drop policy if exists "concil detalle: elevado" on sgc.conciliacion_combustible_detalle;
create policy "concil detalle: elevado" on sgc.conciliacion_combustible_detalle for all to authenticated
  using (sgc.is_admin() or sgc.es_flota_elevado())
  with check (sgc.is_admin() or sgc.es_flota_elevado());

grant select, insert, update, delete on sgc.conciliaciones_combustible to authenticated, service_role;
grant select, insert, update, delete on sgc.conciliacion_combustible_detalle to authenticated, service_role;

-- Permitir el tipo de aviso 'conciliacion'.
alter table sgc.avisos_flota drop constraint if exists avisos_flota_tipo_chk;
alter table sgc.avisos_flota add constraint avisos_flota_tipo_chk check (tipo in (
  'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido',
  'consumo_anormal','licencia','matricula','seguro','reporte_semanal','conciliacion'));

-- ── 3) RPC: persistir la conciliación + notificar discrepancias ──────────────
create or replace function sgc.guardar_conciliacion_combustible(p_meta jsonb, p_detalles jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_id uuid;
  v_discrepancias int;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado para guardar conciliaciones de combustible.';
  end if;

  insert into sgc.conciliaciones_combustible (
    estacion, fecha_desde, fecha_hasta, nombre_archivo,
    total_informe_filas, total_matches, total_solo_plataforma, total_solo_informe, total_diferencias,
    monto_plataforma, monto_informe, galones_plataforma, galones_informe, notas, creado_por
  ) values (
    coalesce(p_meta->>'estacion','Total Energies'),
    nullif(p_meta->>'fecha_desde','')::date, nullif(p_meta->>'fecha_hasta','')::date,
    p_meta->>'nombre_archivo',
    coalesce((p_meta->>'total_informe_filas')::int,0),
    coalesce((p_meta->>'total_matches')::int,0),
    coalesce((p_meta->>'total_solo_plataforma')::int,0),
    coalesce((p_meta->>'total_solo_informe')::int,0),
    coalesce((p_meta->>'total_diferencias')::int,0),
    coalesce((p_meta->>'monto_plataforma')::numeric,0),
    coalesce((p_meta->>'monto_informe')::numeric,0),
    coalesce((p_meta->>'galones_plataforma')::numeric,0),
    coalesce((p_meta->>'galones_informe')::numeric,0),
    p_meta->>'notas', auth.uid()
  ) returning id into v_id;

  insert into sgc.conciliacion_combustible_detalle (
    conciliacion_id, tipo, registro_id, vehiculo_id, identificador, fecha,
    galones_plataforma, galones_informe, monto_plataforma, monto_informe,
    diferencia_galones, diferencia_monto
  )
  select v_id, d->>'tipo',
         nullif(d->>'registro_id','')::uuid, nullif(d->>'vehiculo_id','')::uuid,
         d->>'identificador', nullif(d->>'fecha','')::date,
         nullif(d->>'galones_plataforma','')::numeric, nullif(d->>'galones_informe','')::numeric,
         nullif(d->>'monto_plataforma','')::numeric, nullif(d->>'monto_informe','')::numeric,
         nullif(d->>'diferencia_galones','')::numeric, nullif(d->>'diferencia_monto','')::numeric
  from jsonb_array_elements(p_detalles) as d;

  v_discrepancias := coalesce((p_meta->>'total_diferencias')::int,0)
                   + coalesce((p_meta->>'total_solo_plataforma')::int,0)
                   + coalesce((p_meta->>'total_solo_informe')::int,0);

  if v_discrepancias > 0 then
    insert into sgc.avisos_flota (tipo, mensaje, severidad, dedup_key)
    values ('conciliacion',
            format('Conciliación de combustible %s: %s discrepancia(s) detectada(s).',
                   coalesce(p_meta->>'estacion','Total Energies'), v_discrepancias),
            'alta', 'conciliacion:' || v_id::text)
    on conflict (dedup_key) do nothing;
  end if;

  return v_id;
end;
$function$;

grant execute on function sgc.guardar_conciliacion_combustible(jsonb, jsonb) to authenticated, service_role;
