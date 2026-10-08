-- 2026-10-08-cj11-privado-uso-vehiculo.sql
-- CJ11 — El chofer privado puede tomar/soltar/recibir SOLO los vehículos que Flota le
-- autorizó (cadena de responsabilidad, igual que el chofer de flota). Reescribe sobre la
-- definición VIVA en prod (regla 19). Aditivo/retrocompatible.
--
-- ⚠️ ROLLOUT: hoy un chofer_privado (p. ej. Mendez, Carlos) YA pasa el gate de
-- iniciar_uso_vehiculo (tienen ficha en `conductores` + módulo flota), así que pueden
-- tomar CUALQUIER vehículo. Esta migración añade el chequeo de AUTORIZACIÓN: un privado
-- sin autorizaciones quedará BLOQUEADO hasta que Flota lo autorice. Mendez y Carlos tienen
-- CERO autorizaciones hoy → **Flota debe autorizarles vehículos antes/junto con esto**
-- (ficha del vehículo o la sección Choferes privados CJ12), o no podrán tomar ninguno.
--   node scripts/apply-migration.mjs sql/2026-10-08-cj11-privado-uso-vehiculo.sql --env dev

-- ── Helper: ¿el usuario es chofer privado? ───────────────────────────────────────
create or replace function sgc.es_chofer_privado(p_uid uuid default null)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = coalesce(p_uid, auth.uid()) and r.codigo = 'chofer_privado'
  );
$function$;
grant execute on function sgc.es_chofer_privado(uuid) to authenticated, service_role;

-- ── es_conductor_ampliado: reconoce al privado por rol (coherente con es_chofer) ──
create or replace function sgc.es_conductor_ampliado(p_uid uuid DEFAULT NULL::uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.conductores c where c.usuario_id = coalesce(p_uid, auth.uid())
  ) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = coalesce(p_uid, auth.uid()) and r.codigo in ('chofer_transportista','chofer_privado')
  ) or exists (
    select 1 from sgc.vehiculo_usos vu where vu.usuario_id = coalesce(p_uid, auth.uid())
  );
$function$;
grant execute on function sgc.es_conductor_ampliado(uuid) to authenticated, service_role;

-- ── iniciar_uso_vehiculo: el privado solo toma/recibe vehículos AUTORIZADOS ───────
-- (soltar_vehiculo NO se gatea: siempre debes poder soltar lo que tienes en mano, aunque
--  la autorización haya vencido — cadena de responsabilidad. estado_uso es solo lectura.)
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

  -- CJ11 — el chofer privado (que no es flota elevado ni admin) solo toma vehículos
  -- que Flota le autorizó.
  if sgc.es_chofer_privado(v_uid) and not (sgc.is_admin() or sgc.es_flota_elevado())
     and not sgc.autorizacion_vehiculo_vigente(p_vehiculo_id, v_uid) then
    raise exception 'Este vehículo no está autorizado para ti. Pídeselo a Flota.' using errcode = '42501';
  end if;

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
