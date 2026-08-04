-- ============================================================================
-- TRANSPORTE v2 — FASE 3 — Estados de disponibilidad del chofer (AF28)
-- Ronda 03/08/2026 (IDs AF) — PROMPT-3. Doc: TRANSPORTE-V2.md (aprobado).
--
-- 6 estados: disponible, en_ruta, descanso, almuerzo, inactivo, otros(texto).
-- Reglas: en_ruta AUTOMÁTICO al iniciar/terminar ruta; almuerzo con countdown 1h
-- (la app lo pinta; al vencer vuelve a disponible — cron de red de seguridad);
-- inactivo al cierre del día. Solo choferes. Visible para jefe de flota.
--
-- Aditivo, idempotente.
-- ============================================================================

create table if not exists sgc.chofer_estado (
  usuario_id     uuid primary key references sgc.usuarios(id) on delete cascade,
  estado         text not null default 'disponible'
                   check (estado in ('disponible','en_ruta','descanso','almuerzo','inactivo','otros')),
  otros_texto    text,
  almuerzo_inicio timestamptz,
  desde          timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists sgc.chofer_estado_historial (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id) on delete cascade,
  estado      text not null,
  otros_texto text,
  origen      text not null default 'manual' check (origen in ('manual','auto')),
  por         uuid references sgc.usuarios(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_chofer_estado_hist on sgc.chofer_estado_historial (usuario_id, created_at desc);

alter table sgc.chofer_estado           enable row level security;
alter table sgc.chofer_estado_historial enable row level security;

drop policy if exists "chofer_estado: read" on sgc.chofer_estado;
create policy "chofer_estado: read" on sgc.chofer_estado
  for select to authenticated
  using (usuario_id = auth.uid() or sgc.es_flota_elevado());

drop policy if exists "chofer_estado_hist: read" on sgc.chofer_estado_historial;
create policy "chofer_estado_hist: read" on sgc.chofer_estado_historial
  for select to authenticated
  using (usuario_id = auth.uid() or sgc.es_flota_elevado());

grant select on sgc.chofer_estado           to authenticated;
grant select on sgc.chofer_estado_historial to authenticated;
grant all on sgc.chofer_estado           to service_role;
grant all on sgc.chofer_estado_historial to service_role;
-- escritura vía RPC SECURITY DEFINER

-- helper interno: fija el estado de un usuario + log (manual|auto)
create or replace function sgc._set_chofer_estado(p_usuario_id uuid, p_estado text, p_texto text, p_origen text)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  insert into sgc.chofer_estado (usuario_id, estado, otros_texto, almuerzo_inicio, desde, updated_at)
  values (p_usuario_id, p_estado,
          case when p_estado='otros' then p_texto else null end,
          case when p_estado='almuerzo' then now() else null end,
          now(), now())
  on conflict (usuario_id) do update
    set estado = excluded.estado,
        otros_texto = excluded.otros_texto,
        almuerzo_inicio = excluded.almuerzo_inicio,
        desde = now(),
        updated_at = now();
  insert into sgc.chofer_estado_historial (usuario_id, estado, otros_texto, origen, por)
  values (p_usuario_id, p_estado, case when p_estado='otros' then p_texto else null end, p_origen, auth.uid());
end;
$$;

-- RPC: el chofer fija su PROPIO estado
create or replace function sgc.set_chofer_estado(p_estado text, p_texto text default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_estado not in ('disponible','en_ruta','descanso','almuerzo','inactivo','otros') then
    raise exception 'Estado inválido: %', p_estado;
  end if;
  if p_estado = 'otros' and coalesce(trim(p_texto),'') = '' then
    raise exception 'El estado "Otros" requiere un texto.';
  end if;
  perform sgc._set_chofer_estado(v_uid, p_estado, p_texto, 'manual');
end;
$$;
grant execute on function sgc.set_chofer_estado(text, text) to authenticated, service_role;

-- Lectura para el jefe de flota: choferes con su estado actual + última ruta.
create or replace function sgc.choferes_estado()
returns table (
  usuario_id     uuid,
  conductor_id   uuid,
  nombre         text,
  estado         text,
  otros_texto    text,
  almuerzo_inicio timestamptz,
  desde          timestamptz,
  updated_at     timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select c.usuario_id, c.id, c.nombre,
         coalesce(e.estado, 'inactivo'), e.otros_texto, e.almuerzo_inicio,
         e.desde, e.updated_at
  from sgc.conductores c
  left join sgc.chofer_estado e on e.usuario_id = c.usuario_id
  where coalesce(c.activo, true)
    and (sgc.es_flota_elevado() or c.usuario_id = auth.uid())
  order by c.nombre;
$$;
grant execute on function sgc.choferes_estado() to authenticated, service_role;

-- ── Auto "En ruta": engancha en marcar_ruta_estado ──────────────────────────
create or replace function sgc.marcar_ruta_estado(p_ruta_id uuid, p_estado text, p_at timestamptz default null)
 returns void
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_ruta sgc.rutas%rowtype;
  v_at   timestamptz;
  v_chofer uuid;
begin
  if p_estado not in ('en_curso', 'completada', 'cancelada') then
    raise exception 'Estado inválido: %', p_estado;
  end if;
  select * into v_ruta from sgc.rutas where id = p_ruta_id for update;
  if not found then raise exception 'Ruta no encontrada.'; end if;
  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota')
    or exists (select 1 from sgc.conductores c
               where c.id = v_ruta.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No eres el conductor de esta ruta.';
  end if;

  v_at := least(greatest(coalesce(p_at, now()), v_ruta.created_at), now());

  if p_estado = 'en_curso' then
    update sgc.rutas set estado = p_estado, iniciada_at = coalesce(iniciada_at, v_at), updated_at = now()
     where id = p_ruta_id;
  elsif p_estado = 'completada' then
    v_at := greatest(v_at, coalesce(v_ruta.iniciada_at, v_ruta.created_at));
    update sgc.rutas set estado = p_estado, finalizada_at = v_at, updated_at = now() where id = p_ruta_id;
  else
    update sgc.rutas set estado = p_estado, updated_at = now() where id = p_ruta_id;
  end if;

  -- AF28 — En ruta automático (chofer de la ruta).
  select usuario_id into v_chofer from sgc.conductores where id = v_ruta.conductor_id;
  if v_chofer is not null then
    if p_estado = 'en_curso' then
      perform sgc._set_chofer_estado(v_chofer, 'en_ruta', null, 'auto');
    elsif p_estado in ('completada','cancelada') then
      -- solo si no tiene otra ruta en curso
      if not exists (select 1 from sgc.rutas r
                     where r.conductor_id = v_ruta.conductor_id and r.estado = 'en_curso' and r.id <> p_ruta_id) then
        perform sgc._set_chofer_estado(v_chofer, 'disponible', null, 'auto');
      end if;
    end if;
  end if;
end;
$function$;
grant execute on function sgc.marcar_ruta_estado(uuid, text, timestamptz) to authenticated, service_role;

-- ── Almuerzo: red de seguridad — al vencer 1h vuelve a disponible ───────────
create or replace function sgc.resetear_almuerzos_vencidos()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare r record; v_n int := 0;
begin
  for r in select usuario_id from sgc.chofer_estado
           where estado = 'almuerzo' and almuerzo_inicio is not null
             and almuerzo_inicio < now() - interval '1 hour'
  loop
    perform sgc._set_chofer_estado(r.usuario_id, 'disponible', null, 'auto');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function sgc.resetear_almuerzos_vencidos() to authenticated, service_role;

do $$ begin perform cron.unschedule('sgc-reset-almuerzos'); exception when others then null; end $$;
select cron.schedule('sgc-reset-almuerzos', '*/5 * * * *', $cron$ select sgc.resetear_almuerzos_vencidos(); $cron$);
