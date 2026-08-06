-- ============================================================================
-- AG16 · Gestión de Producción de Obra — FASE 4: Avance real, Costos y Logística.
-- Rutinas 6, 7 y 8 del Gerente de Producción.
--
-- Avance: extiende `cronograma_tareas` con `avance_pct` (0-100 por tarea) + línea
-- base congelada (`cronograma_baseline`) + curva-S (`obra_avance_snapshots`,
-- sweep diario plan vs real). Mata el Excel.
-- Costos v1: reutiliza `costo_material_obra` (AA23) + rendimientos (lectura) +
-- HORAS HOMBRE como **parte de mano de obra en el módulo Obra** (`obra_mano_obra`,
-- trabajadores×horas) — NO se toca RRHH/asistencia (decisión Xaviel 06/08 PM) +
-- pérdidas (`reportes_perdidas` ya existe).
-- Logística v1: entradas programadas (`ordenes_compra.fecha_programada`) +
-- pruebas de campo (`obra_pruebas_campo`).
--
-- Aditivo/retrocompatible. RLS: obra + proyectos + admin + submódulo obra.avance.
-- ============================================================================
set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) % avance real por tarea
-- ─────────────────────────────────────────────────────────────────────────────
alter table sgc.cronograma_tareas
  add column if not exists avance_pct numeric not null default 0;
do $$ begin
  alter table sgc.cronograma_tareas add constraint cronograma_tareas_avance_chk
    check (avance_pct >= 0 and avance_pct <= 100);
exception when duplicate_object then null; end $$;

-- Las tareas ya completadas cuentan 100 (retroactivo, una vez).
update sgc.cronograma_tareas set avance_pct = 100 where estado = 'completada' and avance_pct = 0;

-- Reportar avance de una tarea (desde web/app). >0 arranca la tarea si estaba pendiente.
create or replace function sgc.reportar_avance_tarea(p_tarea_id uuid, p_avance_pct numeric)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_pct numeric;
begin
  v_pct := greatest(0, least(100, coalesce(p_avance_pct, 0)));
  update sgc.cronograma_tareas
    set avance_pct = v_pct,
        estado = case when estado = 'pendiente' and v_pct > 0 and v_pct < 100 then 'en_curso' else estado end,
        fecha_inicio_real = case when fecha_inicio_real is null and v_pct > 0 then current_date else fecha_inicio_real end
    where id = p_tarea_id;
end $$;
grant execute on function sgc.reportar_avance_tarea(uuid, numeric) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Línea base congelada del cronograma
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists sgc.cronograma_baseline (
  id                 uuid primary key default gen_random_uuid(),
  proyecto_id        uuid not null references sgc.proyectos(id) on delete cascade,
  tarea_id           uuid not null references sgc.cronograma_tareas(id) on delete cascade,
  fecha_inicio_plan  date,
  fecha_fin_plan     date,
  duracion_dias_plan int,
  capturado_en       timestamptz not null default now(),
  capturado_por      uuid references sgc.usuarios(id),
  unique (tarea_id)
);
create index if not exists idx_baseline_proyecto on sgc.cronograma_baseline(proyecto_id);

-- Congela (o recongela) la línea base con las fechas plan actuales del proyecto.
create or replace function sgc.capturar_baseline_cronograma(p_proyecto_id uuid)
returns int language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_n int;
begin
  delete from sgc.cronograma_baseline where proyecto_id = p_proyecto_id;
  insert into sgc.cronograma_baseline (proyecto_id, tarea_id, fecha_inicio_plan, fecha_fin_plan, duracion_dias_plan, capturado_por)
  select t.proyecto_id, t.id, t.fecha_inicio_plan, t.fecha_fin_plan, t.duracion_dias_plan, auth.uid()
  from sgc.cronograma_tareas t
  where t.proyecto_id = p_proyecto_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function sgc.capturar_baseline_cronograma(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Curva-S — snapshots diarios (plan vs real)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists sgc.obra_avance_snapshots (
  id              uuid primary key default gen_random_uuid(),
  proyecto_id     uuid not null references sgc.proyectos(id) on delete cascade,
  fecha           date not null default current_date,
  avance_plan_pct numeric,
  avance_real_pct numeric,
  created_at      timestamptz not null default now(),
  unique (proyecto_id, fecha)
);
create index if not exists idx_avance_snap_proyecto on sgc.obra_avance_snapshots(proyecto_id, fecha);

-- Calcula avance plan/real de un proyecto (ponderado por duración). Usa baseline
-- si existe; si no, las fechas plan vivas. `completada` cuenta 100 siempre.
create or replace function sgc.calcular_avance_obra(p_proyecto_id uuid)
returns table(avance_plan_pct numeric, avance_real_pct numeric)
language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  with t as (
    select
      coalesce(nullif(ct.duracion_dias_plan,0),1)::numeric as w,
      case when ct.estado = 'completada' then 100 else coalesce(ct.avance_pct,0) end as real_pct,
      coalesce(b.fecha_inicio_plan, ct.fecha_inicio_plan) as ini,
      coalesce(b.fecha_fin_plan, ct.fecha_fin_plan) as fin
    from sgc.cronograma_tareas ct
    left join sgc.cronograma_baseline b on b.tarea_id = ct.id
    where ct.proyecto_id = p_proyecto_id
  )
  select
    round(coalesce(sum(w * case
      when fin is null or ini is null then 0
      when current_date >= fin then 100
      when current_date <= ini then 0
      else (current_date - ini)::numeric / nullif((fin - ini),0) * 100
    end) / nullif(sum(w),0), 0), 1) as avance_plan_pct,
    round(coalesce(sum(w * real_pct) / nullif(sum(w),0), 0), 1) as avance_real_pct
  from t;
$$;
grant execute on function sgc.calcular_avance_obra(uuid) to authenticated, service_role;

-- Sweep diario: un snapshot por proyecto con cronograma.
create or replace function sgc.evaluar_avance_obra()
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare r record; v record;
begin
  for r in select distinct proyecto_id from sgc.cronograma_tareas loop
    select * into v from sgc.calcular_avance_obra(r.proyecto_id);
    insert into sgc.obra_avance_snapshots (proyecto_id, fecha, avance_plan_pct, avance_real_pct)
    values (r.proyecto_id, current_date, v.avance_plan_pct, v.avance_real_pct)
    on conflict (proyecto_id, fecha) do update set
      avance_plan_pct = excluded.avance_plan_pct, avance_real_pct = excluded.avance_real_pct;
  end loop;
end $$;
revoke all on function sgc.evaluar_avance_obra() from public, anon, authenticated;
grant execute on function sgc.evaluar_avance_obra() to service_role;

do $$ begin perform cron.unschedule('sgc-obra-avance'); exception when others then null; end $$;
select cron.schedule('sgc-obra-avance', '30 6 * * *', $cron$ select sgc.evaluar_avance_obra(); $cron$);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Horas hombre — parte de mano de obra (en el módulo Obra, NO RRHH)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists sgc.obra_mano_obra (
  id                   uuid primary key default gen_random_uuid(),
  proyecto_id          uuid not null references sgc.proyectos(id) on delete cascade,
  fecha                date not null default current_date,
  actividad            text,          -- brigada / frente / actividad (libre)
  cantidad_trabajadores int not null default 0 check (cantidad_trabajadores >= 0),
  horas                numeric not null default 0 check (horas >= 0),
  notas                text,
  creado_por           uuid references sgc.usuarios(id),
  created_at           timestamptz not null default now()
);
create index if not exists idx_mano_obra_proyecto on sgc.obra_mano_obra(proyecto_id, fecha);
-- horas-hombre = cantidad_trabajadores * horas (columna generada para agregados).
alter table sgc.obra_mano_obra
  add column if not exists horas_hombre numeric generated always as (cantidad_trabajadores * horas) stored;

create or replace function sgc.registrar_mano_obra(
  p_id uuid, p_proyecto_id uuid, p_fecha date, p_actividad text,
  p_cantidad_trabajadores int, p_horas numeric, p_notas text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid;
begin
  insert into sgc.obra_mano_obra (id, proyecto_id, fecha, actividad, cantidad_trabajadores, horas, notas, creado_por)
  values (coalesce(p_id, gen_random_uuid()), p_proyecto_id, coalesce(p_fecha, current_date), p_actividad,
          coalesce(p_cantidad_trabajadores,0), coalesce(p_horas,0), p_notas, auth.uid())
  on conflict (id) do update set
    fecha = excluded.fecha, actividad = excluded.actividad,
    cantidad_trabajadores = excluded.cantidad_trabajadores, horas = excluded.horas, notas = excluded.notas
  returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.registrar_mano_obra(uuid,uuid,date,text,int,numeric,text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Logística — entradas programadas + pruebas de campo
-- ─────────────────────────────────────────────────────────────────────────────
alter table sgc.ordenes_compra add column if not exists fecha_programada date;

create table if not exists sgc.obra_pruebas_campo (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  tipo        text,        -- slump | probeta | compactacion | densidad | otro
  fecha       date not null default current_date,
  resultado   text,
  notas       text,
  fotos       text[] not null default '{}',
  creado_por  uuid references sgc.usuarios(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_pruebas_campo_proyecto on sgc.obra_pruebas_campo(proyecto_id, fecha);

create or replace function sgc.registrar_prueba_campo(
  p_id uuid, p_proyecto_id uuid, p_tipo text, p_fecha date,
  p_resultado text default null, p_notas text default null, p_fotos text[] default '{}'
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid;
begin
  insert into sgc.obra_pruebas_campo (id, proyecto_id, tipo, fecha, resultado, notas, fotos, creado_por)
  values (coalesce(p_id, gen_random_uuid()), p_proyecto_id, p_tipo, coalesce(p_fecha, current_date),
          p_resultado, p_notas, coalesce(p_fotos,'{}'), auth.uid())
  on conflict (id) do update set
    tipo = excluded.tipo, fecha = excluded.fecha, resultado = excluded.resultado,
    notas = excluded.notas, fotos = excluded.fotos
  returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.registrar_prueba_campo(uuid,uuid,text,date,text,text,text[]) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RLS + grants (nuevas tablas) — submódulo obra.avance
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['cronograma_baseline','obra_avance_snapshots','obra_mano_obra','obra_pruebas_campo']
  loop
    execute format('alter table sgc.%I enable row level security', t);
    execute format('drop policy if exists %I_all on sgc.%I', t, t);
    execute format($p$create policy %I_all on sgc.%I for all to authenticated
        using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.puede_operar_submodulo('obra.avance'))
        with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.puede_operar_submodulo('obra.avance'))$p$, t, t);
    execute format('drop policy if exists %I_sel on sgc.%I', t, t);
    execute format($p$create policy %I_sel on sgc.%I for select to authenticated
        using (sgc.puede_ver_submodulo('obra.avance'))$p$, t, t);
    execute format('grant select, insert, update, delete on sgc.%I to authenticated', t);
    execute format('grant all on sgc.%I to service_role', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) costo_material_obra: permitir también al módulo `obra` (aditivo)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sgc.costo_material_obra(p_proyecto_id uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = sgc, public as $$
declare v_result jsonb;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('direccion')) then
    raise exception 'Sin permiso para ver costos de obra' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', coalesce(sum(t.costo), 0),
    'por_articulo', coalesce(jsonb_agg(jsonb_build_object(
        'articulo_id', t.articulo_id, 'nombre', t.nombre, 'unidad', t.unidad,
        'cantidad', t.cantidad, 'costo_unit_prom', t.costo_unit_prom, 'costo', t.costo)
        order by t.costo desc), '[]'::jsonb)
  ) into v_result
  from (
    select ds.articulo_id, a.nombre, a.unidad,
           sum(ds.cantidad) as cantidad,
           round(sum(ds.cantidad * coalesce(ds.costo_unit,0)) / nullif(sum(ds.cantidad),0), 2) as costo_unit_prom,
           sum(ds.cantidad * coalesce(ds.costo_unit,0)) as costo
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario sa on sa.id = ds.salida_id
    left join sgc.articulos a on a.id = ds.articulo_id
    where sa.proyecto_id = p_proyecto_id
      and not coalesce(sa.es_prueba, false)
      and (p_desde is null or sa.fecha >= p_desde)
      and (p_hasta is null or sa.fecha <= p_hasta)
    group by ds.articulo_id, a.nombre, a.unidad
  ) t;
  return v_result;
end;
$$;
grant execute on function sgc.costo_material_obra(uuid, date, date) to authenticated, service_role;
