-- BV1 (auditoría, extiende F7) — la echada retroactiva deja rastro: columna `retroactiva`
-- + `permiso_id` que la autorizó (y marca `ultimo_uso` del permiso). Avisa a flota-elevado
-- cuando se usa, y al chofer cuando se le otorga. Chip RETROACTIVA en el Registro de echadas.
-- Los imports/conciliación (importada=true) no se marcan retroactivos.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv1b-echada-retro-auditoria.sql --env dev  →  --env prod
begin;

alter table sgc.registros_combustible
  add column if not exists retroactiva boolean not null default false,
  add column if not exists permiso_id uuid references sgc.combustible_permisos_retro(id);
alter table sgc.combustible_permisos_retro
  add column if not exists ultimo_uso timestamptz;

-- BEFORE INSERT — marca la echada como retroactiva y la liga al permiso vigente.
create or replace function sgc.tg_combustible_marca_retroactiva()
 returns trigger language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $fn$
declare v_pid uuid;
begin
  if NEW.fecha < current_date and coalesce(NEW.importada, false) = false then
    NEW.retroactiva := true;
    select pr.id into v_pid from sgc.combustible_permisos_retro pr
      where pr.usuario_id = coalesce(NEW.registrado_por, auth.uid())
        and pr.activo and pr.vence >= current_date
        and NEW.fecha >= current_date - pr.dias_max
      order by pr.created_at desc limit 1;
    NEW.permiso_id := v_pid;
    if v_pid is not null then
      update sgc.combustible_permisos_retro set ultimo_uso = now() where id = v_pid;
    end if;
  end if;
  return NEW;
end $fn$;
drop trigger if exists trg_combustible_marca_retroactiva on sgc.registros_combustible;
create trigger trg_combustible_marca_retroactiva
  before insert on sgc.registros_combustible
  for each row execute function sgc.tg_combustible_marca_retroactiva();

-- AFTER INSERT — avisa a flota-elevado que se registró una echada con fecha pasada.
create or replace function sgc.tg_combustible_avisa_retroactiva()
 returns trigger language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $fn$
declare v_quien text;
begin
  if NEW.retroactiva and coalesce(NEW.importada, false) = false then
    select nombre into v_quien from sgc.usuarios where id = coalesce(NEW.registrado_por, auth.uid());
    perform sgc.notificar_flota_elevado(
      'combustible_retro_usada',
      'Echada retroactiva registrada',
      coalesce(v_quien, 'Un usuario') || ' registró una echada con fecha ' || to_char(NEW.fecha, 'DD/MM/YYYY') || '.',
      '/flota/combustible-log');
  end if;
  return NEW;
end $fn$;
drop trigger if exists trg_combustible_avisa_retroactiva on sgc.registros_combustible;
create trigger trg_combustible_avisa_retroactiva
  after insert on sgc.registros_combustible
  for each row execute function sgc.tg_combustible_avisa_retroactiva();

-- Otorgar permiso: además de crear el permiso, avisa al chofer que ya puede registrar.
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
  update sgc.combustible_permisos_retro set activo = false where usuario_id = p_usuario_id and activo;
  insert into sgc.combustible_permisos_retro (usuario_id, dias_max, vence, motivo, otorgado_por)
  values (p_usuario_id, coalesce(p_dias_max, 7), p_vence, nullif(btrim(p_motivo),''), auth.uid())
  returning id into v_id;
  perform sgc.notificar(
    p_usuario_id, 'combustible_retro_permitida',
    'Puedes registrar echadas con fecha pasada',
    'Se te autorizó registrar echadas de combustible retroactivas (hasta ' || coalesce(p_dias_max, 7) ||
      ' días atrás) hasta el ' || to_char(p_vence, 'DD/MM/YYYY') || '.',
    '/flota/combustible');
  return v_id;
end $function$;

-- Registro de echadas: expone `retroactiva` para pintar el chip.
drop function if exists sgc.log_combustible(date, date, uuid, uuid);
create or replace function sgc.log_combustible(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_vehiculo_id uuid DEFAULT NULL::uuid, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, fecha date, vehiculo_id uuid, placa text, kilometraje integer, km_anterior integer, km_recorridos integer, galones numeric, monto numeric, producto text, subtipo text, estado text, km_alerta boolean, sin_asignacion boolean, alerta_consumo boolean, registrado_por uuid, registrado_nombre text, conductor_nombre text, es_prueba boolean, created_at timestamp with time zone, importada boolean, km_pendiente boolean, retroactiva boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'sgc', 'pg_temp'
as $function$
  select
    r.id, r.fecha, r.vehiculo_id, v.placa, r.kilometraje, r.km_anterior, r.km_recorridos,
    r.galones, r.monto, r.producto, r.subtipo, r.estado,
    coalesce(r.km_alerta, false), coalesce(r.sin_asignacion, false), coalesce(r.alerta_consumo, false),
    r.registrado_por, u.nombre, c.nombre, coalesce(r.es_prueba, false), r.created_at,
    coalesce(r.importada, false), coalesce(r.km_pendiente, false), coalesce(r.retroactiva, false)
  from sgc.registros_combustible r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  left join sgc.usuarios u on u.id = r.registrado_por
  left join sgc.conductores c on c.id = r.conductor_id
  where (sgc.is_admin() or sgc.es_flota_elevado())
    and (p_desde is null or r.fecha >= p_desde)
    and (p_hasta is null or r.fecha <= p_hasta)
    and (p_vehiculo_id is null or r.vehiculo_id = p_vehiculo_id)
    and (p_usuario_id is null or r.registrado_por = p_usuario_id)
    and (not coalesce(r.es_prueba, false) or sgc.is_admin())
  order by r.fecha desc, r.created_at desc;
$function$;
grant execute on function sgc.log_combustible(date, date, uuid, uuid) to authenticated, service_role;

commit;
