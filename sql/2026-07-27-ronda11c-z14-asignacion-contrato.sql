-- ============================================================================
-- RONDA 11c · Z14 — Contrato de asignación para la app (aceptada/rechazada) + año
-- ----------------------------------------------------------------------------
-- La asignación ya es N:M (vehiculo_asignaciones) y el handover ya existe
-- (crear_entrega_vehiculo p_forzar_handover). Falta cerrar el contrato para la
-- CSD App (PROMPT-4 FASE 3): que la respuesta del RPC de auto-asignación traiga
-- una señal EXPLÍCITA de aceptación, para que la app NO haga update optimista sin
-- rollback (patrón: no reflejar la asignación hasta recibir aceptada=true; si el
-- RPC lanza excepción, fue RECHAZADA y nunca se aplicó nada que revertir).
-- Aditivo: solo se AGREGAN claves ('aceptada', 'anio') al jsonb de éxito.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.asignarme_vehiculo(p_vehiculo_id uuid, p_client_uuid uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_asig_id   uuid;
  v_cond_id   uuid;
  v_estado    text;
  v_activo    boolean;
  v_km_ult    int;
  v_intervalo int;
  v_veh       record;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- Idempotencia: reenvío del mismo op devuelve la asignación existente (aceptada).
  if p_client_uuid is not null then
    select id into v_asig_id from sgc.vehiculo_asignaciones where client_uuid = p_client_uuid;
    if v_asig_id is not null then
      return (select to_jsonb(a) || jsonb_build_object('aceptada', true)
                from sgc.vehiculo_asignaciones a where a.id = v_asig_id);
    end if;
  end if;

  select estado, coalesce(activo, true), km_ultimo_mantenimiento, intervalo_mantenimiento_km
    into v_estado, v_activo, v_km_ult, v_intervalo
    from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not v_activo or v_estado in ('baja','no_disponible') then
    raise exception 'El vehículo no está disponible (estado: %).', v_estado;
  end if;

  -- Conductor vinculado a este usuario (si ya se auto-registró).
  select id into v_cond_id from sgc.conductores where usuario_id = v_uid and activo limit 1;

  -- Si ya tiene una asignación activa, la reutiliza (no duplica).
  select id into v_asig_id
    from sgc.vehiculo_asignaciones
   where vehiculo_id = p_vehiculo_id and usuario_id = v_uid and activa
   limit 1;

  if v_asig_id is null then
    insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, conductor_id, origen, client_uuid)
    values (p_vehiculo_id, v_uid, v_cond_id, 'auto', p_client_uuid)
    returning id into v_asig_id;
  end if;

  -- Mantener responsable_id como principal (compatibilidad) si estaba vacío.
  update sgc.vehiculos set responsable_id = v_uid
   where id = p_vehiculo_id and responsable_id is null;

  select placa, marca, modelo, anio, tipo, kilometraje, vencimiento_matricula, vencimiento_seguro
    into v_veh
    from sgc.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'aceptada',              true,
    'asignacion_id',         v_asig_id,
    'vehiculo_id',           p_vehiculo_id,
    'conductor_id',          v_cond_id,
    'placa',                 v_veh.placa,
    'marca',                 v_veh.marca,
    'modelo',                v_veh.modelo,
    'anio',                  v_veh.anio,
    'tipo',                  v_veh.tipo,
    'kilometraje',           v_veh.kilometraje,
    'vencimiento_matricula', v_veh.vencimiento_matricula,
    'vencimiento_seguro',    v_veh.vencimiento_seguro,
    'proximo_mantenimiento_km',
        case when v_km_ult is not null then v_km_ult + coalesce(v_intervalo,5000) else null end
  );
end;
$function$;

grant execute on function sgc.asignarme_vehiculo(uuid, uuid) to authenticated, service_role;
