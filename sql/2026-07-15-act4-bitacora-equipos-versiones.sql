-- ============================================================================
-- Actualización 4 — W1 (fotos), W2 (equipos alquilados), W7 (registrar_version)
-- ----------------------------------------------------------------------------
-- W1: el modelo de fotos de bitácora YA soporta N fotos (una fila por archivo en
--     sgc.bitacora_archivos, sin slots). Solo se añade un tope técnico ALTO y
--     configurable (parametros.bitacora_max_fotos = 40).
-- W2: tabla hija sgc.bitacora_equipos_alquilados + flag en bitacoras; el RPC web
--     crear_entrada_bitacora se extiende con parámetros NUEVOS con DEFAULT
--     (retrocompatible). Los nombres de equipo alimentan otros_valores (U25).
-- W7: RPC idempotente sgc.registrar_version(plataforma, version, notas) que
--     reutiliza app_versiones (plataforma 'web'|'movil', ya existente) con el
--     índice único (plataforma, version) → no duplica.
-- Todo aditivo/retrocompatible/idempotente.
-- ============================================================================

set search_path = sgc, public;

-- ── W1. Tope técnico configurable (el modelo soporta N) ──────────────────────
insert into sgc.parametros (clave, valor, descripcion)
select 'bitacora_max_fotos', '40',
       'Tope técnico de fotos por bitácora (alto). El modelo soporta N filas en bitacora_archivos.'
where not exists (select 1 from sgc.parametros where clave = 'bitacora_max_fotos');

-- ── W2. Equipos alquilados ───────────────────────────────────────────────────
alter table sgc.bitacoras add column if not exists hubo_equipos_alquilados boolean;

create table if not exists sgc.bitacora_equipos_alquilados (
  id          uuid primary key default gen_random_uuid(),
  bitacora_id uuid not null references sgc.bitacoras(id) on delete cascade,
  equipo      text not null,
  uso         text,
  proveedor   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_beq_bitacora on sgc.bitacora_equipos_alquilados(bitacora_id);

alter table sgc.bitacora_equipos_alquilados enable row level security;

drop policy if exists "beq: select" on sgc.bitacora_equipos_alquilados;
create policy "beq: select" on sgc.bitacora_equipos_alquilados
  for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id));

drop policy if exists "beq: insert" on sgc.bitacora_equipos_alquilados;
create policy "beq: insert" on sgc.bitacora_equipos_alquilados
  for insert to authenticated
  with check (exists (
    select 1 from sgc.bitacoras b
    where b.id = bitacora_equipos_alquilados.bitacora_id and b.usuario_id = auth.uid()
  ));

grant select, insert on sgc.bitacora_equipos_alquilados to authenticated;
grant all on sgc.bitacora_equipos_alquilados to service_role;

-- Extensión aditiva del RPC web: 2 params nuevos con DEFAULT al final.
-- OJO: agregar params crea un OVERLOAD nuevo; hay que eliminar el viejo (29 args)
-- para que las llamadas por nombre no queden ambiguas ("function is not unique").
drop function if exists sgc.crear_entrada_bitacora(
  uuid, uuid, date, text, text, text, text, time without time zone,
  smallint, smallint, smallint, text, jsonb, jsonb, text, text, text, text,
  text, text, text, smallint, text, text, uuid, boolean, text, boolean, jsonb
);

create or replace function sgc.crear_entrada_bitacora(
  p_usuario_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text, p_comentarios text,
  p_bloque_entrepiso text default null, p_ingeniero_responsable text default null,
  p_hora_fin_trabajo time without time zone default null,
  p_personal_carpinteria smallint default 0, p_personal_acero smallint default 0,
  p_trabajadores_casa smallint default 0, p_otro_personal text default null,
  p_actividades jsonb default '[]'::jsonb, p_restricciones jsonb default '[]'::jsonb,
  p_visita_tipo_visitante text default null, p_visita_nombre text default null,
  p_visita_organizacion text default null, p_visita_motivo text default null,
  p_incidente_tipo text default null, p_incidente_gravedad text default null,
  p_incidente_subcontratista text default null, p_incidente_lesionados smallint default 0,
  p_incidente_descripcion text default null, p_incidente_acciones text default null,
  p_weather_snapshot_id uuid default null,
  p_llovio boolean default null, p_lluvia_detalle text default null,
  p_hubo_migracion boolean default null, p_migracion_obreros jsonb default null,
  p_hubo_equipos boolean default null, p_equipos_alquilados jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid;
  v_eq jsonb;
begin
  insert into sgc.bitacoras (
    usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista,
    incidente_lesionados, incidente_descripcion, incidente_acciones,
    weather_snapshot_id,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros,
    hubo_equipos_alquilados
  ) values (
    p_usuario_id, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    p_bloque_entrepiso, p_ingeniero_responsable, p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0), coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_visita_tipo_visitante, p_visita_nombre, p_visita_organizacion, p_visita_motivo,
    p_incidente_tipo, p_incidente_gravedad, p_incidente_subcontratista,
    coalesce(p_incidente_lesionados, 0), p_incidente_descripcion, p_incidente_acciones,
    p_weather_snapshot_id,
    p_llovio, nullif(p_lluvia_detalle,''), p_hubo_migracion, p_migracion_obreros,
    p_hubo_equipos
  )
  returning id into v_id;

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(p_actividades) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad)
      select v_id, i->>'estructura', i->>'actividad', nullif(i->>'cantidad','')::numeric
        from jsonb_array_elements(p_actividades) as i;
    end if;
    if jsonb_array_length(p_restricciones) > 0 then
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro)
      select v_id, i->>'tipo_restriccion', i->>'descripcion_otro' from jsonb_array_elements(p_restricciones) as i;
    end if;
  end if;

  -- W2: equipos alquilados (aditivo). Cada equipo alimenta otros_valores (U25).
  if coalesce(p_hubo_equipos, false) and p_equipos_alquilados is not null
     and jsonb_array_length(p_equipos_alquilados) > 0 then
    for v_eq in select * from jsonb_array_elements(p_equipos_alquilados) loop
      if coalesce(trim(v_eq->>'equipo'), '') <> '' then
        insert into sgc.bitacora_equipos_alquilados (bitacora_id, equipo, uso, proveedor)
        values (v_id, trim(v_eq->>'equipo'), nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''));
        perform sgc.registrar_otro_valor('bitacora_equipo_alquilado', trim(v_eq->>'equipo'), v_id);
      end if;
    end loop;
  end if;

  return v_id;
end;
$function$;

-- ── W7. Registro idempotente de versiones (web y app) ────────────────────────
create or replace function sgc.registrar_version(
  p_plataforma text, p_version text, p_notas text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if p_plataforma not in ('web', 'movil') then
    raise exception 'plataforma inválida: % (usa web|movil)', p_plataforma;
  end if;
  if coalesce(trim(p_version), '') = '' then
    raise exception 'versión requerida';
  end if;

  insert into sgc.app_versiones (plataforma, version, fecha, notas)
  values (p_plataforma, trim(p_version), current_date, nullif(trim(p_notas), ''))
  on conflict (plataforma, version) do nothing
  returning id into v_id;

  -- Si ya existía, devolver el id existente (idempotente, no duplica).
  if v_id is null then
    select id into v_id from sgc.app_versiones
     where plataforma = p_plataforma and version = trim(p_version);
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.registrar_version(text, text, text) to authenticated, service_role;
