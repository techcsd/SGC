-- ============================================================================
-- PROMPT-9 · FASE 4 — AA24: dependencias de cronograma v1 (FS/SS/FF + lag)
-- Fecha: 2026-07-29. Aditivo / idempotente. Ver docs/CRONOGRAMA-RESEARCH.md.
--
-- Reemplaza el motor lineal por-orden por un pase de RELAJACIÓN ITERATIVA que
-- respeta dependencias explícitas, PERO conserva la cadena secuencial implícita
-- por `orden` para las tareas SIN dependencias. Resultado clave: un proyecto SIN
-- dependencias produce fechas IDÉNTICAS al motor anterior (cero regresión); en el
-- momento en que una tarea recibe una predecesora explícita, deja de seguir la
-- cadena implícita y se rige por sus predecesoras.
--
-- Convivencia con Y15 (días sobrantes → siguiente crítica): sin cambios en
-- completar_tarea; primero manda el pase de dependencias (aquí), luego la donación
-- de duración de completar_tarea (que ya llama a recalcular_cronograma).
-- ============================================================================

-- ── (1) Tabla de dependencias ────────────────────────────────────────────────
create table if not exists sgc.cronograma_dependencias (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references sgc.proyectos(id) on delete cascade,
  predecesora_id uuid not null references sgc.cronograma_tareas(id) on delete cascade,
  sucesora_id    uuid not null references sgc.cronograma_tareas(id) on delete cascade,
  tipo           text not null default 'FS' check (tipo in ('FS','SS','FF')), -- SF backlog
  lag_dias       int  not null default 0,   -- negativo = lead (adelanto)
  created_at     timestamptz not null default now(),
  creado_por     uuid references sgc.usuarios(id),
  unique (predecesora_id, sucesora_id),
  check (predecesora_id <> sucesora_id)
);
create index if not exists idx_cron_dep_suc on sgc.cronograma_dependencias (sucesora_id);
create index if not exists idx_cron_dep_pred on sgc.cronograma_dependencias (predecesora_id);
create index if not exists idx_cron_dep_proy on sgc.cronograma_dependencias (proyecto_id);

alter table sgc.cronograma_dependencias enable row level security;
do $$ begin
  create policy "cron_dep: ver" on sgc.cronograma_dependencias
    for select to authenticated using (sgc.puede_ver_cronograma(proyecto_id));
exception when duplicate_object then null; end $$;
grant select on sgc.cronograma_dependencias to authenticated;
grant select, insert, update, delete on sgc.cronograma_dependencias to service_role;

-- ── (2) Motor: relajación iterativa (dependencias + cadena implícita por orden) ─
create or replace function sgc.recalcular_cronograma(p_proyecto_id uuid)
returns void language plpgsql security definer set search_path to 'sgc', 'public'
as $function$
declare
  v_ancla_seed date;
  v_ancla      date;
  r            record;
  v_dur        int;
  v_start      date;
  v_fin        date;
  v_has_dep    boolean;
  v_iter       int;
  v_max_iter   int;
  v_changed    boolean;
  v_rows       int;
begin
  -- Guard: si lo llama un usuario, debe poder gestionar. El sweep (auth.uid() null) pasa.
  if auth.uid() is not null and not sgc.puede_gestionar_cronograma(p_proyecto_id) then
    raise exception 'Sin permiso para el cronograma de este proyecto' using errcode = '42501';
  end if;

  v_ancla_seed := coalesce(
    (select fecha_inicio_plan from sgc.cronograma_tareas
      where proyecto_id = p_proyecto_id order by orden, created_at limit 1),
    (select fecha_inicio from sgc.proyectos where id = p_proyecto_id),
    current_date
  );

  select count(*) + 2 into v_max_iter from sgc.cronograma_tareas where proyecto_id = p_proyecto_id;

  -- Relajación: repetir el pase por-orden hasta que no cambie nada (o v_max_iter).
  -- Un pase reproduce EXACTO el motor anterior cuando no hay dependencias.
  for v_iter in 1..greatest(v_max_iter, 1) loop
    v_changed := false;
    v_ancla   := v_ancla_seed;

    for r in
      select * from sgc.cronograma_tareas
      where proyecto_id = p_proyecto_id
      order by orden, created_at
    loop
      v_dur := greatest(r.duracion_dias_plan, 1);

      -- Tareas completadas: fechas reales fijas; anclan la cadena implícita.
      if r.estado = 'completada' and r.fecha_fin_real is not null then
        v_ancla := greatest(v_ancla, r.fecha_fin_real + 1);
        continue;
      end if;

      select exists (
        select 1 from sgc.cronograma_dependencias d where d.sucesora_id = r.id
      ) into v_has_dep;

      if v_has_dep then
        -- Inicio impuesto por las predecesoras (máximo). Lee fechas frescas
        -- (real si completada, plan si no) — el pase converge en ≤ v_max_iter.
        select max(
          case d.tipo
            when 'FS' then coalesce(p2.fecha_fin_real, p2.fecha_fin_plan) + 1 + d.lag_dias
            when 'SS' then coalesce(p2.fecha_inicio_real, p2.fecha_inicio_plan) + d.lag_dias
            when 'FF' then coalesce(p2.fecha_fin_real, p2.fecha_fin_plan) + d.lag_dias - (v_dur - 1)
          end
        ) into v_start
        from sgc.cronograma_dependencias d
        join sgc.cronograma_tareas p2 on p2.id = d.predecesora_id
        where d.sucesora_id = r.id;

        -- Si aún no hay fechas de predecesoras, cae al ancla por este pase.
        if v_start is null then v_start := v_ancla; end if;
      else
        -- Sin dependencias explícitas: cadena implícita por orden (comportamiento previo).
        v_start := v_ancla;
      end if;

      v_fin := v_start + (v_dur - 1);

      update sgc.cronograma_tareas
         set fecha_inicio_plan = v_start,
             fecha_fin_plan     = v_fin,
             updated_at         = now()
       where id = r.id
         and (fecha_inicio_plan is distinct from v_start or fecha_fin_plan is distinct from v_fin);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_changed := true; end if;

      -- La cadena implícita nunca retrocede (protege SS/paralelas).
      v_ancla := greatest(v_ancla, v_fin + 1);
    end loop;

    exit when not v_changed;
  end loop;
end;
$function$;

-- ── (3) ¿Agregar predecesora→sucesora crearía un ciclo? ──────────────────────
-- Ciclo si `predecesora` ya es alcanzable desde `sucesora` siguiendo las aristas
-- existentes (predecesora→sucesora).
create or replace function sgc.cronograma_dep_crearia_ciclo(p_predecesora uuid, p_sucesora uuid)
returns boolean language sql stable security definer set search_path = sgc, public as $$
  with recursive reach as (
    select d.sucesora_id as node
    from sgc.cronograma_dependencias d
    where d.predecesora_id = p_sucesora
    union
    select d.sucesora_id
    from sgc.cronograma_dependencias d
    join reach r on d.predecesora_id = r.node
  )
  select p_predecesora = p_sucesora or exists (select 1 from reach where node = p_predecesora);
$$;

-- ── (4) Crear / actualizar una dependencia ───────────────────────────────────
create or replace function sgc.crear_dependencia_tarea(
  p_predecesora_id uuid, p_sucesora_id uuid, p_tipo text default 'FS', p_lag_dias int default 0
) returns uuid language plpgsql security definer set search_path = sgc, public as $$
declare
  v_proy_pred uuid; v_proy_suc uuid; v_id uuid;
begin
  if p_predecesora_id = p_sucesora_id then
    raise exception 'Una tarea no puede depender de sí misma.' using errcode = '22023';
  end if;
  if coalesce(p_tipo,'FS') not in ('FS','SS','FF') then
    raise exception 'Tipo de dependencia inválido (FS, SS o FF).' using errcode = '22023';
  end if;

  select proyecto_id into v_proy_pred from sgc.cronograma_tareas where id = p_predecesora_id;
  select proyecto_id into v_proy_suc  from sgc.cronograma_tareas where id = p_sucesora_id;
  if v_proy_pred is null or v_proy_suc is null then
    raise exception 'Tarea no encontrada.' using errcode = '23503';
  end if;
  if v_proy_pred <> v_proy_suc then
    raise exception 'Las dos tareas deben ser del mismo proyecto.' using errcode = '22023';
  end if;

  if auth.uid() is not null and not sgc.puede_gestionar_cronograma(v_proy_suc) then
    raise exception 'Sin permiso para el cronograma de este proyecto' using errcode = '42501';
  end if;

  if sgc.cronograma_dep_crearia_ciclo(p_predecesora_id, p_sucesora_id) then
    raise exception 'Esa dependencia crearía un ciclo entre tareas.' using errcode = '22023';
  end if;

  insert into sgc.cronograma_dependencias (proyecto_id, predecesora_id, sucesora_id, tipo, lag_dias, creado_por)
  values (v_proy_suc, p_predecesora_id, p_sucesora_id, coalesce(p_tipo,'FS'), coalesce(p_lag_dias,0), auth.uid())
  on conflict (predecesora_id, sucesora_id)
    do update set tipo = excluded.tipo, lag_dias = excluded.lag_dias
  returning id into v_id;

  perform sgc.recalcular_cronograma(v_proy_suc);
  return v_id;
end;
$$;
grant execute on function sgc.crear_dependencia_tarea(uuid, uuid, text, int) to authenticated, service_role;

-- ── (5) Quitar una dependencia ───────────────────────────────────────────────
create or replace function sgc.quitar_dependencia_tarea(p_id uuid)
returns void language plpgsql security definer set search_path = sgc, public as $$
declare v_proy uuid;
begin
  select proyecto_id into v_proy from sgc.cronograma_dependencias where id = p_id;
  if v_proy is null then return; end if;
  if auth.uid() is not null and not sgc.puede_gestionar_cronograma(v_proy) then
    raise exception 'Sin permiso para el cronograma de este proyecto' using errcode = '42501';
  end if;
  delete from sgc.cronograma_dependencias where id = p_id;
  perform sgc.recalcular_cronograma(v_proy);
end;
$$;
grant execute on function sgc.quitar_dependencia_tarea(uuid) to authenticated, service_role;

-- ── (6) listar_cronograma: incluir dependencias ──────────────────────────────
create or replace function sgc.listar_cronograma(p_proyecto_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'sgc', 'public'
as $function$
declare v_result jsonb;
begin
  if not sgc.puede_ver_cronograma(p_proyecto_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'tareas', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.orden, t.created_at)
      from sgc.cronograma_tareas t
      where t.proyecto_id = p_proyecto_id and ((not t.es_prueba) or sgc.is_admin())
    ), '[]'::jsonb),
    'recalculos', coalesce((
      select jsonb_agg(to_jsonb(rc) order by rc.created_at desc)
      from sgc.cronograma_recalculos rc
      where rc.proyecto_id = p_proyecto_id
    ), '[]'::jsonb),
    'dependencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'predecesora_id', d.predecesora_id, 'sucesora_id', d.sucesora_id,
        'tipo', d.tipo, 'lag_dias', d.lag_dias) order by d.created_at)
      from sgc.cronograma_dependencias d
      where d.proyecto_id = p_proyecto_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;
