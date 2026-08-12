-- AO6 — Flag "comparte ubicación" por ROL + override por USUARIO (pedido de Eduardo NG).
--
-- "La ubicación solo es a los chóferes y misael. Después a más nadie." (Eduardo NG, gerencia)
--
-- Modelo de dos capas (tri-estado real):
--   • Capa ROL  → `sgc.roles.comparte_ubicacion boolean` (matriz AG12). Default en el rol
--     chofer_transportista. Editable por admin en el editor de roles.
--   • Capa USUARIO → `sgc.usuario_flags` (override explícito por usuario). Presencia de fila
--     = override; su `valor` gana sobre el default del rol. Así se le asigna a Misael
--     (jefe_flota/logistica, NO chofer) SIN hardcodear su nombre en el código.
--
-- La verdad se resuelve en `sgc.comparte_ubicacion(uid)` (única fuente). La ingesta de
-- posiciones (`registrar_posiciones`) SOLO acepta de usuarios con el flag; los demás ni
-- escriben (server-side). La app (PROMPT-10) consulta `sgc.mi_comparte_ubicacion()` en el
-- onboarding de permisos para NO pedir ubicación a quien no la comparte.

set search_path = sgc, public;

-- ── Capa ROL ────────────────────────────────────────────────────────────────
alter table sgc.roles
  add column if not exists comparte_ubicacion boolean not null default false;

comment on column sgc.roles.comparte_ubicacion is
  'AO6: el rol comparte ubicación por defecto (choferes/transportistas). Override por usuario en sgc.usuario_flags.';

update sgc.roles set comparte_ubicacion = true where codigo = 'chofer_transportista';

-- ── Capa USUARIO (override genérico y reusable) ──────────────────────────────
create table if not exists sgc.usuario_flags (
  usuario_id   uuid   not null references sgc.usuarios(id) on delete cascade,
  flag         text   not null,
  valor        boolean not null,
  asignado_por uuid   references sgc.usuarios(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (usuario_id, flag)
);

comment on table sgc.usuario_flags is
  'AO6: overrides de capacidades por usuario (tri-estado). Ej: flag=comparte_ubicacion. Presencia de fila = override explícito del default por rol.';

alter table sgc.usuario_flags enable row level security;

drop policy if exists usuario_flags_read on sgc.usuario_flags;
create policy usuario_flags_read on sgc.usuario_flags for select to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_tecnologia());

-- Escritura SOLO por admin vía RPC SECURITY DEFINER (no policy de write directo).
grant select on sgc.usuario_flags to authenticated, service_role;

-- ── Fuente única de verdad ───────────────────────────────────────────────────
create or replace function sgc.comparte_ubicacion(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(
    -- 1) override explícito por usuario (gana siempre)
    (select uf.valor from sgc.usuario_flags uf
      where uf.usuario_id = p_uid and uf.flag = 'comparte_ubicacion'),
    -- 2) default por rol: alguno de sus roles comparte ubicación
    (select exists (
       select 1 from sgc.usuarios_roles ur
       join sgc.roles r on r.id = ur.rol_id
       where ur.usuario_id = p_uid and r.comparte_ubicacion = true)),
    false
  );
$function$;

comment on function sgc.comparte_ubicacion(uuid) is
  'AO6: ¿el usuario comparte ubicación? override por usuario (usuario_flags) > default por rol (roles.comparte_ubicacion).';

grant execute on function sgc.comparte_ubicacion(uuid) to authenticated, service_role;

-- Contrato para la app (onboarding de permisos, PROMPT-10): mi propio estado.
create or replace function sgc.mi_comparte_ubicacion()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select sgc.comparte_ubicacion(auth.uid());
$function$;

grant execute on function sgc.mi_comparte_ubicacion() to authenticated, service_role;

-- ── Gestión admin ────────────────────────────────────────────────────────────
-- Override por usuario (o borrarlo pasando p_valor = null → vuelve al default del rol).
create or replace function sgc.set_usuario_flag(p_uid uuid, p_flag text, p_valor boolean)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede cambiar flags de usuario'; end if;
  if p_flag is null or p_flag = '' then raise exception 'flag requerido'; end if;
  if p_valor is null then
    delete from sgc.usuario_flags where usuario_id = p_uid and flag = p_flag;
  else
    insert into sgc.usuario_flags (usuario_id, flag, valor, asignado_por)
    values (p_uid, p_flag, p_valor, auth.uid())
    on conflict (usuario_id, flag) do update
      set valor = excluded.valor, asignado_por = auth.uid(), updated_at = now();
  end if;
end;
$function$;

grant execute on function sgc.set_usuario_flag(uuid, text, boolean) to authenticated, service_role;

-- Toggle del default por rol (matriz AG12).
create or replace function sgc.set_rol_comparte_ubicacion(p_rol_id integer, p_valor boolean)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede cambiar el rol'; end if;
  update sgc.roles set comparte_ubicacion = coalesce(p_valor, false) where id = p_rol_id;
end;
$function$;

grant execute on function sgc.set_rol_comparte_ubicacion(integer, boolean) to authenticated, service_role;

-- Directorio de quién comparte ubicación (admin/flota) — para la UI y auditoría.
create or replace function sgc.usuarios_comparte_ubicacion()
returns table (usuario_id uuid, nombre text, email text, comparte boolean, motivo text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre, u.email,
         sgc.comparte_ubicacion(u.id) as comparte,
         case
           when (select uf.valor from sgc.usuario_flags uf where uf.usuario_id = u.id and uf.flag='comparte_ubicacion') is not null
             then 'override usuario'
           when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                        where ur.usuario_id=u.id and r.comparte_ubicacion=true)
             then 'por rol'
           else 'no comparte'
         end as motivo
  from sgc.usuarios u
  where u.activo = true
    and sgc.comparte_ubicacion(u.id) = true
  order by u.nombre;
$function$;

grant execute on function sgc.usuarios_comparte_ubicacion() to authenticated, service_role;

-- ── Asignar a Misael (por UUID real, NO por nombre en código) ────────────────
-- Misael Encarnacion (transporte@constructorasd.com) = jefe_flota/logistica, NO chofer.
insert into sgc.usuario_flags (usuario_id, flag, valor)
values ('ccd411b3-2bfc-49ef-a2e3-83406b89b2d7', 'comparte_ubicacion', true)
on conflict (usuario_id, flag) do update set valor = true, updated_at = now();

-- ── Gate de ingesta: SOLO quien comparte ubicación escribe posiciones ─────────
-- Reemplaza el guard AK13 (is_admin/tiene_modulo('flota')/es_conductor_ampliado) por el
-- flag AO6. Así Eduardo NG (gerencia) y otros NO-choferes ni siquiera pueden escribir.
create or replace function sgc.registrar_posiciones(p_posiciones jsonb)
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  it jsonb; v_n int := 0;
  v_last_cap timestamptz; v_last jsonb;
  v_prec_max numeric := coalesce((select valor from sgc.parametros where clave='gps_precision_max_m')::numeric, 100);
  v_vel_max  numeric := coalesce((select valor from sgc.parametros where clave='gps_velocidad_max_kmh')::numeric, 160);
  v_lat numeric; v_lng numeric; v_prec numeric; v_cap timestamptz; v_ruta uuid; v_veh uuid;
  v_plat numeric; v_plng numeric; v_pcap timestamptz; v_dist numeric; v_dt numeric; v_speed numeric;
  v_recibidos int := 0; v_desc_prec int := 0; v_desc_salto int := 0; v_desc_coord int := 0;
  v_ruta_log uuid; v_esp boolean := false; v_veh_prev uuid; v_esp_prev boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  -- AO6 — SOLO usuarios que comparten ubicación (choferes/transportistas + overrides).
  if not sgc.comparte_ubicacion(v_uid) then
    raise exception 'Sin permiso para registrar posición' using errcode = '42501';
  end if;

  select lat, lng, capturado_en into v_plat, v_plng, v_pcap
    from sgc.chofer_posiciones where usuario_id = v_uid
    order by capturado_en desc limit 1;

  for it in select * from jsonb_array_elements(coalesce(p_posiciones, '[]'::jsonb))
  loop
    v_recibidos := v_recibidos + 1;
    if (it->>'lat') is null or (it->>'lng') is null then v_desc_coord := v_desc_coord + 1; continue; end if;
    v_lat  := (it->>'lat')::numeric;
    v_lng  := (it->>'lng')::numeric;
    v_prec := nullif(it->>'precision','')::numeric;
    v_cap  := coalesce(nullif(it->>'capturado_en','')::timestamptz, now());
    v_ruta := nullif(it->>'ruta_id','')::uuid;
    v_veh  := nullif(it->>'vehiculo_id','')::uuid;
    if v_ruta is not null then v_ruta_log := v_ruta; end if;

    if v_prec is not null and v_prec > v_prec_max then v_desc_prec := v_desc_prec + 1; continue; end if;

    if v_plat is not null and v_pcap is not null and v_cap > v_pcap then
      v_dist  := sgc.haversine_km(v_plat, v_plng, v_lat, v_lng);
      v_dt    := extract(epoch from (v_cap - v_pcap)) / 3600.0;
      if v_dt > 0 then
        v_speed := v_dist / v_dt;
        if v_speed > v_vel_max then v_desc_salto := v_desc_salto + 1; continue; end if;
      end if;
    end if;

    if v_veh is distinct from v_veh_prev then
      v_esp_prev := coalesce((select v.es_prueba from sgc.vehiculos v where v.id = v_veh), false);
      v_veh_prev := v_veh;
    end if;
    v_esp := v_esp_prev;

    insert into sgc.chofer_posiciones (usuario_id, vehiculo_id, lat, lng, precision_m, bateria, capturado_en, ruta_id, es_prueba)
    values (v_uid, v_veh, v_lat, v_lng, v_prec, nullif(it->>'bateria','')::int, v_cap, v_ruta, v_esp);
    v_n := v_n + 1;
    v_plat := v_lat; v_plng := v_lng; v_pcap := v_cap;

    if v_last_cap is null or v_cap >= v_last_cap then v_last_cap := v_cap; v_last := it; end if;
  end loop;

  if v_last is not null then
    insert into sgc.chofer_ultima_posicion (usuario_id, vehiculo_id, lat, lng, precision_m, bateria, capturado_en, updated_at)
    values (v_uid, nullif(v_last->>'vehiculo_id','')::uuid,
            (v_last->>'lat')::numeric, (v_last->>'lng')::numeric,
            nullif(v_last->>'precision','')::numeric, nullif(v_last->>'bateria','')::int,
            v_last_cap, now())
    on conflict (usuario_id) do update
      set vehiculo_id = excluded.vehiculo_id, lat = excluded.lat, lng = excluded.lng,
          precision_m = excluded.precision_m, bateria = excluded.bateria,
          capturado_en = excluded.capturado_en, updated_at = now()
      where excluded.capturado_en >= sgc.chofer_ultima_posicion.capturado_en;
  end if;

  if v_recibidos > 0 then
    insert into sgc.gps_ingesta_log (usuario_id, ruta_id, recibidos, insertados, desc_precision, desc_salto, desc_sin_coord, es_prueba)
    values (v_uid, v_ruta_log, v_recibidos, v_n, v_desc_prec, v_desc_salto, v_desc_coord, v_esp);
  end if;

  return v_n;
end;
$function$;

grant execute on function sgc.registrar_posiciones(jsonb) to authenticated, service_role;
