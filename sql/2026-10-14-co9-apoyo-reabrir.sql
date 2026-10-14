-- ============================================================================
-- CO9 — PROMPT-98 FASE 3 (14/10/2026)
-- "the user must be able to see who cancelled it, or change the status" (#219).
--
-- 1) apoyo_transporte_listado gana cancelada_por_nombre/cancelada_at/
--    motivo_cancelacion/completada_por_nombre (ya vivían en la tabla, CK12B; solo
--    faltaba exponerlos en el listado — el detalle ya los mostraba).
-- 2) apoyo_transporte_cambiar_estado deja a transporte elevado/admin REABRIR
--    (completada/cancelada → cualquier estado válido, incluido 'pendiente') con
--    nota obligatoria; el solicitante conserva sus reglas de siempre.
--
-- Aditivo e idempotente. Regla 19: recreadas sobre la definición viva de prod.
-- ============================================================================
begin;
set local search_path = sgc, public;

-- El TABLE(...) de salida cambió (4 columnas nuevas al final) → Postgres no deja
-- CREATE OR REPLACE cambiar el tipo de retorno; se dropea primero (misma firma de
-- entrada, cero llamadas rotas).
drop function if exists sgc.apoyo_transporte_listado(text,text,uuid,date);
create or replace function sgc.apoyo_transporte_listado(p_tipo text DEFAULT NULL::text, p_estado text DEFAULT NULL::text, p_proyecto_id uuid DEFAULT NULL::uuid, p_dia date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, tipo_apoyo text, proyecto_id uuid, proyecto text, dia date, descripcion text, estado text, solicitante text, conductor_id uuid, ruta_id uuid, foto_path text, created_at timestamp with time zone, cancelada_por_nombre text, cancelada_at timestamp with time zone, motivo_cancelacion text, completada_por_nombre text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
  select s.id, s.tipo_apoyo, s.proyecto_id, p.nombre, s.dia, coalesce(s.descripcion, s.que_se_mueve),
         s.estado, u.nombre, s.conductor_id, s.ruta_id,
         (select f.path from sgc.apoyo_transporte_fotos f where f.solicitud_id = s.id order by f.created_at limit 1),
         s.created_at,
         uc.nombre, s.cancelada_at, s.motivo_cancelacion, ucomp.nombre
    from sgc.solicitudes_movimiento s
    left join sgc.proyectos p on p.id = s.proyecto_id
    left join sgc.usuarios  u on u.id = s.solicitante_id
    left join sgc.usuarios  uc on uc.id = s.cancelada_por
    left join sgc.usuarios  ucomp on ucomp.id = s.completada_por
   where sgc.puede_ver_apoyo(s.id)
     and (not coalesce(s.es_prueba,false) or sgc.is_admin())
     and (p_tipo is null or s.tipo_apoyo = p_tipo)
     and (p_estado is null or s.estado = p_estado)
     and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
     and (p_dia is null or s.dia = p_dia)
   order by s.created_at desc;
$function$;
grant execute on function sgc.apoyo_transporte_listado(text,text,uuid,date) to authenticated;

create or replace function sgc.apoyo_transporte_cambiar_estado(p_id uuid, p_estado text, p_nota text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s sgc.solicitudes_movimiento%rowtype;
  v_elevado boolean := sgc.es_referente_movimiento();
  v_es_suyo boolean;
  v_destino text := lower(coalesce(nullif(trim(p_estado),''),''));
  v_nota text := nullif(trim(p_nota),'');
  v_reabriendo boolean := false;   -- CO9
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode='42501'; end if;
  select * into v_s from sgc.solicitudes_movimiento where id = p_id;
  if not found then raise exception 'Apoyo no encontrado.' using errcode='22023'; end if;

  v_es_suyo := v_s.solicitante_id = v_uid or v_s.created_by = v_uid
               or (v_s.proyecto_id is not null and sgc.es_miembro_obra(v_s.proyecto_id));

  if not (v_elevado or v_es_suyo) then
    raise exception 'No puedes cambiar el estado de este apoyo.' using errcode='42501';
  end if;

  -- CO9 — reabrir: solo transporte elevado/admin, y solo con nota (motivo obligatorio).
  if v_s.estado in ('completada','cancelada') then
    if v_elevado and v_nota is not null then
      v_reabriendo := true;
    else
      raise exception 'El apoyo ya está %.', v_s.estado using errcode='22023';
    end if;
  end if;
  if v_destino not in ('pendiente','asignada','en_proceso','por_confirmar','completada','cancelada') then
    raise exception 'Estado inválido.' using errcode='22023';
  end if;

  -- Reglas por rol (CK13) — se saltan cuando es un REABRIR explícito de un elevado
  -- (ya pasó el chequeo de arriba; forzar las reglas normales de flujo no aplica
  -- a "corregir un estado ya cerrado").
  if not v_reabriendo then
    if v_destino = 'cancelada' then
      if not v_elevado and v_s.estado <> 'pendiente' then
        raise exception 'Solo puedes cancelar mientras está pendiente; pídele al referente que la gestione.' using errcode='42501';
      end if;
    elsif v_destino = 'en_proceso' and v_s.estado = 'por_confirmar' then
      if v_nota is null then
        raise exception 'Escribe por qué aún no se ha hecho.' using errcode='22023';
      end if;
    elsif v_destino = 'asignada' then
      -- asignar es cosa del referente (lo hace al dar el ticket a un chofer).
      if not v_elevado then raise exception 'Solo transporte asigna el apoyo.' using errcode='42501'; end if;
    end if;
  end if;

  update sgc.solicitudes_movimiento
     set estado = v_destino,
         completada_por = case when v_destino='completada' then v_uid else completada_por end,
         completada_at  = case when v_destino='completada' then now() else completada_at end,
         cancelada_por  = case when v_destino='cancelada' then v_uid else cancelada_por end,
         cancelada_at   = case when v_destino='cancelada' then now() else cancelada_at end,
         motivo_cancelacion = case when v_destino='cancelada' then coalesce(v_nota, motivo_cancelacion) else motivo_cancelacion end
   where id = p_id;

  insert into sgc.apoyo_transporte_eventos (solicitud_id, de, a, por, nota)
  values (p_id, v_s.estado, v_destino, v_uid,
    case when v_reabriendo then concat('Reabierto/cambiado por transporte: ', v_nota) else v_nota end);

  -- Avisos a los involucrados.
  if v_s.solicitante_id is not null and v_s.solicitante_id <> v_uid then
    perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento',
      'Tu apoyo de transporte cambió de estado',
      'Ahora está: '||v_destino||coalesce(' — '||v_nota,'')||'.',
      '/transporte/apoyo');
  end if;
  if v_destino in ('por_confirmar','en_proceso') then
    perform sgc._notificar_referentes_movimiento(
      'Apoyo de transporte: '||v_destino,
      left(coalesce(v_s.descripcion, v_s.que_se_mueve),80)||coalesce(' — '||v_nota,''),
      '/transporte/apoyo');
  end if;
end;
$function$;
grant execute on function sgc.apoyo_transporte_cambiar_estado(uuid,text,text,uuid) to authenticated;

commit;
