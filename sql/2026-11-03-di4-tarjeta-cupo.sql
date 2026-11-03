-- sql/2026-11-03-di4-tarjeta-cupo.sql — Ronda DI (PROMPT-134 F6, DI4)
-- Cupo opcional por tarjeta de combustible + solicitud manual del chofer cuando
-- la tarjeta llega al límite (decisión de Xaviel: "Solicitud manual + cupo
-- opcional por tarjeta"). Aditivo.
-- node scripts/apply-migration.mjs sql/2026-11-03-di4-tarjeta-cupo.sql --env dev

-- ── 1) Cupo opcional en el mapa de tarjetas ────────────────────────────────────
alter table sgc.combustible_tarjeta_map
  add column if not exists cupo_gal numeric,
  add column if not exists cupo_monto numeric,
  add column if not exists cupo_dia_corte smallint check (cupo_dia_corte is null or cupo_dia_corte between 1 and 31);

comment on column sgc.combustible_tarjeta_map.cupo_gal is 'DI4 — cupo en galones por período (opcional, lo anota Flota). Sin cupo = sin barra ni alertas.';
comment on column sgc.combustible_tarjeta_map.cupo_monto is 'DI4 — cupo en RD$ por período (opcional).';
comment on column sgc.combustible_tarjeta_map.cupo_dia_corte is 'DI4 — día del mes (1-31) en que corta el período de la tarjeta. Null = mes calendario.';

-- ── 2) Solicitudes de cupo ──────────────────────────────────────────────────────
create table if not exists sgc.combustible_solicitudes_cupo (
  id uuid primary key default gen_random_uuid(),
  codigo_tarjeta text not null,
  vehiculo_id uuid references sgc.vehiculos(id),
  solicitante_id uuid not null references sgc.usuarios(id),
  galones_pedidos numeric check (galones_pedidos is null or galones_pedidos > 0),
  monto_pedido numeric check (monto_pedido is null or monto_pedido > 0),
  motivo text not null check (motivo in ('llego_limite', 'bomba_rechazo', 'pocos_galones', 'otro')),
  nota text,
  foto_rechazo_path text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'ampliada', 'rechazada', 'cancelada')),
  respuesta text,
  nuevo_cupo_gal numeric,
  nuevo_cupo_monto numeric,
  atendida_por uuid references sgc.usuarios(id),
  atendida_at timestamptz,
  es_prueba boolean not null default false,
  created_at timestamptz not null default now()
);
-- DI4 — antiduplicado: una pendiente por tarjeta y chofer (reenviar devuelve la existente).
create unique index if not exists uq_cupo_pendiente_tarjeta_chofer
  on sgc.combustible_solicitudes_cupo (codigo_tarjeta, solicitante_id) where estado = 'pendiente';
create index if not exists idx_cupo_solicitudes_estado on sgc.combustible_solicitudes_cupo (estado, created_at desc);

alter table sgc.combustible_solicitudes_cupo enable row level security;
drop policy if exists "cupo_solicitudes: ver" on sgc.combustible_solicitudes_cupo;
create policy "cupo_solicitudes: ver" on sgc.combustible_solicitudes_cupo
  for select to authenticated using (solicitante_id = auth.uid() or sgc.es_flota_elevado());
grant select on sgc.combustible_solicitudes_cupo to authenticated;
grant select, insert, update, delete on sgc.combustible_solicitudes_cupo to service_role;

-- ── 3) Alertas de cupo (idempotentes por tarjeta+período+umbral) ──────────────
create table if not exists sgc.combustible_tarjeta_alertas (
  id uuid primary key default gen_random_uuid(),
  codigo_tarjeta text not null,
  periodo text not null,
  umbral smallint not null check (umbral in (80, 100)),
  created_at timestamptz not null default now(),
  unique (codigo_tarjeta, periodo, umbral)
);
alter table sgc.combustible_tarjeta_alertas enable row level security;
drop policy if exists "cupo_alertas: ver" on sgc.combustible_tarjeta_alertas;
create policy "cupo_alertas: ver" on sgc.combustible_tarjeta_alertas
  for select to authenticated using (sgc.es_flota_elevado());
grant select on sgc.combustible_tarjeta_alertas to authenticated;
grant select, insert, update, delete on sgc.combustible_tarjeta_alertas to service_role;

-- ── 4) notif_tipo nuevos ───────────────────────────────────────────────────────
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden) values
  ('tarjeta_cupo_solicitud', 'Solicitud de cupo de tarjeta',
   'Un chofer pidió más cupo en su tarjeta de combustible.', true, array['in_app','push'], true,
   (select coalesce(max(orden), 0) + 1 from sgc.notif_tipo)),
  ('tarjeta_cupo_respuesta', 'Respuesta a solicitud de cupo',
   'Flota respondió una solicitud de cupo de tarjeta.', true, array['in_app','push'], true,
   (select coalesce(max(orden), 0) + 2 from sgc.notif_tipo)),
  ('tarjeta_cupo_alerta', 'Alerta de cupo de tarjeta',
   'La tarjeta llegó al 80% o 100% de su cupo del período.', true, array['in_app','push'], true,
   (select coalesce(max(orden), 0) + 3 from sgc.notif_tipo))
on conflict (tipo) do nothing;

-- ── 5) Período de facturación de una tarjeta (día de corte opcional) ──────────
create or replace function sgc.tarjeta_periodo_rango(p_dia_corte smallint, p_fecha date default current_date)
returns table(desde date, hasta date, etiqueta text)
language plpgsql stable
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_fin_mes date;
  v_dia     int;
  v_corte   date;
begin
  if p_dia_corte is null or p_dia_corte < 1 or p_dia_corte > 31 then
    desde := date_trunc('month', p_fecha)::date;
    hasta := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
    etiqueta := to_char(p_fecha, 'YYYY-MM');
    return next;
    return;
  end if;
  v_fin_mes := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
  v_dia := least(p_dia_corte, extract(day from v_fin_mes)::int);
  v_corte := make_date(extract(year from p_fecha)::int, extract(month from p_fecha)::int, v_dia);
  if p_fecha >= v_corte then
    desde := v_corte;
    hasta := (v_corte + interval '1 month - 1 day')::date;
  else
    desde := (v_corte - interval '1 month')::date;
    hasta := (v_corte - interval '1 day')::date;
  end if;
  etiqueta := to_char(desde, 'YYYY-MM-DD') || '..' || to_char(hasta, 'YYYY-MM-DD');
  return next;
end;
$function$;
grant execute on function sgc.tarjeta_periodo_rango(smallint, date) to authenticated, service_role;

-- ── 6) Consumo del período de una tarjeta ─────────────────────────────────────
create or replace function sgc.tarjeta_consumo_periodo(p_codigo_tarjeta text, p_fecha date default current_date)
returns table(periodo text, galones numeric, monto numeric, cupo_gal numeric, cupo_monto numeric, pct_gal numeric, pct_monto numeric)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_cupo_gal   numeric;
  v_cupo_monto numeric;
  v_dia_corte  smallint;
  v_desde      date;
  v_hasta      date;
  v_etiqueta   text;
  v_gal        numeric;
  v_monto      numeric;
begin
  select cupo_gal, cupo_monto, cupo_dia_corte into v_cupo_gal, v_cupo_monto, v_dia_corte
    from sgc.combustible_tarjeta_map where codigo_tarjeta = p_codigo_tarjeta;

  select r.desde, r.hasta, r.etiqueta into v_desde, v_hasta, v_etiqueta
    from sgc.tarjeta_periodo_rango(v_dia_corte, p_fecha) r;

  select coalesce(sum(galones), 0), coalesce(sum(monto), 0) into v_gal, v_monto
    from sgc.registros_combustible
   where tarjeta = p_codigo_tarjeta
     and fecha between v_desde and v_hasta
     and not coalesce(invalidada, false);

  periodo := v_etiqueta; galones := v_gal; monto := v_monto;
  cupo_gal := v_cupo_gal; cupo_monto := v_cupo_monto;
  pct_gal := case when v_cupo_gal is not null and v_cupo_gal > 0 then round(v_gal / v_cupo_gal * 100, 1) else null end;
  pct_monto := case when v_cupo_monto is not null and v_cupo_monto > 0 then round(v_monto / v_cupo_monto * 100, 1) else null end;
  return next;
end;
$function$;
grant execute on function sgc.tarjeta_consumo_periodo(text, date) to authenticated, service_role;

-- ── 7) Tarjeta del vehículo que el chofer usa ahora mismo (solo lectura) ──────
create or replace function sgc.mi_tarjeta_vehiculo(p_vehiculo_id uuid)
returns table(codigo_tarjeta text, cupo_gal numeric, cupo_monto numeric, periodo text, consumo_gal numeric, consumo_monto numeric, pct_gal numeric, pct_monto numeric)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_codigo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (
    sgc.es_flota_elevado()
    or exists (select 1 from sgc.vehiculo_usos u where u.vehiculo_id = p_vehiculo_id and u.usuario_id = v_uid and u.fin_at is null)
    or exists (select 1 from sgc.vehiculo_asignaciones a where a.vehiculo_id = p_vehiculo_id and a.usuario_id = v_uid and a.activa)
  ) then
    return; -- sin acceso a este vehículo → sin filas (no es un error, el chofer escribe los 4 dígitos a mano)
  end if;

  select m.codigo_tarjeta into v_codigo from sgc.combustible_tarjeta_map m where m.vehiculo_id = p_vehiculo_id limit 1;
  if v_codigo is null then
    return; -- sin mapeo → sin filas
  end if;

  return query
    select v_codigo, c.cupo_gal, c.cupo_monto, c.periodo, c.galones, c.monto, c.pct_gal, c.pct_monto
      from sgc.tarjeta_consumo_periodo(v_codigo) c;
end;
$function$;
grant execute on function sgc.mi_tarjeta_vehiculo(uuid) to authenticated, service_role;

-- ── 8) Solicitar cupo (chofer) ─────────────────────────────────────────────────
create or replace function sgc.solicitar_cupo_tarjeta(
  p_codigo_tarjeta text, p_vehiculo_id uuid default null,
  p_galones numeric default null, p_monto numeric default null,
  p_motivo text default 'llego_limite', p_nota text default null,
  p_foto_rechazo_path text default null
)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_motivo text := case when p_motivo in ('llego_limite','bomba_rechazo','pocos_galones','otro') then p_motivo else 'otro' end;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if coalesce(nullif(trim(p_codigo_tarjeta), ''), '') = '' then
    raise exception 'Falta el código de la tarjeta.' using errcode = '22023';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- DI4 — antiduplicado: reenviar devuelve la pendiente existente.
  select id into v_id from sgc.combustible_solicitudes_cupo
   where codigo_tarjeta = p_codigo_tarjeta and solicitante_id = v_uid and estado = 'pendiente';
  if v_id is not null then
    return (select to_jsonb(r) from sgc.combustible_solicitudes_cupo r where r.id = v_id);
  end if;

  insert into sgc.combustible_solicitudes_cupo (
    codigo_tarjeta, vehiculo_id, solicitante_id, galones_pedidos, monto_pedido, motivo, nota, foto_rechazo_path
  ) values (
    trim(p_codigo_tarjeta), p_vehiculo_id, v_uid, p_galones, p_monto, v_motivo, nullif(p_nota, ''), nullif(p_foto_rechazo_path, '')
  ) returning id into v_id;

  perform sgc.notificar_modulo('flota', 'tarjeta_cupo_solicitud',
    'Solicitud de cupo de tarjeta',
    format('%s pidió más cupo para la tarjeta ···%s.',
      coalesce((select nombre from sgc.usuarios where id = v_uid), 'Un chofer'),
      right(trim(p_codigo_tarjeta), 4)),
    '/flota/combustible/solicitudes-cupo?solicitud=' || v_id::text, v_id, 'cupo_solicitud');

  return (select to_jsonb(r) from sgc.combustible_solicitudes_cupo r where r.id = v_id);
end;
$function$;
grant execute on function sgc.solicitar_cupo_tarjeta(text, uuid, numeric, numeric, text, text, text) to authenticated, service_role;

-- ── 9) Atender solicitud (Flota) ───────────────────────────────────────────────
create or replace function sgc.atender_solicitud_cupo(
  p_solicitud_id uuid, p_estado text, p_respuesta text default null,
  p_nuevo_cupo_gal numeric default null, p_nuevo_cupo_monto numeric default null
)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row sgc.combustible_solicitudes_cupo;
begin
  if not sgc.es_flota_elevado() then
    raise exception 'Solo Flota puede atender solicitudes de cupo.' using errcode = '42501';
  end if;
  if p_estado not in ('ampliada', 'rechazada') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;

  select * into v_row from sgc.combustible_solicitudes_cupo where id = p_solicitud_id for update;
  if v_row.id is null then raise exception 'Solicitud no encontrada.'; end if;
  if v_row.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue atendida.' using errcode = '22023';
  end if;
  if p_estado = 'rechazada' and coalesce(nullif(trim(p_respuesta), ''), '') = '' then
    raise exception 'Escribe el motivo del rechazo.' using errcode = '22023';
  end if;

  update sgc.combustible_solicitudes_cupo set
    estado = p_estado, respuesta = nullif(p_respuesta, ''),
    nuevo_cupo_gal = p_nuevo_cupo_gal, nuevo_cupo_monto = p_nuevo_cupo_monto,
    atendida_por = v_uid, atendida_at = now()
   where id = p_solicitud_id;

  if p_estado = 'ampliada' and (p_nuevo_cupo_gal is not null or p_nuevo_cupo_monto is not null) then
    update sgc.combustible_tarjeta_map set
      cupo_gal = coalesce(p_nuevo_cupo_gal, cupo_gal),
      cupo_monto = coalesce(p_nuevo_cupo_monto, cupo_monto),
      updated_at = now(), updated_by = v_uid
     where codigo_tarjeta = v_row.codigo_tarjeta;
  end if;

  perform sgc.notificar(v_row.solicitante_id, 'tarjeta_cupo_respuesta',
    case when p_estado = 'ampliada' then 'Te ampliaron el cupo de la tarjeta' else 'Tu solicitud de cupo fue rechazada' end,
    coalesce(p_respuesta, case when p_estado = 'ampliada' then 'Ya puedes seguir cargando combustible.' else 'Consulta con Logística.' end),
    '/flota/combustible');

  return (select to_jsonb(r) from sgc.combustible_solicitudes_cupo r where r.id = p_solicitud_id);
end;
$function$;
grant execute on function sgc.atender_solicitud_cupo(uuid, text, text, numeric, numeric) to authenticated, service_role;

-- ── 10) Cancelar (el propio chofer, mientras esté pendiente) ──────────────────
create or replace function sgc.cancelar_solicitud_cupo(p_solicitud_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  update sgc.combustible_solicitudes_cupo
     set estado = 'cancelada'
   where id = p_solicitud_id and solicitante_id = v_uid and estado = 'pendiente';
  if not found then raise exception 'No se pudo cancelar (ya fue atendida o no es tuya).'; end if;
end;
$function$;
grant execute on function sgc.cancelar_solicitud_cupo(uuid) to authenticated, service_role;

-- ── 11) Listados ───────────────────────────────────────────────────────────────
create or replace function sgc.mis_solicitudes_cupo()
returns setof sgc.combustible_solicitudes_cupo
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select * from sgc.combustible_solicitudes_cupo where solicitante_id = auth.uid() order by created_at desc;
$function$;
grant execute on function sgc.mis_solicitudes_cupo() to authenticated, service_role;

create or replace function sgc.combustible_solicitudes_cupo_listado(p_estado text default null)
returns table(
  id uuid, codigo_tarjeta text, vehiculo_id uuid, vehiculo_placa text,
  solicitante_id uuid, solicitante_nombre text, galones_pedidos numeric, monto_pedido numeric,
  motivo text, nota text, foto_rechazo_path text, estado text, respuesta text,
  nuevo_cupo_gal numeric, nuevo_cupo_monto numeric, atendida_por uuid, atendida_at timestamptz,
  es_prueba boolean, created_at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.es_flota_elevado() then
    raise exception 'Solo Flota puede ver esta bandeja.' using errcode = '42501';
  end if;
  return query
    select s.id, s.codigo_tarjeta, s.vehiculo_id, v.placa,
           s.solicitante_id, u.nombre, s.galones_pedidos, s.monto_pedido,
           s.motivo, s.nota, s.foto_rechazo_path, s.estado, s.respuesta,
           s.nuevo_cupo_gal, s.nuevo_cupo_monto, s.atendida_por, s.atendida_at,
           s.es_prueba, s.created_at
      from sgc.combustible_solicitudes_cupo s
      left join sgc.vehiculos v on v.id = s.vehiculo_id
      left join sgc.usuarios u on u.id = s.solicitante_id
     where p_estado is null or s.estado = p_estado
     order by (s.estado = 'pendiente') desc, s.created_at desc;
end;
$function$;
grant execute on function sgc.combustible_solicitudes_cupo_listado(text) to authenticated, service_role;

create or replace function sgc.combustible_cupo_tarjetas_listado()
returns table(
  codigo_tarjeta text, titular_nombre text, es_persona boolean, vehiculo_id uuid, vehiculo_placa text,
  cupo_gal numeric, cupo_monto numeric, cupo_dia_corte smallint,
  periodo text, consumo_gal numeric, consumo_monto numeric, pct_gal numeric, pct_monto numeric
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.es_flota_elevado() then
    raise exception 'Solo Flota puede ver las tarjetas.' using errcode = '42501';
  end if;
  return query
    select m.codigo_tarjeta, m.titular_nombre, m.es_persona, m.vehiculo_id, v.placa,
           m.cupo_gal, m.cupo_monto, m.cupo_dia_corte,
           c.periodo, c.galones, c.monto, c.pct_gal, c.pct_monto
      from sgc.combustible_tarjeta_map m
      left join sgc.vehiculos v on v.id = m.vehiculo_id
      left join lateral sgc.tarjeta_consumo_periodo(m.codigo_tarjeta) c on true
     order by m.titular_nombre;
end;
$function$;
grant execute on function sgc.combustible_cupo_tarjetas_listado() to authenticated, service_role;

-- ── 12) Editar cupo directo desde la bandeja (sin pasar por una solicitud) ────
create or replace function sgc.editar_cupo_tarjeta(p_codigo_tarjeta text, p_cupo_gal numeric default null, p_cupo_monto numeric default null, p_cupo_dia_corte smallint default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.es_flota_elevado() then
    raise exception 'Solo Flota puede editar el cupo.' using errcode = '42501';
  end if;
  update sgc.combustible_tarjeta_map set
    cupo_gal = p_cupo_gal, cupo_monto = p_cupo_monto, cupo_dia_corte = p_cupo_dia_corte,
    updated_at = now(), updated_by = auth.uid()
   where codigo_tarjeta = p_codigo_tarjeta;
  if not found then raise exception 'Tarjeta no encontrada.'; end if;
end;
$function$;
grant execute on function sgc.editar_cupo_tarjeta(text, numeric, numeric, smallint) to authenticated, service_role;

-- ── 13) Alerta de 80%/100% — enganchada a registrar_combustible_app ────────────
-- DROP de la firma que dejó F5 (2026-11-03-di5) para extenderla sin crear overload.
drop function if exists sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean, text, text, uuid, boolean, text, text, text, jsonb
);

create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date,
  p_kilometraje integer, p_galones numeric, p_monto numeric,
  p_estacion text default null, p_foto_recibo_path text default null,
  p_foto_tablero_path text default null, p_notas text default null,
  p_foto_bomba_path text default null, p_producto text default null,
  p_tarjeta text default null, p_titular text default null,
  p_titular_es_persona boolean default false, p_subtipo text default null,
  p_origen text default 'estacion', p_proyecto_id uuid default null,
  p_confirmado boolean default false, p_foto_origen text default 'camara',
  p_numero_recibo text default null,
  p_captura text default 'normal',
  p_diferencias jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
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
  v_foto_origen  text := case when lower(coalesce(p_foto_origen,'camara')) in ('galeria','galería') then 'galeria' else 'camara' end;  -- CK3
  v_numero_recibo text := nullif(regexp_replace(coalesce(p_numero_recibo,''), '[^0-9]', '', 'g'), ''); -- CO15
  v_validacion_km jsonb; -- CZ1
  -- DI5/DI6
  v_captura        text := case when lower(coalesce(p_captura,'normal')) = 'rapido_ia' then 'rapido_ia' else 'normal' end;
  v_sin_foto_bomba boolean;
  v_exige_bomba    boolean;
  v_diferencia_marcada boolean := false;
  -- DI4 — alerta de cupo de tarjeta
  v_tarjeta_norm text := nullif(trim(p_tarjeta), '');
  v_consumo      record;
  v_alerta_id    uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

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

  if v_numero_recibo is not null and not v_persona then
    select id into v_id from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and numero_recibo = v_numero_recibo
       and not coalesce(invalidada, false)
     limit 1;
    if v_id is not null then
      return (select to_jsonb(r) || jsonb_build_object('duplicado', true)
                from sgc.registros_combustible r where r.id = v_id);
    end if;
  end if;

  select id into v_id from sgc.registros_combustible
   where registrado_por = v_uid
     and coalesce(vehiculo_id::text,'') = coalesce((case when v_persona then null else p_vehiculo_id end)::text,'')
     and galones = p_galones
     and coalesce(monto,0) = coalesce(nullif(p_monto,0),0)
     and created_at > now() - interval '120 seconds'
   order by created_at asc
   limit 1;
  if v_id is not null then
    return (select to_jsonb(r) || jsonb_build_object('duplicado', true)
              from sgc.registros_combustible r where r.id = v_id);
  end if;

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

  v_sin_foto_bomba := (v_captura = 'rapido_ia' and p_foto_bomba_path is null and not v_persona and not v_deposito);
  if v_sin_foto_bomba then
    v_exige_bomba := coalesce((select valor from sgc.parametros where clave = 'combustible_rapido_exige_bomba'), 'false') = 'true';
    if v_exige_bomba and not v_elevado_conf then
      perform sgc.error_campo('foto_bomba', 'requerida',
        'Falta la foto de la bomba en 0. Actívala en Flota › Combustible si quieres hacerla opcional.');
    end if;
  end if;

  if p_diferencias is not null and jsonb_typeof(p_diferencias) = 'array' then
    select exists (
      select 1 from jsonb_array_elements(p_diferencias) d
      where d->>'decision' = 'mantener_mio'
    ) into v_diferencia_marcada;
  end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;

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
        v_sin_asignacion := true;
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

    v_validacion_km := sgc.validar_km_vehiculo(p_vehiculo_id, p_kilometraje, coalesce(p_fecha, current_date)::timestamptz);
    if coalesce(v_validacion_km->>'nivel','ok') = 'error' then
      perform sgc.error_campo('kilometraje', 'menor_que_actual', v_validacion_km->>'mensaje');
    end if;

    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false);

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

      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          v_km_alerta := true;
        end if;
      end if;
    end if;

    select dist_min, piso, techo into v_dist_min, v_piso_c, v_techo_c
      from sgc.rango_rendimiento_vehiculo(p_vehiculo_id, v_medida);
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
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true, v_piso_c, v_techo_c);
    v_alerta := (v_estado = 'anormal');
  end if;

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
    origen, proyecto_id, registrado_por, km_alerta, sin_asignacion, foto_origen,
    numero_recibo, captura, sin_foto_bomba, diferencias_recibo
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
    nullif(p_producto,''), nullif(p_subtipo,''), v_tarjeta_norm, nullif(p_titular,''), coalesce(p_titular_es_persona,false),
    v_origen, p_proyecto_id, v_uid, v_km_alerta, v_sin_asignacion, v_foto_origen,
    v_numero_recibo, v_captura, v_sin_foto_bomba, p_diferencias
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

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

    if v_diferencia_marcada and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'combustible_diferencia',
        'Diferencia entre lo tecleado y el recibo',
        format('%s: el chofer mantuvo un valor distinto al leído del recibo. Revisar.', coalesce(v_placa,'Un vehículo')),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
    end if;
  end if;

  -- DI4/DI-08 — alerta de cupo 80%/100% (una vez por tarjeta+período+umbral).
  if v_tarjeta_norm is not null and not v_es_prueba then
    select * into v_consumo from sgc.tarjeta_consumo_periodo(v_tarjeta_norm, coalesce(p_fecha, current_date));
    if v_consumo.cupo_gal is not null or v_consumo.cupo_monto is not null then
      if coalesce(v_consumo.pct_gal, 0) >= 100 or coalesce(v_consumo.pct_monto, 0) >= 100 then
        insert into sgc.combustible_tarjeta_alertas (codigo_tarjeta, periodo, umbral)
        values (v_tarjeta_norm, v_consumo.periodo, 100) on conflict do nothing
        returning id into v_alerta_id;
      elsif coalesce(v_consumo.pct_gal, 0) >= 80 or coalesce(v_consumo.pct_monto, 0) >= 80 then
        insert into sgc.combustible_tarjeta_alertas (codigo_tarjeta, periodo, umbral)
        values (v_tarjeta_norm, v_consumo.periodo, 80) on conflict do nothing
        returning id into v_alerta_id;
      end if;
      if v_alerta_id is not null then
        perform sgc.notificar_modulo('flota', 'tarjeta_cupo_alerta',
          'Tarjeta cerca de su cupo',
          format('La tarjeta ···%s llegó al %s%% de su cupo del período.',
            right(v_tarjeta_norm, 4), round(greatest(coalesce(v_consumo.pct_gal,0), coalesce(v_consumo.pct_monto,0)))),
          '/flota/combustible/cupos-tarjetas', null, 'tarjeta');
        if v_uid is not null then
          perform sgc.notificar(v_uid, 'tarjeta_cupo_alerta', 'Tu tarjeta está cerca del cupo',
            format('La tarjeta ···%s va por el %s%% del cupo de este período.',
              right(v_tarjeta_norm, 4), round(greatest(coalesce(v_consumo.pct_gal,0), coalesce(v_consumo.pct_monto,0)))),
            '/flota/combustible');
        end if;
      end if;
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
    'aviso', case when v_sin_asignacion or v_km_alerta or v_diferencia_marcada
                  then 'Registrado. Logística (Raykler) lo revisará.' else null end,
    'promedio_rendimiento', case when v_n_prev >= v_min_reg then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro,
    'medida_uso', v_medida,
    'titular_es_persona', v_persona,
    'origen', v_origen,
    'numero_recibo', v_numero_recibo,
    'captura', v_captura,
    'sin_foto_bomba', v_sin_foto_bomba
  );
end;
$function$;

grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean, text, text, uuid, boolean, text, text, text, jsonb
) to authenticated, service_role;

-- Verificación:
--   select proname, pronargs from pg_proc where proname='registrar_combustible_app' and pronamespace='sgc'::regnamespace;
--   -- 1 fila, pronargs=24.
--   select routine_name from information_schema.routines where routine_schema='sgc'
--     and routine_name in ('solicitar_cupo_tarjeta','atender_solicitud_cupo','mi_tarjeta_vehiculo',
--       'tarjeta_consumo_periodo','mis_solicitudes_cupo','combustible_solicitudes_cupo_listado',
--       'combustible_cupo_tarjetas_listado','editar_cupo_tarjeta','cancelar_solicitud_cupo');
--   -- 9 filas.
