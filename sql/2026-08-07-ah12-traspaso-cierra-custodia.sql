-- =============================================================================
-- PROMPT-9 FASE 2 (AH12) — Traspaso de vehículo: cerrar la custodia del tenedor
-- anterior. Aditivo y retrocompatible.
--
-- Diagnóstico (caso real Malibu Eduardo NG → Xaviel, reproducido en prod):
--   El RPC `traspasar_vehiculo` SÍ reasigna: desactiva la asignación de roster de A,
--   crea la de B, actualiza responsable_id, escribe el acta y notifica a A — todo
--   verificado. PERO `vehiculos_asignados()` deriva el "asignado a" de DOS fuentes
--   unidas: (1) custodia abierta (`vehiculo_entregas` tipo='recepcion'
--   estado='abierta') — tratada como la MÁS FUERTE — y (2) roster activo. El
--   traspaso nunca cerraba la custodia abierta del tenedor anterior, así que el
--   Malibu seguía mostrándose con Eduardo (custodia 27/07 sin cerrar) ADEMÁS de con
--   Xaviel (asignación). No era falla silenciosa del traspaso: era una segunda
--   fuente de verdad que el traspaso no sincronizaba.
--
--   El modelo YA soporta varios vehículos por usuario (sin constraint 1:1) —
--   confirmado: Xaviel tiene Lexus + Malibu.
--
-- Fix: (1) el RPC cierra la custodia abierta del tenedor anterior al recibir B;
--      (2) limpieza retroactiva de custodias abiertas superadas por una asignación
--      de roster más nueva a otra persona.
-- =============================================================================

begin;

create or replace function sgc.traspasar_vehiculo(
  p_vehiculo_id uuid, p_km integer default null, p_condiciones jsonb default null,
  p_fotos text[] default '{}', p_llave1_ubicacion text default null,
  p_llave1_portador uuid default null, p_llave1_detalle text default null, p_notas text default null)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();   -- B (nuevo asignado)
  v_a   uuid;                 -- A (asignado anterior)
  v_placa text;
  v_es_prueba boolean := false;
  v_acta uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Sin permiso para recibir vehículos';
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id) then
    raise exception 'Vehículo no encontrado';
  end if;

  select placa, coalesce(es_prueba,false) into v_placa, v_es_prueba from sgc.vehiculos where id = p_vehiculo_id;

  -- Asignado anterior (A): asignación activa o responsable legacy.
  select coalesce(a.usuario_id, c.usuario_id)
    into v_a
    from sgc.vehiculo_asignaciones a
    left join sgc.conductores c on c.id = a.conductor_id
   where a.vehiculo_id = p_vehiculo_id and a.activa
   order by a.desde desc nulls last
   limit 1;
  if v_a is null then
    select responsable_id into v_a from sgc.vehiculos where id = p_vehiculo_id;
  end if;

  -- Reasignar: retira las asignaciones activas y crea la de B.
  update sgc.vehiculo_asignaciones set activa = false, hasta = now()
   where vehiculo_id = p_vehiculo_id and activa;
  insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, desde, activa, origen, notas)
  values (p_vehiculo_id, v_uid, now(), true, 'auto', p_notas);
  update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;

  -- AH12 — Cerrar la custodia abierta del tenedor anterior: el traspaso la supera.
  -- Sin esto, vehiculos_asignados() seguía mostrando al anterior por 'custodia'
  -- (la fuente más fuerte) ademas del nuevo por 'asignacion'.
  update sgc.vehiculo_entregas
     set estado = 'cerrada'
   where vehiculo_id = p_vehiculo_id
     and tipo = 'recepcion' and estado = 'abierta'
     and conductor_usuario_id is distinct from v_uid;

  if p_km is not null then perform sgc.avanzar_odometro(p_vehiculo_id, p_km); end if;

  -- Llave 1: registrar su disposición si se indicó (traspaso autorizado).
  if p_llave1_ubicacion in ('chofer_asignado','oficina_central','otro') then
    insert into sgc.vehiculo_llaves (vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, actualizado_por, updated_at)
    values (p_vehiculo_id, 1, p_llave1_ubicacion,
            case when p_llave1_ubicacion='chofer_asignado' then coalesce(p_llave1_portador, v_uid) else null end,
            case when p_llave1_ubicacion='otro' then p_llave1_detalle else null end, v_uid, now())
    on conflict (vehiculo_id, numero) do update
      set ubicacion_tipo = excluded.ubicacion_tipo, portador_usuario_id = excluded.portador_usuario_id,
          ubicacion_detalle = excluded.ubicacion_detalle, actualizado_por = v_uid, updated_at = now();
    insert into sgc.vehiculo_llave_traspasos (vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, nota, registrado_por)
    values (p_vehiculo_id, 1, p_llave1_ubicacion,
            case when p_llave1_ubicacion='chofer_asignado' then coalesce(p_llave1_portador, v_uid) else null end,
            case when p_llave1_ubicacion='otro' then p_llave1_detalle else null end, 'Traspaso de vehículo', v_uid);
  end if;

  -- Acta.
  insert into sgc.vehiculo_traspaso_actas (
    vehiculo_id, de_usuario_id, a_usuario_id, km, condiciones, fotos, llave1_ubicacion_tipo, notas, es_prueba
  ) values (
    p_vehiculo_id, v_a, v_uid, p_km, p_condiciones, coalesce(p_fotos,'{}'), p_llave1_ubicacion, p_notas, v_es_prueba
  ) returning id into v_acta;

  -- Notificar a A (in-app + push). A NO tiene que aceptar; sólo se le avisa.
  if v_a is not null and v_a <> v_uid then
    perform sgc.notificar(
      v_a, 'info', 'Te recibieron un vehículo',
      format('%s recibió el vehículo %s. La responsabilidad pasó a esa persona.',
             coalesce((select nombre from sgc.usuarios where id = v_uid), 'Otro usuario'),
             coalesce(v_placa, '')),
      '/flota/vehiculos/' || p_vehiculo_id::text
    );
  end if;

  return v_acta;
end;
$function$;

-- Retroactivo: cerrar custodias abiertas superadas por una asignación de roster
-- más nueva a OTRA persona (limpia el caso Malibu/Eduardo y equivalentes).
update sgc.vehiculo_entregas e
   set estado = 'cerrada'
 where e.tipo = 'recepcion' and e.estado = 'abierta'
   and exists (
     select 1 from sgc.vehiculo_asignaciones a
     where a.vehiculo_id = e.vehiculo_id and a.activa
       and a.usuario_id is distinct from e.conductor_usuario_id
       and a.desde > e.created_at
   );

commit;
