-- 2026-11-03-dh1-chofer-privado-quita-wall.sql
-- HOTFIX — Felix Manuel Mateo Sanchez (chofer_privado + chofer_transportista) quedó
-- bloqueado tomando el vehículo: "Este vehículo no está autorizado para ti. Pídeselo a
-- Flota." (RPC iniciar_uso_vehiculo, CJ11 08-oct). Diagnóstico en prod: los 4 usuarios con
-- rol chofer_privado (Felix, Carlos, Mendez, Dallin) tienen CERO filas en
-- vehiculo_autorizaciones — Flota nunca llegó a autorizar ninguno tras el rollout de CJ11,
-- así que el gate bloquea a TODOS los choferes privados para TODOS los vehículos.
--
-- Decisión de Xaviel (03-nov-2026): un chofer/conductor nunca debe tener una pared que le
-- impida tomar un vehículo o registrar su combustible. Se retira la verificación de
-- autorización de iniciar_uso_vehiculo (vuelve a comportarse como cualquier otro conductor:
-- is_admin() OR tiene_modulo('flota') OR es_conductor_ampliado()). La tabla
-- vehiculo_autorizaciones y la pantalla Flota›Choferes privados (CJ12) se quedan intactas
-- para que Flota siga pudiendo anotar/organizar qué vehículo usa cada privado — ya no
-- bloquean nada, son solo registro.
--
-- Reescribe sobre la definición VIVA en prod (regla 19). Aditivo/retrocompatible: solo
-- quita una condición de un IF, no cambia firma ni columnas.
--   node scripts/apply-migration.mjs sql/2026-11-03-dh1-chofer-privado-quita-wall.sql --env dev

create or replace function sgc.iniciar_uso_vehiculo(p_vehiculo_id uuid, p_km numeric DEFAULT NULL::numeric, p_nivel text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_recibir boolean DEFAULT false)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_v sgc.vehiculos%rowtype;
  v_activa sgc.vehiculo_usos%rowtype;
  v_uso_id uuid;
  v_prev uuid;
  v_prev_nombre text;
  v_mi_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_conductor_ampliado(v_uid)) then
    raise exception 'Tu usuario no puede tomar vehículos en uso.' using errcode = '42501';
  end if;

  -- DH1 — se retiró el gate de autorización por vehículo (CJ11): un chofer privado ya
  -- no necesita que Flota lo autorice vehículo por vehículo para poder tomarlo.

  select * into v_v from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado.'; end if;
  if not coalesce(v_v.activo, true) then raise exception 'Vehículo inactivo.'; end if;

  select * into v_activa from sgc.vehiculo_usos where vehiculo_id = p_vehiculo_id and fin_at is null limit 1;

  if found and v_activa.usuario_id = v_uid then
    return jsonb_build_object('ok', true, 'estado', 'ya_en_uso', 'uso_id', v_activa.id, 'vehiculo_id', p_vehiculo_id);
  end if;

  if found and v_activa.usuario_id <> v_uid then
    if not p_recibir then
      select nombre into v_prev_nombre from sgc.usuarios where id = v_activa.usuario_id;
      raise exception 'El vehículo está en uso por %.', coalesce(v_prev_nombre,'otro usuario')
        using errcode = 'DR409',
              detail = jsonb_build_object('en_uso_por', v_activa.usuario_id, 'nombre', v_prev_nombre, 'desde', v_activa.inicio_at)::text;
    end if;
    v_prev := v_activa.usuario_id;
    update sgc.vehiculo_usos
      set fin_at = now(),
          km_fin = coalesce(p_km, km_fin),
          nivel_combustible_fin = coalesce(nivel_combustible_fin, v_activa.nivel_combustible_inicio),
          notas = concat_ws(' · ', notas, 'Recibido por otro usuario')
      where id = v_activa.id;
    update sgc.vehiculo_entregas
      set estado = 'cerrada'
      where vehiculo_id = p_vehiculo_id and conductor_usuario_id = v_prev
        and tipo = 'recepcion' and estado = 'abierta';
  end if;

  insert into sgc.vehiculo_usos (vehiculo_id, usuario_id, km_inicio, nivel_combustible_inicio, recibido_de, notas, es_prueba)
  values (p_vehiculo_id, v_uid, p_km, nullif(p_nivel,''), v_prev, p_notas, coalesce(v_v.es_prueba, false))
  returning id into v_uso_id;

  update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;
  if p_km is not null then
    begin perform sgc.avanzar_odometro(p_vehiculo_id, p_km::int); exception when others then null; end;
  end if;
  perform sgc.asegurar_conductor_de_usuario(v_uid);

  if v_prev is not null then
    select nombre into v_prev_nombre from sgc.usuarios where id = v_prev;
    select nombre into v_mi_nombre from sgc.usuarios where id = v_uid;
    perform sgc.notificar(v_prev, 'flota', 'Tu vehículo fue recibido',
      coalesce(v_mi_nombre,'Otro usuario')||' recibió el vehículo '||coalesce(v_v.placa,'')||' que tenías en uso.',
      '/flota/mi-actividad');
    begin
      perform sgc.notificar_flota_elevado('flota', 'Traspaso de vehículo en uso',
        coalesce(v_mi_nombre,'Alguien')||' recibió '||trim(coalesce(v_v.marca,'')||' '||coalesce(v_v.placa,''))||
        ' de '||coalesce(v_prev_nombre,'otro usuario')||'.',
        '/flota/seguimiento');
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true,
    'estado', case when v_prev is not null then 'recibido' else 'iniciado' end,
    'uso_id', v_uso_id, 'vehiculo_id', p_vehiculo_id, 'recibido_de', v_prev);
end;
$function$;
grant execute on function sgc.iniciar_uso_vehiculo(uuid, numeric, text, text, boolean) to authenticated, service_role;
