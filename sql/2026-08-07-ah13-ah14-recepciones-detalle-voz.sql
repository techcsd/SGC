-- =============================================================================
-- PROMPT-9 FASE 6 (AH14, AH13-backend) — Recepciones de vehículos: marca/modelo
-- en el listado + RPC de detalle con checklist, fotos, firmas y notas de voz.
-- Aditivo. No hay listado en web hoy (las actas viven en la app); esto deja el
-- contrato de listado+detalle listo para web (AH14) y app (PROMPT-10 FASE 6).
--
--  AH14 — reconocer el vehículo por MARCA + MODELO (no solo placa) y detalle al
--         click. `mis_actas_traspaso` pasa a incluir marca/modelo.
--  AH13-backend — el acta soporta, por item con falla del checklist:
--         descripción, foto(s) y NOTA DE VOZ. Representación (aditiva, sin cambios
--         de esquema; ya existían las piezas):
--           • `vehiculo_traspaso_actas.condiciones` (jsonb): lista de items del
--             checklist; cada item con falla lleva
--             { item, estado, descripcion, fotos:[paths] }.
--           • Notas de voz: `sgc.audio_notas` con entidad_tipo='traspaso_acta' y
--             entidad_id = acta.id (mismo pipeline que bitácora AA8-AA12; su RLS
--             de INSERT ya exige creado_por=auth.uid() y el SELECT es abierto a
--             autenticados). La app (PROMPT-10) captura texto/voz/foto por item.
-- =============================================================================

begin;

-- ── AH14 — listado con marca/modelo ─────────────────────────────────────────
drop function if exists sgc.mis_actas_traspaso();
create function sgc.mis_actas_traspaso()
returns table (
  id uuid, vehiculo_id uuid, placa text, marca text, modelo text, km integer,
  de_usuario_id uuid, de_nombre text, a_usuario_id uuid, a_nombre text,
  llave1_ubicacion_tipo text, fotos text[], notas text, created_at timestamptz
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select a.id, a.vehiculo_id, v.placa, v.marca, v.modelo, a.km,
         a.de_usuario_id, ud.nombre, a.a_usuario_id, ua.nombre,
         a.llave1_ubicacion_tipo, a.fotos, a.notas, a.created_at
  from sgc.vehiculo_traspaso_actas a
  left join sgc.vehiculos v on v.id = a.vehiculo_id
  left join sgc.usuarios ud on ud.id = a.de_usuario_id
  left join sgc.usuarios ua on ua.id = a.a_usuario_id
  where (a.a_usuario_id = auth.uid() or a.de_usuario_id = auth.uid()
         or sgc.is_admin() or sgc.tiene_modulo('flota'))
    and (not coalesce(a.es_prueba, false) or sgc.is_admin())
  order by a.created_at desc;
$function$;
grant execute on function sgc.mis_actas_traspaso() to authenticated;

-- ── AH14/AH13 — detalle de un acta (web + app) ──────────────────────────────
create or replace function sgc.acta_traspaso_detalle(p_acta_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_acta sgc.vehiculo_traspaso_actas%rowtype;
  v_res jsonb;
begin
  select * into v_acta from sgc.vehiculo_traspaso_actas where id = p_acta_id;
  if not found then raise exception 'Acta no encontrada'; end if;

  -- Visibilidad: partes, flota, admin.
  if not (v_acta.a_usuario_id = auth.uid() or v_acta.de_usuario_id = auth.uid()
          or sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'Sin acceso a esta acta';
  end if;
  if coalesce(v_acta.es_prueba,false) and not sgc.is_admin() then
    raise exception 'Sin acceso a esta acta';
  end if;

  select jsonb_build_object(
    'id', v_acta.id,
    'vehiculo_id', v_acta.vehiculo_id,
    'placa', v.placa, 'marca', v.marca, 'modelo', v.modelo,
    'km', v_acta.km,
    'de', jsonb_build_object('id', v_acta.de_usuario_id, 'nombre', ud.nombre),
    'a',  jsonb_build_object('id', v_acta.a_usuario_id, 'nombre', ua.nombre),
    'llave1_ubicacion_tipo', v_acta.llave1_ubicacion_tipo,
    'condiciones', coalesce(v_acta.condiciones, '[]'::jsonb),  -- checklist con fallas (AH13)
    'fotos', to_jsonb(coalesce(v_acta.fotos, '{}')),
    'notas', v_acta.notas,
    'created_at', v_acta.created_at,
    -- Notas de voz del acta (AH13) — mismo pipeline que bitácora.
    'audios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', an.id, 'bucket', an.bucket, 'path', an.path,
        'duracion_seg', an.duracion_seg, 'transcripcion', an.transcripcion)
        order by an.created_at)
      from sgc.audio_notas an
      where an.entidad_tipo = 'traspaso_acta' and an.entidad_id = v_acta.id
    ), '[]'::jsonb)
  )
  into v_res
  from sgc.vehiculos v
  left join sgc.usuarios ud on ud.id = v_acta.de_usuario_id
  left join sgc.usuarios ua on ua.id = v_acta.a_usuario_id
  where v.id = v_acta.vehiculo_id;

  return v_res;
end;
$function$;
grant execute on function sgc.acta_traspaso_detalle(uuid) to authenticated;

commit;
