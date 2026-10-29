-- sql/2026-10-29-db9-levantamiento-personal.sql — Ronda DB (PROMPT-124 F4, DB5)
-- Levantamiento diario de personal de obra (nota 13 de Xaviel): saber QUIÉN está
-- hoy, quién es NUEVO hoy y quién FALTA respecto al último levantamiento cerrado.
-- Se alimenta de dos lados: registrar personal lo marca presente hoy (trigger) y
-- la pantalla «Levantamiento de hoy» permite marcar presente/faltó y cerrar el día.
--
-- RLS espejo de personal_obra (puede_ver/puede_gestionar_personal_obra). Las
-- escrituras pasan SOLO por RPCs SECURITY DEFINER con el mismo gate (regla BC7:
-- el camino de escritura existe y es único).
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db9-levantamiento-personal.sql --env dev

-- ── 1) Tablas ─────────────────────────────────────────────────────────────────
create table if not exists sgc.personal_obra_levantamientos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id),
  fecha date not null default (now() at time zone 'America/Santo_Domingo')::date,
  registrado_por uuid references sgc.usuarios(id),
  cerrado_at timestamptz,
  cerrado_por uuid references sgc.usuarios(id),
  es_prueba boolean not null default false,
  created_at timestamptz not null default now(),
  unique (proyecto_id, fecha)
);
create table if not exists sgc.personal_obra_levantamiento_lineas (
  id uuid primary key default gen_random_uuid(),
  levantamiento_id uuid not null references sgc.personal_obra_levantamientos(id) on delete cascade,
  personal_id uuid not null references sgc.personal_obra(id) on delete cascade,
  presente boolean not null default true,
  origen text not null default 'marcado' check (origen in ('registro','marcado')),
  marcado_por uuid references sgc.usuarios(id),
  marcado_at timestamptz not null default now(),
  unique (levantamiento_id, personal_id)
);
create index if not exists idx_pol_lineas_lev on sgc.personal_obra_levantamiento_lineas(levantamiento_id);

alter table sgc.personal_obra_levantamientos enable row level security;
alter table sgc.personal_obra_levantamiento_lineas enable row level security;

drop policy if exists "pol_lev: ver" on sgc.personal_obra_levantamientos;
create policy "pol_lev: ver" on sgc.personal_obra_levantamientos
  for select to authenticated
  using (sgc.puede_ver_personal_obra(proyecto_id));
drop policy if exists "pol_lev_lineas: ver" on sgc.personal_obra_levantamiento_lineas;
create policy "pol_lev_lineas: ver" on sgc.personal_obra_levantamiento_lineas
  for select to authenticated
  using (exists (select 1 from sgc.personal_obra_levantamientos l
                 where l.id = levantamiento_id and sgc.puede_ver_personal_obra(l.proyecto_id)));

grant select on sgc.personal_obra_levantamientos, sgc.personal_obra_levantamiento_lineas to authenticated;
grant select, insert, update, delete on sgc.personal_obra_levantamientos, sgc.personal_obra_levantamiento_lineas to service_role;

-- ── 2) Trigger: registrar personal = presente hoy ─────────────────────────────
create or replace function sgc.tg_personal_obra_presente_hoy()
returns trigger
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_lev uuid;
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
begin
  -- Crea (si no existe) el levantamiento de HOY de esa obra y marca presente.
  insert into sgc.personal_obra_levantamientos (proyecto_id, fecha, registrado_por, es_prueba)
  values (new.proyecto_id, v_hoy, coalesce(new.registrado_por, auth.uid()), coalesce(new.es_prueba, false))
  on conflict (proyecto_id, fecha) do update set proyecto_id = excluded.proyecto_id
  returning id into v_lev;

  insert into sgc.personal_obra_levantamiento_lineas (levantamiento_id, personal_id, presente, origen, marcado_por)
  values (v_lev, new.id, true, 'registro', coalesce(new.registrado_por, auth.uid()))
  on conflict (levantamiento_id, personal_id) do update set presente = true;
  return new;
end $function$;

drop trigger if exists trg_personal_presente_hoy on sgc.personal_obra;
create trigger trg_personal_presente_hoy
  after insert on sgc.personal_obra
  for each row execute function sgc.tg_personal_obra_presente_hoy();

-- ── 3) levantamiento_de_hoy(proyecto) — crea si hace falta y devuelve el estado ──
-- Devuelve el levantamiento de hoy con TODO el personal activo de la obra:
--   presente (true/false/null = sin marcar), nuevo_hoy (registrado hoy),
--   en_ultimo (estaba presente en el último levantamiento CERRADO anterior).
-- «Faltan» = en_ultimo y no presente hoy.
create or replace function sgc.levantamiento_de_hoy(p_proyecto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_lev sgc.personal_obra_levantamientos%rowtype;
  v_ultimo uuid;
  v_ultima_fecha date;
  v_personal jsonb;
begin
  if not sgc.puede_ver_personal_obra(p_proyecto_id) then
    raise exception 'No tienes acceso al personal de esta obra.' using errcode = '42501';
  end if;

  select * into v_lev from sgc.personal_obra_levantamientos
   where proyecto_id = p_proyecto_id and fecha = v_hoy;
  if not found then
    if sgc.puede_gestionar_personal_obra(p_proyecto_id) then
      insert into sgc.personal_obra_levantamientos (proyecto_id, fecha, registrado_por)
      values (p_proyecto_id, v_hoy, auth.uid())
      on conflict (proyecto_id, fecha) do update set proyecto_id = excluded.proyecto_id
      returning * into v_lev;
    end if;
  end if;

  -- Último levantamiento CERRADO anterior a hoy (la referencia de «faltan»).
  select id, fecha into v_ultimo, v_ultima_fecha
  from sgc.personal_obra_levantamientos
  where proyecto_id = p_proyecto_id and fecha < v_hoy and cerrado_at is not null
  order by fecha desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'personal_id', p.id,
      'nombre', p.nombre,
      'apellido', p.apellido,
      'cargo', c.nombre,
      'documento_numero', p.documento_numero,
      'presente', li.presente,
      'origen', li.origen,
      'nuevo_hoy', (p.created_at at time zone 'America/Santo_Domingo')::date = v_hoy,
      'en_ultimo', coalesce(ult.presente, false)
    ) order by p.nombre), '[]'::jsonb)
  into v_personal
  from sgc.personal_obra p
  left join sgc.cargos c on c.id = p.cargo_id
  left join sgc.personal_obra_levantamiento_lineas li
    on li.levantamiento_id = v_lev.id and li.personal_id = p.id
  left join sgc.personal_obra_levantamiento_lineas ult
    on ult.levantamiento_id = v_ultimo and ult.personal_id = p.id
  where p.proyecto_id = p_proyecto_id
    and p.eliminado_at is null
    and coalesce(p.activo_en_obra, true);

  return jsonb_build_object(
    'id', v_lev.id,
    'proyecto_id', p_proyecto_id,
    'fecha', coalesce(v_lev.fecha, v_hoy),
    'cerrado_at', v_lev.cerrado_at,
    'ultimo_cerrado_fecha', v_ultima_fecha,
    'personal', v_personal);
end $function$;
grant execute on function sgc.levantamiento_de_hoy(uuid) to authenticated;

-- ── 4) levantamiento_marcar(personal, presente) ───────────────────────────────
create or replace function sgc.levantamiento_marcar(p_personal_id uuid, p_presente boolean)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_proyecto uuid;
  v_lev uuid;
  v_cerrado timestamptz;
begin
  select proyecto_id into v_proyecto from sgc.personal_obra where id = p_personal_id and eliminado_at is null;
  if not found then raise exception 'Persona no encontrada.' using errcode = 'P0002'; end if;
  if not sgc.puede_gestionar_personal_obra(v_proyecto) then
    raise exception 'No puedes gestionar el personal de esta obra.' using errcode = '42501';
  end if;

  insert into sgc.personal_obra_levantamientos (proyecto_id, fecha, registrado_por)
  values (v_proyecto, v_hoy, auth.uid())
  on conflict (proyecto_id, fecha) do update set proyecto_id = excluded.proyecto_id
  returning id, cerrado_at into v_lev, v_cerrado;
  if v_cerrado is not null then
    raise exception 'El levantamiento de hoy ya está cerrado.' using errcode = '22023';
  end if;

  insert into sgc.personal_obra_levantamiento_lineas (levantamiento_id, personal_id, presente, origen, marcado_por)
  values (v_lev, p_personal_id, p_presente, 'marcado', auth.uid())
  on conflict (levantamiento_id, personal_id)
    do update set presente = excluded.presente, marcado_por = auth.uid(), marcado_at = now();
end $function$;
grant execute on function sgc.levantamiento_marcar(uuid, boolean) to authenticated;

-- ── 5) levantamiento_cerrar(id) ───────────────────────────────────────────────
create or replace function sgc.levantamiento_cerrar(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_proyecto uuid;
begin
  select proyecto_id into v_proyecto from sgc.personal_obra_levantamientos where id = p_id;
  if not found then raise exception 'Levantamiento no encontrado.' using errcode = 'P0002'; end if;
  if not sgc.puede_gestionar_personal_obra(v_proyecto) then
    raise exception 'No puedes gestionar el personal de esta obra.' using errcode = '42501';
  end if;
  update sgc.personal_obra_levantamientos
     set cerrado_at = coalesce(cerrado_at, now()), cerrado_por = coalesce(cerrado_por, auth.uid())
   where id = p_id;
end $function$;
grant execute on function sgc.levantamiento_cerrar(uuid) to authenticated;
