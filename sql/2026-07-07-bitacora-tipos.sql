-- Bitácora entry types: the log used to be a single fixed-shape "parte diario".
-- Now an entry can also be a site VISIT (institución, propietario, supervisor
-- externo…) or an INCIDENT/ACCIDENT report naming the involved subcontratista.
-- The daily-log-only fields (bloque, ingeniero, hora, personal) don't apply to
-- visits/incidents, so they become nullable / default 0; type-specific fields
-- are added nullable. A new RPC handles all three types (still SECURITY INVOKER
-- so the usuario_id = auth.uid() insert check keeps holding).

alter table sgc.bitacoras
  add column if not exists tipo text not null default 'parte_diario'
    check (tipo in ('parte_diario', 'visita', 'incidente'));

-- Daily-log fields: not applicable to visits/incidents.
alter table sgc.bitacoras alter column bloque_entrepiso drop not null;
alter table sgc.bitacoras alter column ingeniero_responsable drop not null;
alter table sgc.bitacoras alter column hora_fin_trabajo drop not null;
alter table sgc.bitacoras alter column personal_carpinteria set default 0;
alter table sgc.bitacoras alter column personal_acero set default 0;
alter table sgc.bitacoras alter column trabajadores_casa set default 0;

-- Visita fields
alter table sgc.bitacoras
  add column if not exists visita_tipo_visitante text check (visita_tipo_visitante in (
    'institucion', 'propietario', 'supervisor_externo', 'cliente', 'proveedor', 'otro')),
  add column if not exists visita_nombre        text,
  add column if not exists visita_organizacion  text,
  add column if not exists visita_motivo        text;

-- Incidente / accidente fields
alter table sgc.bitacoras
  add column if not exists incidente_tipo         text check (incidente_tipo in ('incidente', 'accidente')),
  add column if not exists incidente_gravedad     text check (incidente_gravedad in ('leve', 'moderado', 'grave', 'critico')),
  add column if not exists incidente_subcontratista text,
  add column if not exists incidente_lesionados   smallint default 0,
  add column if not exists incidente_descripcion  text,
  add column if not exists incidente_acciones     text;

create index if not exists idx_bitacoras_tipo on sgc.bitacoras(tipo);

-- ── Unified creation RPC (parte diario / visita / incidente) ──
create or replace function sgc.crear_entrada_bitacora(
  p_usuario_id uuid,
  p_proyecto_id uuid,
  p_fecha date,
  p_tipo text,
  p_comentarios text,
  -- parte diario
  p_bloque_entrepiso text default null,
  p_ingeniero_responsable text default null,
  p_hora_fin_trabajo time default null,
  p_personal_carpinteria smallint default 0,
  p_personal_acero smallint default 0,
  p_trabajadores_casa smallint default 0,
  p_otro_personal text default null,
  p_actividades jsonb default '[]'::jsonb,
  p_restricciones jsonb default '[]'::jsonb,
  -- visita
  p_visita_tipo_visitante text default null,
  p_visita_nombre text default null,
  p_visita_organizacion text default null,
  p_visita_motivo text default null,
  -- incidente
  p_incidente_tipo text default null,
  p_incidente_gravedad text default null,
  p_incidente_subcontratista text default null,
  p_incidente_lesionados smallint default 0,
  p_incidente_descripcion text default null,
  p_incidente_acciones text default null
)
returns uuid
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
    incidente_lesionados, incidente_descripcion, incidente_acciones
  ) values (
    p_usuario_id, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    p_bloque_entrepiso, p_ingeniero_responsable, p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0), coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_visita_tipo_visitante, p_visita_nombre, p_visita_organizacion, p_visita_motivo,
    p_incidente_tipo, p_incidente_gravedad, p_incidente_subcontratista,
    coalesce(p_incidente_lesionados, 0), p_incidente_descripcion, p_incidente_acciones
  )
  returning id into v_id;

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(p_actividades) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad)
      select v_id, i->>'estructura', i->>'actividad' from jsonb_array_elements(p_actividades) as i;
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
  uuid, uuid, date, text, text,
  text, text, time, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, text, text,
  text, text, text, smallint, text, text
) to authenticated;
