-- Atomic bitácora creation (header + actividades + restricciones).
-- Deliberately NOT security definer: it must run as the calling user so
-- the "bitacoras: insert" RLS check (usuario_id = auth.uid()) still applies —
-- a client can't pass someone else's p_usuario_id to spoof another engineer.
create or replace function sgc.crear_bitacora(
  p_usuario_id uuid,
  p_proyecto_id uuid,
  p_fecha date,
  p_bloque_entrepiso text,
  p_ingeniero_responsable text,
  p_hora_fin_trabajo time,
  p_personal_carpinteria smallint,
  p_personal_acero smallint,
  p_trabajadores_casa smallint,
  p_otro_personal text,
  p_comentarios text,
  p_actividades jsonb,
  p_restricciones jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_bitacora_id uuid;
begin
  insert into sgc.bitacoras (
    usuario_id, proyecto_id, fecha, bloque_entrepiso, ingeniero_responsable,
    hora_fin_trabajo, personal_carpinteria, personal_acero, trabajadores_casa,
    otro_personal, comentarios
  ) values (
    p_usuario_id, p_proyecto_id, p_fecha, p_bloque_entrepiso, p_ingeniero_responsable,
    p_hora_fin_trabajo, p_personal_carpinteria, p_personal_acero, p_trabajadores_casa,
    p_otro_personal, p_comentarios
  )
  returning id into v_bitacora_id;

  if jsonb_array_length(p_actividades) > 0 then
    insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad)
    select v_bitacora_id, i->>'estructura', i->>'actividad'
    from jsonb_array_elements(p_actividades) as i;
  end if;

  if jsonb_array_length(p_restricciones) > 0 then
    insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro)
    select v_bitacora_id, i->>'tipo_restriccion', i->>'descripcion_otro'
    from jsonb_array_elements(p_restricciones) as i;
  end if;

  return v_bitacora_id;
end;
$$;

grant execute on function sgc.crear_bitacora(
  uuid, uuid, date, text, text, time, smallint, smallint, smallint, text, text, jsonb, jsonb
) to authenticated;
