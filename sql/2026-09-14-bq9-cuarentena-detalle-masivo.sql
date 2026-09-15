-- BQ9 — Cuarentena del incentivo: detalle inline + decisión masiva  ·  14/09/2026
-- ---------------------------------------------------------------------------------
-- El detalle de rutas ya existe (ruta_detalle_transporte).  Aquí:
--   · echada_detalle_incentivo(uuid): ficha de una echada para el panel inline,
--     gate puede_gestionar_incentivos() OR es_flota_elevado().
--   · incentivo_decidir_incidencias(...): decisión MASIVA (aceptar/excluir N),
--     mismo gate y misma escritura que el RPC unitario (regla 14).
-- Validar begin/rollback.  Aplicar con OK.
-- ---------------------------------------------------------------------------------

create or replace function sgc.echada_detalle_incentivo(p_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select case
    when not (sgc.puede_gestionar_incentivos() or sgc.es_flota_elevado()) then
      jsonb_build_object('error', 'no_autorizado')
    else (
      select jsonb_build_object(
        'id', r.id, 'fecha', r.fecha, 'vehiculo_id', r.vehiculo_id,
        'placa', v.placa, 'marca', v.marca, 'tipo', v.tipo,
        'galones', r.galones, 'monto', r.monto, 'precio_por_galon', r.precio_por_galon,
        'kilometraje', r.kilometraje, 'km_recorridos', r.km_recorridos,
        'rendimiento_km_gal', r.rendimiento_km_gal, 'estado', r.estado,
        'estacion', r.estacion, 'producto', r.producto,
        'conductor_id', r.conductor_id, 'conductor', sgc.nombre_usuario(c.usuario_id),
        'foto_recibo_path', r.foto_recibo_path, 'foto_tablero_path', r.foto_tablero_path,
        'foto_bomba_path', r.foto_bomba_path
      )
      from sgc.registros_combustible r
      left join sgc.vehiculos v on v.id = r.vehiculo_id
      left join sgc.conductores c on c.id = r.conductor_id
      where r.id = p_id
    )
  end;
$function$;
grant execute on function sgc.echada_detalle_incentivo(uuid) to authenticated;

-- Decisión MASIVA — mismo gate y misma tabla que incentivo_decidir_incidencia.
-- p_items = jsonb array de {ref_tipo, ref_id}.
create or replace function sgc.incentivo_decidir_incidencias(
  p_anio integer, p_semana integer, p_items jsonb, p_decision text, p_motivo text default null
)
returns integer
language plpgsql security definer
set search_path to 'sgc','public'
as $function$
declare v_it jsonb; v_n integer := 0; v_tipo text; v_ref uuid;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado para decidir incidencias del incentivo' using errcode = '42501';
  end if;
  if p_decision not in ('aceptada','excluida') then
    raise exception 'Decisión inválida (aceptada|excluida)' using errcode = 'BB400';
  end if;
  for v_it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_tipo := v_it->>'ref_tipo';
    v_ref  := nullif(v_it->>'ref_id','')::uuid;
    if v_tipo not in ('ruta','echada') or v_ref is null then continue; end if;
    insert into sgc.incentivo_incidencia_decision (anio, semana, ref_tipo, ref_id, decision, motivo, decidido_por)
    values (p_anio, p_semana, v_tipo, v_ref, p_decision, nullif(trim(p_motivo),''), auth.uid())
    on conflict (anio, semana, ref_tipo, ref_id) do update
      set decision = excluded.decision, motivo = excluded.motivo,
          decidido_por = excluded.decidido_por, decidido_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
grant execute on function sgc.incentivo_decidir_incidencias(integer,integer,jsonb,text,text) to authenticated;
