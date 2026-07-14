-- ============================================================================
-- Flota v2 — Pre-uso v2 + Combustible v2 (13/07/2026)
-- ----------------------------------------------------------------------------
-- Migración ADITIVA y RETROCOMPATIBLE. La app móvil en producción llama
-- `registrar_checklist_vehiculo`, `crear_mantenimiento_app`,
-- `crear_entrega_vehiculo` y `mis_pendientes_transporte`; esos contratos NO se
-- rompen (los parámetros nuevos tienen DEFAULT).
--
--   1. Columnas nuevas: vehiculos, conductores, registros_combustible, checklists_vehiculo
--   2. Tabla sgc.avisos_flota (gestión de avisos) + RLS + índices
--   3. Tabla sgc.flota_config (umbrales de negocio configurables)
--   4. Helper sgc.notificar_modulo(...)
--   5. RPC sgc.registrar_combustible_app (SECURITY DEFINER, idempotente)
--   6. RPC sgc.registrar_checklist_vehiculo EXTENDIDO (resultado tri-estado,
--      alerta de mantenimiento, bloqueos por licencia/matrícula/seguro, avisos)
--   7. RPC sgc.atender_aviso_flota(id, nota)
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Columnas nuevas ──────────────────────────────────────────────────────

-- Vehículos: vencimientos y mantenimiento por kilometraje.
alter table sgc.vehiculos
  add column if not exists vencimiento_matricula      date,
  add column if not exists vencimiento_seguro         date,
  add column if not exists km_ultimo_mantenimiento    int,
  add column if not exists intervalo_mantenimiento_km int not null default 5000;
comment on column sgc.vehiculos.km_ultimo_mantenimiento is 'Km al que se hizo el último mantenimiento; próximo = este + intervalo_mantenimiento_km.';

-- Conductores: tipo de vehículo autorizado (Liviano | Pesado | Ambos).
alter table sgc.conductores
  add column if not exists tipo_vehiculo_autorizado text not null default 'Ambos';
do $$ begin
  alter table sgc.conductores
    add constraint conductores_tipo_veh_chk
    check (tipo_vehiculo_autorizado in ('Liviano','Pesado','Ambos'));
exception when duplicate_object then null; end $$;

-- Registros de combustible: galones/monto + derivados calculados en servidor.
-- (litros / costo_por_litro quedan legacy, nullable, para históricos.)
-- litros era NOT NULL en v1 → los registros v2 (galones) no lo llenan.
do $$ begin
  alter table sgc.registros_combustible alter column litros drop not null;
exception when others then null; end $$;
alter table sgc.registros_combustible
  add column if not exists galones            numeric,
  add column if not exists monto              numeric,
  add column if not exists precio_por_galon   numeric,
  add column if not exists km_anterior        int,
  add column if not exists km_recorridos      int,
  add column if not exists rendimiento_km_gal numeric,
  add column if not exists costo_por_km       numeric,
  add column if not exists foto_recibo_path   text,
  add column if not exists foto_tablero_path  text,
  add column if not exists alerta_consumo     boolean not null default false,
  add column if not exists client_uuid        uuid;
-- Idempotencia por UUID de cliente (permite múltiples NULL de filas legacy).
create unique index if not exists uq_registros_combustible_client_uuid
  on sgc.registros_combustible(client_uuid) where client_uuid is not null;
create index if not exists idx_registros_combustible_veh_km
  on sgc.registros_combustible(vehiculo_id, kilometraje);

-- Checklists de vehículo: veredicto tri-estado + alerta de mantenimiento.
alter table sgc.checklists_vehiculo
  add column if not exists nivel_combustible       text,
  add column if not exists resultado               text,
  add column if not exists km_faltan_mantenimiento int,
  add column if not exists alerta_mantenimiento     text;
do $$ begin
  alter table sgc.checklists_vehiculo
    add constraint checklists_vehiculo_resultado_chk
    check (resultado is null or resultado in ('aprobado','con_hallazgos','bloqueado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table sgc.checklists_vehiculo
    add constraint checklists_vehiculo_alerta_mant_chk
    check (alerta_mantenimiento is null or alerta_mantenimiento in ('ok','pre_cita','vencido'));
exception when duplicate_object then null; end $$;

-- ── 2) Tabla de avisos de flota ─────────────────────────────────────────────
create table if not exists sgc.avisos_flota (
  id            uuid primary key default gen_random_uuid(),
  -- bloqueo_critico | hallazgos | pre_cita | mantenimiento_vencido |
  -- consumo_anormal | licencia | matricula | seguro
  tipo          text not null,
  vehiculo_id   uuid references sgc.vehiculos(id) on delete set null,
  conductor_id  uuid references sgc.conductores(id) on delete set null,
  referencia_id uuid,                                   -- checklist / registro_combustible / etc.
  mensaje       text not null,
  severidad     text not null default 'media',          -- baja | media | alta
  estado        text not null default 'pendiente',      -- pendiente | atendido
  -- Idempotencia (avisos de vencimiento generados 1x/día): clave estable.
  dedup_key     text,
  atendido_por  uuid references sgc.usuarios(id),
  atendido_at   timestamptz,
  nota_atencion text,
  created_at    timestamptz not null default now(),
  constraint avisos_flota_tipo_chk check (tipo in (
    'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido',
    'consumo_anormal','licencia','matricula','seguro')),
  constraint avisos_flota_estado_chk check (estado in ('pendiente','atendido')),
  constraint avisos_flota_sev_chk    check (severidad in ('baja','media','alta'))
);
create unique index if not exists uq_avisos_flota_dedup
  on sgc.avisos_flota(dedup_key) where dedup_key is not null;
create index if not exists idx_avisos_flota_estado   on sgc.avisos_flota(estado);
create index if not exists idx_avisos_flota_vehiculo on sgc.avisos_flota(vehiculo_id);
create index if not exists idx_avisos_flota_tipo     on sgc.avisos_flota(tipo);

alter table sgc.avisos_flota enable row level security;
drop policy if exists avisos_flota_sel on sgc.avisos_flota;
create policy avisos_flota_sel on sgc.avisos_flota for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
drop policy if exists avisos_flota_all on sgc.avisos_flota;
create policy avisos_flota_all on sgc.avisos_flota for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));

-- ── 3) Constantes de negocio (umbrales) ─────────────────────────────────────
create table if not exists sgc.flota_config (
  clave text primary key,
  valor numeric not null
);
insert into sgc.flota_config(clave, valor) values
  ('umbral_consumo_pct',  20),   -- % bajo el promedio -> consumo anormal
  ('umbral_precita_km',  500),   -- km restantes -> agendar pre-cita
  ('umbral_licencia_dias', 30)   -- días para vencer -> aviso de licencia
on conflict (clave) do nothing;

alter table sgc.flota_config enable row level security;
drop policy if exists flota_config_sel on sgc.flota_config;
create policy flota_config_sel on sgc.flota_config for select to authenticated using (true);
drop policy if exists flota_config_all on sgc.flota_config;
create policy flota_config_all on sgc.flota_config for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());

-- ── 4) Grants (schema custom no autoconcede) ────────────────────────────────
grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.avisos_flota to authenticated;
grant select on sgc.flota_config to authenticated;
grant insert, update, delete on sgc.flota_config to authenticated;   -- gestionado por policy (admin)
grant all on sgc.avisos_flota, sgc.flota_config to service_role;

-- ── 4b) Helper: notificar in-app a todos los usuarios de un módulo ──────────
create or replace function sgc.notificar_modulo(
  p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language sql security definer set search_path to 'sgc','pg_temp' as $$
  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
  select distinct u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos));
$$;
grant execute on function sgc.notificar_modulo(text, text, text, text, text) to authenticated, service_role;

-- ── 5) RPC nuevo: registrar combustible v2 (app + web) ──────────────────────
-- SECURITY DEFINER, idempotente por client_uuid, patrón de crear_mantenimiento_app.
-- Calcula precio/galón, km recorridos, rendimiento y costo/km; evalúa consumo
-- anormal (>= 3 registros con rendimiento; alerta si < (1-umbral%)*promedio),
-- inserta aviso + notifica al módulo flota. Devuelve el registro completo.
create or replace function sgc.registrar_combustible_app(
  p_client_uuid       uuid,
  p_vehiculo_id       uuid,
  p_conductor_id      uuid,
  p_fecha             date,
  p_kilometraje       int,
  p_galones           numeric,
  p_monto             numeric,
  p_estacion          text default null,
  p_foto_recibo_path  text default null,
  p_foto_tablero_path text default null,
  p_notas             text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid          uuid := auth.uid();
  v_id           uuid;
  v_km_anterior  int;
  v_km_recorridos int;
  v_precio       numeric;
  v_rendimiento  numeric;
  v_costo_km     numeric;
  v_prom         numeric;
  v_n_prev       int;
  v_umbral       numeric;
  v_alerta       boolean := false;
  v_placa        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotencia: reenvío del mismo op devuelve el registro existente.
  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;
  if coalesce(p_kilometraje, 0) <= 0 then raise exception 'El kilometraje debe ser mayor que 0'; end if;
  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if coalesce(p_monto, 0)   <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  -- Última echada del MISMO vehículo (por kilometraje). El odómetro no retrocede.
  select max(kilometraje) into v_km_anterior
    from sgc.registros_combustible
   where vehiculo_id = p_vehiculo_id and kilometraje is not null;

  if v_km_anterior is not null and p_kilometraje <= v_km_anterior then
    raise exception 'El kilometraje (%) debe ser mayor al de la última echada del vehículo (% km).',
      p_kilometraje, v_km_anterior;
  end if;

  v_precio := round(p_monto / p_galones, 2);

  if v_km_anterior is not null then
    v_km_recorridos := p_kilometraje - v_km_anterior;
    if v_km_recorridos > 0 then
      v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
      v_costo_km    := round(p_monto / v_km_recorridos, 2);
    end if;
  end if;

  -- Consumo anormal: promedio de rendimientos históricos del vehículo (>= 3).
  if v_rendimiento is not null then
    select count(*), avg(rendimiento_km_gal)
      into v_n_prev, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null;
    if v_n_prev >= 3 and v_prom is not null then
      select valor into v_umbral from sgc.flota_config where clave = 'umbral_consumo_pct';
      v_umbral := coalesce(v_umbral, 20);
      if v_rendimiento < (1 - v_umbral / 100.0) * v_prom then
        v_alerta := true;
      end if;
    end if;
  end if;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, alerta_consumo, client_uuid
  ) values (
    v_id, p_vehiculo_id, p_conductor_id, coalesce(p_fecha, current_date), p_kilometraje,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), v_alerta, p_client_uuid
  );

  -- El odómetro del vehículo avanza.
  update sgc.vehiculos set kilometraje = p_kilometraje
   where id = p_vehiculo_id and p_kilometraje > coalesce(kilometraje, 0);

  if v_alerta then
    select placa into v_placa from sgc.vehiculos where id = p_vehiculo_id;
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
      format('Consumo anormal en %s: %s km/gal (%s%% bajo el promedio de %s km/gal). Posible fuga, problema mecánico o combustible desviado.',
        coalesce(v_placa,'vehículo'), v_rendimiento, round((1 - v_rendimiento / v_prom) * 100), round(v_prom,2)),
      'alta');
    perform sgc.notificar_modulo('flota', 'warning',
      'Consumo anormal de combustible',
      format('%s registró %s km/gal, bajo el promedio del vehículo.', coalesce(v_placa,'Un vehículo'), v_rendimiento),
      '/flota/combustible');
  end if;

  return jsonb_build_object(
    'id', v_id,
    'precio_por_galon', v_precio,
    'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos,
    'rendimiento_km_gal', v_rendimiento,
    'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'promedio_rendimiento', case when v_n_prev >= 3 then round(v_prom, 2) else null end
  );
end;
$$;
grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, int, numeric, numeric, text, text, text, text
) to authenticated, service_role;

-- ── 6) RPC extendido: registrar checklist v2 (retrocompatible) ──────────────
-- Se REEMPLAZA la firma de 13 args por una de 14 (p_nivel_combustible con
-- DEFAULT null). Los clientes viejos (móvil, 13 args nombrados) resuelven a esta
-- misma función con el nuevo parámetro por defecto. Calcula el veredicto
-- tri-estado (aprobado / con_hallazgos / bloqueado), la alerta de mantenimiento
-- por km, valida bloqueos (licencia / matrícula / seguro vencidos) e inserta
-- avisos + notifica.
drop function if exists sgc.registrar_checklist_vehiculo(
  uuid, uuid, uuid, uuid, text, date, jsonb, numeric, jsonb, jsonb, text, text, timestamptz);

create or replace function sgc.registrar_checklist_vehiculo(
  p_id              uuid,
  p_plantilla_id    uuid,
  p_vehiculo_id     uuid,
  p_conductor_id    uuid,
  p_tipo            text,
  p_fecha           date,
  p_datos           jsonb,
  p_kilometraje     numeric,
  p_respuestas      jsonb,
  p_fotos           jsonb,
  p_firma_path      text,
  p_observaciones   text,
  p_capturado_en    timestamptz,
  p_nivel_combustible text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid       uuid := auth.uid();
  v_criticos  boolean := false;
  v_hay_no    boolean := false;
  v_resultado text;
  v_km        int;
  v_km_ult    int;
  v_intervalo int;
  v_proximo   int;
  v_faltan    int;
  v_alerta_mant text := 'ok';
  v_umbral_pre numeric;
  v_lic_venc  date;
  v_mat_venc  date;
  v_seg_venc  date;
  v_placa     text;
  v_cond_nom  text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotencia: reenvío del mismo op devuelve el id existente.
  if exists (select 1 from sgc.checklists_vehiculo where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  -- ── Bloqueos duros (además del cliente) ──────────────────────────────────
  select placa, vencimiento_matricula, vencimiento_seguro, km_ultimo_mantenimiento, intervalo_mantenimiento_km
    into v_placa, v_mat_venc, v_seg_venc, v_km_ult, v_intervalo
    from sgc.vehiculos where id = p_vehiculo_id;

  if v_mat_venc is not null and v_mat_venc < current_date then
    raise exception 'La matrícula del vehículo (%) está vencida (venció %). No puede salir.', v_placa, v_mat_venc;
  end if;
  if v_seg_venc is not null and v_seg_venc < current_date then
    raise exception 'El seguro del vehículo (%) está vencido (venció %). No puede salir.', v_placa, v_seg_venc;
  end if;

  if p_conductor_id is not null then
    select licencia_vencimiento, nombre into v_lic_venc, v_cond_nom
      from sgc.conductores where id = p_conductor_id;
    if v_lic_venc is not null and v_lic_venc < current_date then
      raise exception 'La licencia del conductor % está vencida (venció %). Contacta a RRHH.', coalesce(v_cond_nom,''), v_lic_venc;
    end if;
  end if;

  -- ── Veredicto tri-estado ─────────────────────────────────────────────────
  select
      coalesce(bool_or((r->>'es_critico')::boolean and lower(r->>'respuesta') = 'no'), false),
      coalesce(bool_or(lower(r->>'respuesta') = 'no'), false)
    into v_criticos, v_hay_no
    from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb)) r;

  v_resultado := case when v_criticos then 'bloqueado'
                      when v_hay_no  then 'con_hallazgos'
                      else 'aprobado' end;

  -- ── Alerta de mantenimiento por km ───────────────────────────────────────
  v_km := floor(coalesce(p_kilometraje, 0))::int;
  if v_km_ult is not null and v_km > 0 then
    v_proximo := v_km_ult + coalesce(v_intervalo, 5000);
    v_faltan  := v_proximo - v_km;
    select valor into v_umbral_pre from sgc.flota_config where clave = 'umbral_precita_km';
    v_umbral_pre := coalesce(v_umbral_pre, 500);
    v_alerta_mant := case when v_faltan <= 0 then 'vencido'
                          when v_faltan <= v_umbral_pre then 'pre_cita'
                          else 'ok' end;
  else
    v_faltan := null;
    v_alerta_mant := 'ok';
  end if;

  -- ── Persistir cabecera + detalle ─────────────────────────────────────────
  insert into sgc.checklists_vehiculo (
    id, plantilla_id, vehiculo_id, conductor_id, tipo, fecha, datos, kilometraje,
    firma_path, observaciones, tiene_criticos, creado_por, capturado_en,
    nivel_combustible, resultado, km_faltan_mantenimiento, alerta_mantenimiento
  ) values (
    p_id, p_plantilla_id, p_vehiculo_id, p_conductor_id, coalesce(p_tipo,'pre_uso'),
    coalesce(p_fecha, current_date), coalesce(p_datos, '{}'::jsonb), p_kilometraje,
    p_firma_path, p_observaciones, v_criticos, v_uid, coalesce(p_capturado_en, now()),
    nullif(p_nivel_combustible,''), v_resultado, v_faltan, v_alerta_mant
  );

  insert into sgc.checklist_vehiculo_respuestas (checklist_id, etiqueta, seccion, es_critico, respuesta, comentario, orden)
  select p_id, r->>'etiqueta', r->>'seccion',
         coalesce((r->>'es_critico')::boolean, false),
         coalesce(lower(r->>'respuesta'), 'na'),
         r->>'comentario',
         coalesce((r->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb)) r;

  insert into sgc.checklist_vehiculo_fotos (checklist_id, storage_path, slot)
  select p_id, f->>'storage_path', f->>'slot'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
  where nullif(f->>'storage_path','') is not null;

  -- ── Avisos + notificaciones ──────────────────────────────────────────────
  if v_resultado = 'bloqueado' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('bloqueo_critico', p_vehiculo_id, p_conductor_id, p_id,
      format('Vehículo %s BLOQUEADO en pre-uso: ítem(s) crítico(s) en NO. Fuera de servicio hasta corrección.', coalesce(v_placa,'')), 'alta');
    perform sgc.notificar_modulo('flota', 'error',
      'Vehículo bloqueado en pre-uso',
      format('%s no puede salir: falló un ítem crítico del checklist.', coalesce(v_placa,'Un vehículo')),
      '/flota/checklists');
  elsif v_resultado = 'con_hallazgos' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('hallazgos', p_vehiculo_id, p_conductor_id, p_id,
      format('Vehículo %s con hallazgos no críticos en pre-uso. Requiere corrección.', coalesce(v_placa,'')), 'media');
    perform sgc.notificar_modulo('flota', 'warning',
      'Pre-uso con hallazgos',
      format('%s salió con hallazgos no críticos. Coordinar corrección.', coalesce(v_placa,'Un vehículo')),
      '/flota/checklists');
  end if;

  if v_alerta_mant = 'vencido' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('mantenimiento_vencido', p_vehiculo_id, p_conductor_id, p_id,
      format('Mantenimiento VENCIDO en %s (%s km pasados del próximo).', coalesce(v_placa,''), abs(v_faltan)), 'alta');
    perform sgc.notificar_modulo('flota', 'warning',
      'Mantenimiento vencido',
      format('%s superó su intervalo de mantenimiento.', coalesce(v_placa,'Un vehículo')),
      '/flota/mantenimientos');
  elsif v_alerta_mant = 'pre_cita' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('pre_cita', p_vehiculo_id, p_conductor_id, p_id,
      format('Agendar PRE-CITA de mantenimiento para %s (faltan %s km).', coalesce(v_placa,''), v_faltan), 'media');
    perform sgc.notificar_modulo('flota', 'info',
      'Agendar pre-cita de mantenimiento',
      format('A %s le faltan %s km para el mantenimiento.', coalesce(v_placa,'un vehículo'), v_faltan),
      '/flota/mantenimientos');
  end if;

  return p_id;
end;
$$;
grant execute on function sgc.registrar_checklist_vehiculo(
  uuid, uuid, uuid, uuid, text, date, jsonb, numeric, jsonb, jsonb, text, text, timestamptz, text
) to authenticated, service_role;

-- ── 7) RPC: atender aviso de flota (flota/admin) ────────────────────────────
create or replace function sgc.atender_aviso_flota(p_id uuid, p_nota text)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No autorizado';
  end if;
  update sgc.avisos_flota
     set estado = 'atendido', atendido_por = auth.uid(), atendido_at = now(),
         nota_atencion = nullif(p_nota,'')
   where id = p_id;
end;
$$;
grant execute on function sgc.atender_aviso_flota(uuid, text) to authenticated, service_role;

-- ── 8) Realtime (avisos en vivo para Flota) ─────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table sgc.avisos_flota;
exception when duplicate_object then null; end $$;
