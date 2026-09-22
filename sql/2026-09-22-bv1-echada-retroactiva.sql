-- BV1 — Echada retroactiva CON PERMISO. Por defecto una echada se registra con fecha de
-- hoy; una fecha pasada exige un permiso vigente que Flota otorga a un usuario (con tope de
-- días hacia atrás y vencimiento). flota-elevado/admin no lo necesitan. La fecha futura
-- nunca se permite. El guard vive en registrar_combustible_app (la puerta de la app); los
-- imports/conciliación entran por otra vía y no se ven afectados.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv1-echada-retroactiva.sql --env dev  →  --env prod
begin;

-- Permiso de registro retroactivo por usuario (tope de días atrás + vencimiento).
create table if not exists sgc.combustible_permisos_retro (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references sgc.usuarios(id) on delete cascade,
  dias_max     integer not null default 7 check (dias_max between 1 and 90),
  vence        date not null,
  motivo       text,
  otorgado_por uuid references sgc.usuarios(id),
  activo       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_comb_retro_usuario on sgc.combustible_permisos_retro(usuario_id) where activo;

alter table sgc.combustible_permisos_retro enable row level security;
drop policy if exists comb_retro_sel on sgc.combustible_permisos_retro;
create policy comb_retro_sel on sgc.combustible_permisos_retro for select to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin() or sgc.es_flota_elevado());
grant select on sgc.combustible_permisos_retro to authenticated;
grant all on sgc.combustible_permisos_retro to service_role;

-- ¿Puede el usuario registrar una echada con esta fecha pasada?
create or replace function sgc.puede_registrar_combustible_retro(p_uid uuid, p_fecha date)
 returns boolean language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select
    sgc.is_admin() or sgc.es_flota_elevado()
    or exists (
      select 1 from sgc.combustible_permisos_retro pr
      where pr.usuario_id = p_uid
        and pr.activo
        and pr.vence >= current_date
        and p_fecha >= current_date - pr.dias_max
    );
$function$;
grant execute on function sgc.puede_registrar_combustible_retro(uuid, date) to authenticated, service_role;

-- Otorgar / revocar / listar (solo flota-elevado/admin).
create or replace function sgc.otorgar_permiso_combustible_retro(p_usuario_id uuid, p_dias_max integer, p_vence date, p_motivo text default null)
 returns uuid language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo Flota puede otorgar permisos de registro retroactivo.' using errcode = '42501';
  end if;
  if p_usuario_id is null then raise exception 'Indica el usuario.' using errcode = '22023'; end if;
  if coalesce(p_vence, current_date - 1) < current_date then
    raise exception 'El vencimiento debe ser hoy o futuro.' using errcode = '22023';
  end if;
  -- Revoca permisos vigentes previos del mismo usuario (uno activo a la vez).
  update sgc.combustible_permisos_retro set activo = false where usuario_id = p_usuario_id and activo;
  insert into sgc.combustible_permisos_retro (usuario_id, dias_max, vence, motivo, otorgado_por)
  values (p_usuario_id, coalesce(p_dias_max, 7), p_vence, nullif(btrim(p_motivo),''), auth.uid())
  returning id into v_id;
  return v_id;
end $function$;
grant execute on function sgc.otorgar_permiso_combustible_retro(uuid, integer, date, text) to authenticated, service_role;

create or replace function sgc.revocar_permiso_combustible_retro(p_id uuid)
 returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo Flota puede revocar permisos de registro retroactivo.' using errcode = '42501';
  end if;
  update sgc.combustible_permisos_retro set activo = false where id = p_id;
  if not found then raise exception 'Permiso no encontrado.' using errcode = '22023'; end if;
end $function$;
grant execute on function sgc.revocar_permiso_combustible_retro(uuid) to authenticated, service_role;

create or replace function sgc.permisos_combustible_retro_listar(p_solo_activos boolean default true)
 returns table(id uuid, usuario_id uuid, usuario text, dias_max integer, vence date, motivo text, otorgado_por_nombre text, activo boolean, vigente boolean, created_at timestamptz)
 language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select pr.id, pr.usuario_id, u.nombre, pr.dias_max, pr.vence, pr.motivo,
         og.nombre, pr.activo, (pr.activo and pr.vence >= current_date) as vigente, pr.created_at
  from sgc.combustible_permisos_retro pr
  join sgc.usuarios u on u.id = pr.usuario_id
  left join sgc.usuarios og on og.id = pr.otorgado_por
  where sgc.is_admin() or sgc.es_flota_elevado()
  order by (pr.activo and pr.vence >= current_date) desc, pr.created_at desc;
$function$;
grant execute on function sgc.permisos_combustible_retro_listar(boolean) to authenticated, service_role;

commit;

-- ── Guard en la puerta de la app ────────────────────────────────────────────
begin;
CREATE OR REPLACE FUNCTION sgc.registrar_combustible_app(p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date, p_kilometraje integer, p_galones numeric, p_monto numeric, p_estacion text DEFAULT NULL::text, p_foto_recibo_path text DEFAULT NULL::text, p_foto_tablero_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_foto_bomba_path text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_tarjeta text DEFAULT NULL::text, p_titular text DEFAULT NULL::text, p_titular_es_persona boolean DEFAULT false, p_subtipo text DEFAULT NULL::text, p_origen text DEFAULT 'estacion'::text, p_proyecto_id uuid DEFAULT NULL::uuid, p_confirmado boolean DEFAULT false)
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
  v_direccion    text;
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
  v_asignado     uuid;
  v_umbral_km    numeric;
  v_km_alerta    boolean := false;
  v_sin_asignacion boolean := false;   -- BR1
  v_km_base      int;                   -- BR1
  v_elevado_conf boolean;               -- BR1
  -- AW3
  v_cap          numeric;
  v_margen_bloq  numeric;
  v_margen_al    numeric;
  v_precio_calc  numeric;
  v_precio_min   numeric;
  v_precio_max   numeric;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- BV1 — la fecha de la echada no puede ser futura, y una fecha PASADA (retroactiva)
  -- solo se permite con un permiso vigente (o si el usuario es flota-elevado/admin).
  if coalesce(p_fecha, current_date) > current_date then
    raise exception 'La fecha de la echada no puede ser futura.'
      using errcode = '22023', detail = 'campo=fecha;motivo=futura';
  end if;
  if coalesce(p_fecha, current_date) < current_date
     and not sgc.puede_registrar_combustible_retro(v_uid, coalesce(p_fecha, current_date)) then
    raise exception 'No puedes registrar una echada con fecha pasada (%). Pide a Flota un permiso de registro retroactivo.', p_fecha
      using errcode = '22023', detail = 'campo=fecha;motivo=retroactiva_sin_permiso';
  end if;

  v_elevado_conf := sgc.es_flota_elevado() and coalesce(p_confirmado, false);  -- BR1

  if v_origen not in ('estacion','deposito_obra') then v_origen := 'estacion'; end if;
  v_deposito := (v_origen = 'deposito_obra');
  if v_deposito then v_persona := false; end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  -- BQ7 — Blindaje del conductor_id (corolario regla 13/14).
  if p_conductor_id is not null
     and not exists (select 1 from sgc.conductores c where c.id = p_conductor_id) then
    raise notice 'registrar_combustible_app: conductor_id % del payload no existe (fusionado/borrado) — ignorado, se resuelve por uid', p_conductor_id;
    p_conductor_id := null;
  end if;
  if p_conductor_id is null then
    select c.id into p_conductor_id from sgc.conductores c where c.usuario_id = v_uid limit 1;
  end if;
  if p_conductor_id is null and p_vehiculo_id is not null then
    select a.conductor_id into p_conductor_id
      from sgc.vehiculo_asignaciones a
     where a.vehiculo_id = p_vehiculo_id and a.activa
     order by a.desde desc nulls last
     limit 1;
  end if;

  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if not v_deposito and coalesce(p_monto, 0) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  -- AW3 — TOPE DURO de galones (integridad).  BR1: un flota-elevado con p_confirmado
  -- lo pasa (regla 15: el rechazo duro es lo físicamente imposible, y el elevado
  -- puede confirmar que sí fue así).
  v_margen_bloq := coalesce((select valor from sgc.flota_config where clave='tanque_margen_bloqueo'), 1.15);
  v_margen_al   := coalesce((select valor from sgc.flota_config where clave='tanque_margen_alerta'), 0.85);
  if v_persona then
    v_cap := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
  else
    v_cap := sgc.cap_tanque_vehiculo(p_vehiculo_id);
  end if;
  if v_cap is not null and v_cap > 0 and p_galones > v_cap * v_margen_bloq
     and not v_elevado_conf then
    perform sgc.error_campo('galones', 'supera_capacidad',
      format('La cantidad de galones (%s) supera la capacidad estimada del %s (~%s gal). Verifica el valor — ¿sobró un punto o coma? Si es correcto, pídele a Logística (Raykler) que la registre.',
        round(p_galones,2),
        case when v_persona then 'depósito' else 'tanque de este vehículo' end,
        round(v_cap,0)));
  end if;

  -- AW3 — banda de precio por galón.  BR1: elevado+confirmado la pasa.
  if coalesce(p_monto,0) > 0 and p_galones > 0 then
    v_precio_calc := p_monto / p_galones;
    v_precio_min  := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
    v_precio_max  := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
    if (v_precio_calc < v_precio_min or v_precio_calc > v_precio_max) and not v_elevado_conf then
      perform sgc.error_campo('monto', 'precio_fuera_banda',
        format('El precio por galón resultante (RD$%s) está fuera de la banda plausible (RD$%s–RD$%s). Revisa los galones y el monto. Si es correcto, pídele a Logística (Raykler) que la registre.',
          round(v_precio_calc,2), round(v_precio_min,0), round(v_precio_max,0)));
    end if;
  end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;

    -- AF18 — solo el usuario asignado registra en su vehículo (BO4: bypass a flota
    -- elevado; BQ7b: une uso-v2).  BR1 (regla 15): si aun así no coincide, ya NO
    -- rechaza — se acepta con bandera sin_asignacion y se avisa a logística.
    if not sgc.es_flota_elevado() then
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
      if v_asignado is not null and v_asignado <> v_uid
         and not exists (
           select 1 from sgc.vehiculo_usos u
            where u.vehiculo_id = p_vehiculo_id and u.usuario_id = v_uid and u.fin_at is null
         ) then
        v_sin_asignacion := true;   -- BR1: antes era raise ... using errcode='DR481'
      end if;
    end if;

    select coalesce(es_prueba, false), coalesce(kilometraje, 0), coalesce(medida_uso, 'km'), placa
      into v_es_prueba, v_odometro, v_medida, v_placa
      from sgc.vehiculos where id = p_vehiculo_id;
    v_uni := case when v_medida = 'horas' then 'h' else 'km' end;
    v_ren := case when v_medida = 'horas' then 'h/gal' else 'km/gal' end;

    if coalesce(p_kilometraje, 0) <= 0 then
      raise exception 'La lectura (%) debe ser mayor que 0', v_uni;
    end if;
    if p_kilometraje < v_odometro then
      perform sgc.error_campo('kilometraje', 'menor_que_actual',
        format('La lectura (%s %s) no puede ser menor a la lectura actual del vehículo (%s %s).',
          p_kilometraje, v_uni, v_odometro, v_uni));
    end if;

    -- La echada anterior (excluye invalidadas para no arrastrar km corruptos).
    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false);

    -- BR1 — km base editable por admin: reinicia el punto de medición del salto sin
    -- tocar las echadas históricas.  Solo en el contexto real (no es_prueba).
    if not v_es_prueba then
      select km_base_combustible into v_km_base from sgc.vehiculos where id = p_vehiculo_id;
      if v_km_base is not null then
        v_km_anterior := greatest(coalesce(v_km_anterior, 0), v_km_base);
      end if;
    end if;

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        if coalesce(p_monto,0) > 0 then v_costo_km := round(p_monto / v_km_recorridos, 2); end if;
      end if;

      -- AF19 — salto de km entre echadas.  BR1 (regla 15): ya NO rechaza a nadie —
      -- se acepta con bandera km_alerta y se avisa a logística (Raykler sanea).
      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          v_km_alerta := true;
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
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    select avg(rendimiento_km_gal) into v_prom_flota
      from sgc.registros_combustible
     where rendimiento_km_gal is not null and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n_prev >= v_min_reg then v_prom else null end;
    v_ref_tipo := case when v_esperado is not null and v_esperado > 0 then 'esperado'
                       when v_n_prev >= v_min_reg then 'propio' else null end;
    v_ref_valor := v_baseline;

    select estado, motivo, direccion into v_estado, v_motivo, v_direccion
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true);
    v_alerta := (v_estado = 'anormal');
  end if;

  -- AW3 — confirmación de valores inusuales (soft).
  if not coalesce(p_confirmado, false)
     and v_cap is not null and v_cap > 0
     and p_galones > v_cap * v_margen_al then
    return jsonb_build_object(
      'needs_confirm', true,
      'confirm_message', format('%s galones es más de lo habitual para %s (tanque ≈ %s gal). ¿Confirmas la cantidad?',
        trim(to_char(p_galones,'FM999990.00')),
        coalesce(v_placa, 'este destino'), round(v_cap,0)),
      'cap', v_cap, 'galones', p_galones);
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
    origen, proyecto_id, registrado_por, km_alerta, sin_asignacion
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
    v_origen, p_proyecto_id, v_uid, v_km_alerta, v_sin_asignacion
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

    -- AW2 — aviso de consumo anormal (con dirección).
    if v_alerta and not v_es_prueba then
      if v_direccion = 'alto' then
        insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
        values ('revisar_lectura', p_vehiculo_id, p_conductor_id, v_id,
          format('Posible error de lectura en %s: %s No es falla mecánica: verifica el odómetro y los galones.',
            coalesce(v_placa,'vehículo'), v_motivo),
          'media');
        perform sgc.notificar(v_uid, 'revisar_lectura', 'Revisa la lectura de tu echada',
          format('%s: %s', coalesce(v_placa,'Vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text);
        perform sgc.notificar_flota_elevado('revisar_lectura',
          'Echada con rendimiento inusualmente alto',
          format('%s: %s Revisar la lectura (no es ticket de mantenimiento).', coalesce(v_placa,'Un vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text);
      else
        insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
        values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
          format('Consumo anormal en %s: %s Posible fuga, problema mecánico o combustible desviado.',
            coalesce(v_placa,'vehículo'), v_motivo),
          'alta');
        perform sgc.notificar_modulo('flota', 'consumo_anormal',
          'Consumo anormal de combustible',
          format('%s: %s', coalesce(v_placa,'Un vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
      end if;
    end if;

    -- BR1 — banderas de revisión (regla 15): se avisa a logística sin bloquear.
    if v_km_alerta and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'km_salto',
        'Salto de kilometraje en una echada',
        format('%s: salto de %s km desde la última echada. Revisar/sanear.', coalesce(v_placa,'Un vehículo'), v_km_recorridos),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
    end if;
    if v_sin_asignacion and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'combustible_revisar',
        'Echada sin asignación',
        format('%s: echada registrada por %s sin ser el asignado del vehículo. Revisar.',
          coalesce(v_placa,'Un vehículo'),
          coalesce((select nombre from sgc.usuarios where id = v_uid), 'un usuario')),
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
    'direccion_alerta', v_direccion,
    'km_alerta', v_km_alerta,
    'sin_asignacion', v_sin_asignacion,
    'aviso', case when v_sin_asignacion or v_km_alerta
                  then 'Registrado. Logística (Raykler) lo revisará.' else null end,
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

commit;
