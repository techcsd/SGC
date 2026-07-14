-- ============================================================================
-- Mejoras 14/07/2026 — Bitácora (R21 clima, R22 migración, R23 descripción, R24 cantidades)
-- ----------------------------------------------------------------------------
-- Aditivo/retrocompatible. La app móvil llama sgc.crear_entrada_bitacora; se
-- re-crea con parámetros nuevos AL FINAL, todos con DEFAULT (las llamadas
-- actuales por nombre siguen resolviendo).
--   R21  bitacoras.llovio / lluvia_detalle  (el clima NO es incidente)
--   R22  bitacoras.hubo_migracion / migracion_obreros
--   R23  incidente_descripcion ya existe (columna) -> sin cambio de esquema
--   R24  bitacora_actividades.cantidad + sgc.proyecto_partidas
-- ============================================================================

set search_path = sgc, public;

-- ── Columnas nuevas ─────────────────────────────────────────────────────────
alter table sgc.bitacoras
  add column if not exists llovio            boolean,
  add column if not exists lluvia_detalle    text,
  add column if not exists hubo_migracion    boolean,
  add column if not exists migracion_obreros jsonb;

alter table sgc.bitacora_actividades
  add column if not exists cantidad numeric;

-- ── R24) Partidas planeadas por obra ────────────────────────────────────────
create table if not exists sgc.proyecto_partidas (
  id                uuid primary key default gen_random_uuid(),
  proyecto_id       uuid not null references sgc.proyectos(id) on delete cascade,
  nombre            text not null,
  unidad            text,
  cantidad_planeada numeric not null default 0,
  cantidad_ejecutada numeric not null default 0,
  activa            boolean not null default true,
  orden             int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_proyecto_partidas_proyecto on sgc.proyecto_partidas(proyecto_id) where activa;

alter table sgc.proyecto_partidas enable row level security;
drop policy if exists proyecto_partidas_sel on sgc.proyecto_partidas;
create policy proyecto_partidas_sel on sgc.proyecto_partidas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.tiene_modulo('direccion'));
drop policy if exists proyecto_partidas_all on sgc.proyecto_partidas;
create policy proyecto_partidas_all on sgc.proyecto_partidas for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));

-- Homologa el nombre de la partida (usuario).
drop trigger if exists trg_homologar_partida_ins on sgc.proyecto_partidas;
drop trigger if exists trg_homologar_partida_upd on sgc.proyecto_partidas;
create trigger trg_homologar_partida_ins before insert on sgc.proyecto_partidas
  for each row execute function sgc.tg_homologar_nombre();
create trigger trg_homologar_partida_upd before update on sgc.proyecto_partidas
  for each row when (new.nombre is distinct from old.nombre)
  execute function sgc.tg_homologar_nombre();

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.proyecto_partidas to authenticated;
grant all on sgc.proyecto_partidas to service_role;

do $$ begin
  alter publication supabase_realtime add table sgc.proyecto_partidas;
exception when duplicate_object then null; end $$;

-- ── RPC crear_entrada_bitacora extendido (retrocompatible) ──────────────────
drop function if exists sgc.crear_entrada_bitacora(
  uuid, uuid, date, text, text, text, text, time without time zone,
  smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, text, text, text, text, text, smallint, text, text, uuid);

create or replace function sgc.crear_entrada_bitacora(
  p_usuario_id uuid,
  p_proyecto_id uuid,
  p_fecha date,
  p_tipo text,
  p_comentarios text,
  p_bloque_entrepiso text default null,
  p_ingeniero_responsable text default null,
  p_hora_fin_trabajo time without time zone default null,
  p_personal_carpinteria smallint default 0,
  p_personal_acero smallint default 0,
  p_trabajadores_casa smallint default 0,
  p_otro_personal text default null,
  p_actividades jsonb default '[]'::jsonb,
  p_restricciones jsonb default '[]'::jsonb,
  p_visita_tipo_visitante text default null,
  p_visita_nombre text default null,
  p_visita_organizacion text default null,
  p_visita_motivo text default null,
  p_incidente_tipo text default null,
  p_incidente_gravedad text default null,
  p_incidente_subcontratista text default null,
  p_incidente_lesionados smallint default 0,
  p_incidente_descripcion text default null,
  p_incidente_acciones text default null,
  p_weather_snapshot_id uuid default null,
  -- Nuevos (14/07), todos con DEFAULT:
  p_llovio boolean default null,
  p_lluvia_detalle text default null,
  p_hubo_migracion boolean default null,
  p_migracion_obreros jsonb default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into sgc.bitacoras (
    usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista,
    incidente_lesionados, incidente_descripcion, incidente_acciones,
    weather_snapshot_id,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros
  ) values (
    p_usuario_id, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    p_bloque_entrepiso, p_ingeniero_responsable, p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0), coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_visita_tipo_visitante, p_visita_nombre, p_visita_organizacion, p_visita_motivo,
    p_incidente_tipo, p_incidente_gravedad, p_incidente_subcontratista,
    coalesce(p_incidente_lesionados, 0), p_incidente_descripcion, p_incidente_acciones,
    p_weather_snapshot_id,
    p_llovio, nullif(p_lluvia_detalle,''), p_hubo_migracion, p_migracion_obreros
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

  return v_id;
end;
$$;
grant execute on function sgc.crear_entrada_bitacora(
  uuid, uuid, date, text, text, text, text, time without time zone,
  smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, text, text, text, text, text, smallint, text, text, uuid,
  boolean, text, boolean, jsonb
) to authenticated, service_role;
