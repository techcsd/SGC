-- Auto-attach the weather captured at creation time to a bitácora. bitacoras has
-- no UPDATE policy (by design — entries are immutable), so the snapshot id is
-- passed INTO the creation RPC rather than set afterwards. Drop + recreate to
-- change the signature (avoids an ambiguous overload).
drop function if exists sgc.crear_entrada_bitacora(
  uuid, uuid, date, text, text,
  text, text, time, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, text, text,
  text, text, text, smallint, text, text
);

create or replace function sgc.crear_entrada_bitacora(
  p_usuario_id uuid,
  p_proyecto_id uuid,
  p_fecha date,
  p_tipo text,
  p_comentarios text,
  p_bloque_entrepiso text default null,
  p_ingeniero_responsable text default null,
  p_hora_fin_trabajo time default null,
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
  p_weather_snapshot_id uuid default null
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
    incidente_lesionados, incidente_descripcion, incidente_acciones,
    weather_snapshot_id
  ) values (
    p_usuario_id, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    p_bloque_entrepiso, p_ingeniero_responsable, p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0), coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_visita_tipo_visitante, p_visita_nombre, p_visita_organizacion, p_visita_motivo,
    p_incidente_tipo, p_incidente_gravedad, p_incidente_subcontratista,
    coalesce(p_incidente_lesionados, 0), p_incidente_descripcion, p_incidente_acciones,
    p_weather_snapshot_id
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
  text, text, text, smallint, text, text, uuid
) to authenticated;
