-- AQ1 + AQ6 — Cobertura total de push + evento de versión publicada + deep-links a entidades
--
-- Contexto (auditoría de cobertura AF7): hoy SOLO sgc.notificar() (per-usuario)
-- hace espejo en push. Los helpers de broadcast (notificar_modulo/notificar_rol/
-- notificar_flota_elevado/notificar_todos) solo escriben la fila in-app → esos
-- eventos NO llegan al dispositivo cuando el usuario está fuera de la app.
-- Esta migración cierra la brecha SIN tocar los ~30 call-sites: se les añade el
-- espejo de push dentro del propio helper (mismo scope AK4/AF5, cero broadcast FCM:
-- send_push resuelve tokens por usuario y hace no-op si no hay token).
--
-- Además:
--  • notificaciones gana referencia_id / referencia_tipo → deep-link a la entidad
--    concreta (echada, conduce, ruta, aviso…). AF6 tipo→entidad.
--  • consumo anormal (AQ6): la notificación ahora lleva la echada → ruta
--    '/flota/combustible-log?echada=<id>' + referencia (id, 'echada').
--  • evento nuevo (AQ1): al publicar una versión móvil → push "Nueva actualización
--    disponible" SOLO a quienes les aplica (usuarios con token Android activo;
--    PWA/web excluidos por no tener token — AP8). Idempotente vía push_notificada_at.
--
-- Todo aditivo/retrocompatible. Se conservan las firmas 5/4-args existentes (para
-- no romper dependencias) y se añaden overloads con referencia donde hace falta.

-- ── A) notificaciones: columnas de referencia a entidad (deep-link AF6) ───────
alter table sgc.notificaciones
  add column if not exists referencia_id   uuid,
  add column if not exists referencia_tipo text;
comment on column sgc.notificaciones.referencia_id is
  'AQ6/AF6 — id de la entidad a la que apunta la notificación (echada, conduce, ruta, aviso…).';
comment on column sgc.notificaciones.referencia_tipo is
  'AQ6/AF6 — tipo de la entidad referenciada (echada|conduce|ruta|aviso|version|…).';

-- ── B) Espejo de push en los helpers de broadcast (cierra la brecha AQ1) ──────
-- notificar_modulo (5-args): ahora también empuja push a los destinatarios.
create or replace function sgc.notificar_modulo(
  p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u
    where u.activo and exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
        and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos))
    )
    returning usuario_id
  )
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(v_ids, p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end $$;
grant execute on function sgc.notificar_modulo(text,text,text,text,text) to service_role;

-- notificar_modulo (7-args): variante con referencia a entidad (deep-link).
create or replace function sgc.notificar_modulo(
  p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text,
  p_referencia_id uuid, p_referencia_tipo text
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_id, referencia_tipo)
    select u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta, p_referencia_id, p_referencia_tipo
    from sgc.usuarios u
    where u.activo and exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
        and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos))
    )
    returning usuario_id
  )
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(v_ids, p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta,
      'referencia_id', p_referencia_id, 'referencia_tipo', p_referencia_tipo));
end $$;
grant execute on function sgc.notificar_modulo(text,text,text,text,text,uuid,text) to service_role;

-- notificar_rol (5-args): ahora también empuja push.
create or replace function sgc.notificar_rol(
  p_rol text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select distinct u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where u.activo and r.codigo = p_rol
    returning usuario_id
  )
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(v_ids, p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end $$;
revoke execute on function sgc.notificar_rol(text,text,text,text,text) from authenticated;
grant  execute on function sgc.notificar_rol(text,text,text,text,text) to service_role;

-- notificar_flota_elevado (4-args): ahora también empuja push.
create or replace function sgc.notificar_flota_elevado(
  p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select distinct u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where u.activo and r.codigo in ('admin','direccion','gerencia','jefe_flota')
    returning usuario_id
  )
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(v_ids, p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end $$;
revoke execute on function sgc.notificar_flota_elevado(text,text,text,text) from authenticated;
grant  execute on function sgc.notificar_flota_elevado(text,text,text,text) to service_role;

-- notificar_todos (4-args): in-app a todos + push a quienes tengan token.
create or replace function sgc.notificar_todos(
  p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns integer
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_n integer; v_ids uuid[];
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede notificar a todos los usuarios.';
  end if;
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u where u.activo
    returning usuario_id
  )
  select array_agg(usuario_id), count(*) into v_ids, v_n from ins;
  perform sgc.send_push(v_ids, p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
  return coalesce(v_n,0);
end $$;
grant execute on function sgc.notificar_todos(text,text,text,text) to authenticated, service_role;

-- ── C) Evento nuevo: versión móvil publicada → push a usuarios con app (AQ1) ──
alter table sgc.app_versiones
  add column if not exists push_notificada_at timestamptz;
comment on column sgc.app_versiones.push_notificada_at is
  'AQ1 — cuándo se disparó la push "Nueva actualización disponible" (idempotencia del trigger).';

create or replace function sgc.trg_app_version_push()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_ids uuid[]; v_titulo text; v_msg text;
begin
  -- Solo versiones MÓVILES publicadas, una sola vez.
  if coalesce(new.plataforma,'') <> 'movil' then return new; end if;
  if not coalesce(new.publicada,false) then return new; end if;
  if new.push_notificada_at is not null then return new; end if;

  v_titulo := 'Nueva actualización disponible';
  v_msg := coalesce(nullif(new.titulo,''), 'Versión ' || new.version) || ' — toca para actualizar.';

  -- "A quienes les aplica" = usuarios con token Android activo (PWA/web no tienen token → AP8).
  select array_agg(distinct dt.usuario_id) into v_ids
  from sgc.device_tokens dt where dt.activo and dt.plataforma = 'android';

  if v_ids is not null and array_length(v_ids,1) > 0 then
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_tipo)
    select unnest(v_ids), 'version_publicada', v_titulo, v_msg, null, 'version';
    perform sgc.send_push(v_ids, v_titulo, v_msg,
      jsonb_build_object('tipo','version_publicada','ruta','/actualizar',
                         'referencia_tipo','version','version', new.version));
  end if;

  new.push_notificada_at := now();
  return new;
end $$;

drop trigger if exists app_version_push on sgc.app_versiones;
create trigger app_version_push
  before insert or update on sgc.app_versiones
  for each row execute function sgc.trg_app_version_push();

-- ── D) consumo anormal → deep-link a LA echada (AQ6) ──────────────────────────
-- Se recrea registrar_combustible_app (patrón del módulo: cada ronda la recrea)
-- cambiando SOLO el bloque de notificación de consumo anormal para:
--   • tipo 'consumo_anormal' (mapa AF6), • ruta al detalle de la echada,
--   • referencia (id de la echada, 'echada') → acción "Ver echada".
-- (El cuerpo completo se inserta a continuación, byte-exacto desde prod.)

CREATE OR REPLACE FUNCTION sgc.registrar_combustible_app(p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date, p_kilometraje integer, p_galones numeric, p_monto numeric, p_estacion text DEFAULT NULL::text, p_foto_recibo_path text DEFAULT NULL::text, p_foto_tablero_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_foto_bomba_path text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_tarjeta text DEFAULT NULL::text, p_titular text DEFAULT NULL::text, p_titular_es_persona boolean DEFAULT false, p_subtipo text DEFAULT NULL::text, p_origen text DEFAULT 'estacion'::text, p_proyecto_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_id           uuid;
  v_odometro     int;
  v_km_anterior  int;
  v_km_recorridos int;
  v_precio       numeric;
  v_rendimiento  numeric;
  v_costo_km     numeric;
  v_prom         numeric;
  v_n_prev       int;
  v_esperado     numeric;
  v_prom_flota   numeric;
  v_ref_valor    numeric;
  v_ref_tipo     text;
  v_alerta       boolean := false;
  v_motivo       text;
  v_estado       text;
  v_baseline     numeric;
  v_dist_min     numeric;
  v_piso_c       numeric;
  v_techo_c      numeric;
  v_min_reg      int;
  v_placa        text;
  v_es_prueba    boolean := false;
  v_medida       text := 'km';
  v_uni          text := 'km';
  v_ren          text := 'km/gal';
  v_origen       text := lower(coalesce(nullif(p_origen,''),'estacion'));
  v_deposito     boolean;
  v_persona      boolean := coalesce(p_titular_es_persona, false) or p_vehiculo_id is null;
  -- AF18/AF19
  v_asignado     uuid;
  v_umbral_km    numeric;
  v_km_alerta    boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el mÃ³dulo Flota';
  end if;

  if v_origen not in ('estacion','deposito_obra') then v_origen := 'estacion'; end if;
  v_deposito := (v_origen = 'deposito_obra');
  if v_deposito then v_persona := false; end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if not v_deposito and coalesce(p_monto, 0) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'VehÃ­culo no encontrado o inactivo';
    end if;

    -- AF18 â€” sÃ³lo el usuario asignado registra en su vehÃ­culo (bypass admin).
    -- Sin asignado: cualquiera con permiso (el gate de arriba ya se validÃ³) puede,
    -- y queda registrado en registrado_por.
    if not sgc.is_admin() then
      select coalesce(a.usuario_id, c.usuario_id)
        into v_asignado
        from sgc.vehiculo_asignaciones a
        left join sgc.conductores c on c.id = a.conductor_id
       where a.vehiculo_id = p_vehiculo_id and a.activa
       order by a.desde desc nulls last
       limit 1;
      if v_asignado is null then
        select responsable_id into v_asignado from sgc.vehiculos where id = p_vehiculo_id;
      end if;
      if v_asignado is not null and v_asignado <> v_uid then
        raise exception 'Solo el usuario asignado a este vehÃ­culo puede registrar su combustible.'
          using errcode = '42501';
      end if;
    end if;

    select coalesce(es_prueba, false), coalesce(kilometraje, 0), coalesce(medida_uso, 'km')
      into v_es_prueba, v_odometro, v_medida
      from sgc.vehiculos where id = p_vehiculo_id;
    v_uni := case when v_medida = 'horas' then 'h' else 'km' end;
    v_ren := case when v_medida = 'horas' then 'h/gal' else 'km/gal' end;

    if coalesce(p_kilometraje, 0) <= 0 then
      raise exception 'La lectura (%) debe ser mayor que 0', v_uni;
    end if;
    if p_kilometraje < v_odometro then
      raise exception 'La lectura (% %) no puede ser menor a la lectura actual del vehÃ­culo (% %).',
        p_kilometraje, v_uni, v_odometro, v_uni using errcode = '23514';
    end if;

    -- La echada anterior se busca en el MISMO contexto es_prueba del vehÃ­culo.
    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba;

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        if coalesce(p_monto,0) > 0 then v_costo_km := round(p_monto / v_km_recorridos, 2); end if;
      end if;

      -- AF19 â€” umbral de salto de km entre echadas (sÃ³lo vehÃ­culos por km).
      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          if sgc.is_admin() then
            v_km_alerta := true;  -- admin puede forzar; queda marcado para revisiÃ³n
          else
            raise exception 'El salto de kilometraje (% km desde la Ãºltima echada) supera el mÃ¡ximo permitido (% km). Verifica la lectura del odÃ³metro.',
              v_km_recorridos, v_umbral_km using errcode = '23514';
          end if;
        end if;
      end if;
    end if;

    if v_medida = 'horas' then
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_horas'), 3);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_min_horas_gal'), 0.05);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_max_horas_gal'), 1.0);
    else
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_km'), 50);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
    end if;
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);

    select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

    select count(*), avg(rendimiento_km_gal) into v_n_prev, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    select avg(rendimiento_km_gal) into v_prom_flota
      from sgc.registros_combustible
     where rendimiento_km_gal is not null and coalesce(es_prueba, false) = v_es_prueba
       and km_recorridos >= v_dist_min;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n_prev >= v_min_reg then v_prom else null end;
    v_ref_tipo := case when v_esperado is not null and v_esperado > 0 then 'esperado'
                       when v_n_prev >= v_min_reg then 'propio' else null end;
    v_ref_valor := v_baseline;

    select estado, motivo into v_estado, v_motivo
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true);
    v_alerta := (v_estado = 'anormal');
  end if;

  v_precio := case when coalesce(p_galones,0) > 0 and coalesce(p_monto,0) > 0
                   then round(p_monto / p_galones, 2) else null end;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, foto_bomba_path,
    alerta_consumo, motivo_alerta, estado, client_uuid,
    producto, subtipo, tarjeta, titular, titular_es_persona,
    origen, proyecto_id, registrado_por, km_alerta
  ) values (
    v_id,
    case when v_persona then null else p_vehiculo_id end,
    p_conductor_id, coalesce(p_fecha, current_date),
    case when v_persona then null else p_kilometraje end,
    p_galones, nullif(p_monto, 0), v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    case when v_deposito then null else nullif(p_estacion,'') end,
    nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), nullif(p_foto_bomba_path,''),
    v_alerta, v_motivo, v_estado, p_client_uuid,
    nullif(p_producto,''), nullif(p_subtipo,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false),
    v_origen, p_proyecto_id, v_uid, v_km_alerta
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

    if v_alerta and not v_es_prueba then
      select placa into v_placa from sgc.vehiculos where id = p_vehiculo_id;
      insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
      values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
        format('Consumo anormal en %s: %s Posible fuga, problema mecÃ¡nico o combustible desviado.',
          coalesce(v_placa,'vehÃ­culo'), v_motivo),
        'alta');
      perform sgc.notificar_modulo('flota', 'consumo_anormal',
        'Consumo anormal de combustible',
        format('%s: %s', coalesce(v_placa,'Un vehÃ­culo'), v_motivo),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'precio_por_galon', v_precio,
    'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos,
    'rendimiento_km_gal', v_rendimiento,
    'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'estado', v_estado,
    'motivo_alerta', v_motivo,
    'km_alerta', v_km_alerta,
    'promedio_rendimiento', case when v_n_prev >= v_min_reg then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro,
    'medida_uso', v_medida,
    'titular_es_persona', v_persona,
    'origen', v_origen
  );
end;
$function$;

grant execute on function sgc.registrar_combustible_app(uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text, text, text, text, boolean, text, text, uuid) to authenticated, service_role;
