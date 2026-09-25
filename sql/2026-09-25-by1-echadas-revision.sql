-- ============================================================================
-- BY1 + BY5 — Zona de espera / aprobación de echadas con aviso (regla 15 completa).
-- Notas: "rayker or me as an admin must be able to approve it, not only view it" ·
-- "que no le impida al usuario registrarlo … pero que lo envie a una zona de espera
--  donde rayker o yo lo aprobemos … o lo rechacemos".
--
-- Hoy BR1 acepta con banderas (km_alerta / alerta_consumo / sin_asignacion) y avisa,
-- pero la echada YA cuenta en tableros/rendimiento y "aprobar" está disfrazado de
-- "corregir" (sanear_echada). Aquí: acepta → **en_espera** → alguien decide.
--
-- Arquitectura (regla 14, una sola fuente): un TRIGGER before-insert marca en_espera
-- por CUALQUIER bandera → cubre TODOS los caminos (registrar_combustible_app, import,
-- retro, web) sin editar cada RPC. Interruptor `flota_config.revision_echadas`.
--
-- Aditivo/idempotente. Apply: node scripts/apply-migration.mjs sql/2026-09-25-by1-echadas-revision.sql --env dev  →  --env prod
-- Rollback: alter table … drop column revision …; drop trigger; flota_config.revision_echadas=false apaga el mecanismo.
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) Columnas de revisión ────────────────────────────────────────────────
alter table sgc.registros_combustible
  add column if not exists revision text not null default 'normal'
    check (revision in ('normal','en_espera','aprobada','rechazada')),
  add column if not exists revisada_por uuid references sgc.usuarios(id),
  add column if not exists revisada_en timestamptz,
  add column if not exists revision_motivo text,
  add column if not exists reenvio_de uuid references sgc.registros_combustible(id);
comment on column sgc.registros_combustible.revision is
  'BY1 — normal (no requiere visto bueno) · en_espera (bandera, pendiente de aprobar) · aprobada · rechazada. En espera NO cuenta en rendimiento/tableros/conciliación.';
create index if not exists idx_rc_en_espera on sgc.registros_combustible (created_at desc) where revision = 'en_espera';

-- ── (2) Interruptor (regla 7) + tipos de notificación ───────────────────────
insert into sgc.flota_config (clave, valor) values ('revision_echadas', 1)
on conflict (clave) do nothing;  -- 1 = activo; 0 = apaga el mecanismo (rollback suave)

insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values
  ('combustible_por_aprobar', 'Echada por aprobar', 'Una echada con aviso quedó en espera de tu visto bueno (aprobar/rechazar).', false, array['in_app','push'], true, 63),
  ('combustible_aprobada', 'Echada aprobada', 'Tu echada en espera fue aprobada.', false, array['in_app','push'], true, 64),
  ('combustible_rechazada', 'Echada rechazada', 'Tu echada fue rechazada; puedes corregir y reenviar.', false, array['in_app','push'], true, 65),
  ('combustible_por_aprobar_recordatorio', 'Echadas por aprobar (recordatorio)', 'Hay echadas en espera de aprobación desde hace más de 48 h.', false, array['in_app','push'], true, 66)
on conflict (tipo) do nothing;

-- ── (3) Trigger: marca en_espera por cualquier bandera (fuente única) ────────
create or replace function sgc.trg_combustible_set_revision()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare
  v_on boolean := coalesce((select valor <> 0 from sgc.flota_config where clave='revision_echadas'), true);
  v_cap numeric;
begin
  -- Solo al nacer (revision por defecto 'normal') y con el mecanismo activo; nunca a datos de prueba.
  if not v_on or coalesce(new.es_prueba,false) or new.revision <> 'normal' then
    return new;
  end if;
  -- Galones > tanque (integridad): si el vehículo tiene capacidad y se excede, a espera.
  if new.vehiculo_id is not null and coalesce(new.galones,0) > 0 then
    begin v_cap := sgc.cap_tanque_vehiculo(new.vehiculo_id); exception when others then v_cap := null; end;
  end if;
  if coalesce(new.km_alerta,false) or coalesce(new.alerta_consumo,false)
     or coalesce(new.sin_asignacion,false) or coalesce(new.retroactiva,false)
     or (v_cap is not null and v_cap > 0 and coalesce(new.galones,0) > v_cap) then
    new.revision := 'en_espera';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_combustible_set_revision on sgc.registros_combustible;
create trigger trg_combustible_set_revision
  before insert on sgc.registros_combustible
  for each row execute function sgc.trg_combustible_set_revision();

-- ── (4) Aviso al nacer en_espera → Logística (Raykler) + admin ───────────────
create or replace function sgc.trg_combustible_avisa_por_aprobar()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_placa text;
begin
  if new.revision = 'en_espera' and not coalesce(new.es_prueba,false) then
    select placa into v_placa from sgc.vehiculos where id = new.vehiculo_id;
    perform sgc.notificar_modulo('flota', 'combustible_por_aprobar',
      'Echada por aprobar',
      format('%s: una echada quedó en espera de tu visto bueno. Aprobar o rechazar.',
             coalesce(v_placa, 'Un vehículo')),
      '/flota/combustible-log?revision=en_espera', new.id, 'echada');
  end if;
  return new;
end $fn$;

drop trigger if exists trg_combustible_avisa_por_aprobar on sgc.registros_combustible;
create trigger trg_combustible_avisa_por_aprobar
  after insert on sgc.registros_combustible
  for each row execute function sgc.trg_combustible_avisa_por_aprobar();

-- ── (5) Motivo humano de una echada en espera (para la UI) ──────────────────
create or replace function sgc.echada_motivo_revision(r sgc.registros_combustible)
returns text language sql stable set search_path to 'sgc','pg_temp' as $fn$
  select nullif(btrim(concat_ws(' · ',
    case when coalesce(r.km_alerta,false) then
      format('Salto de %s km desde la última echada (umbral %s)',
             coalesce(r.km_recorridos,0),
             coalesce((select valor::int from sgc.flota_config where clave='umbral_km_echada'), 1000)) end,
    case when coalesce(r.alerta_consumo,false) then coalesce(nullif(r.motivo_alerta,''),'Consumo anormal') end,
    case when coalesce(r.sin_asignacion,false) then 'Registrada sin ser el asignado del vehículo' end,
    case when coalesce(r.retroactiva,false) then 'Registrada con permiso retroactivo' end
  )), '');
$fn$;

-- ── (6) Lista "Por aprobar" (en_espera) para la web/app ─────────────────────
create or replace function sgc.echadas_por_aprobar(p_vehiculo_id uuid default null, p_usuario_id uuid default null)
returns table(
  id uuid, fecha date, created_at timestamptz, vehiculo_id uuid, placa text, vehiculo_label text,
  km_anterior integer, kilometraje integer, km_recorridos integer, galones numeric, monto numeric,
  producto text, estacion text, registrado_por uuid, registrado_nombre text, conductor_nombre text,
  km_alerta boolean, alerta_consumo boolean, sin_asignacion boolean, retroactiva boolean,
  motivo text, foto_recibo_path text, foto_tablero_path text, foto_bomba_path text, reenvio_de uuid
) language sql stable security definer set search_path to 'sgc','pg_temp' as $fn$
  select r.id, r.fecha, r.created_at, r.vehiculo_id, v.placa,
         nullif(btrim(concat_ws(' · ', nullif(v.alias,''), v.placa)),'') as vehiculo_label,
         r.km_anterior, r.kilometraje, r.km_recorridos, r.galones, r.monto,
         r.producto, r.estacion, r.registrado_por, u.nombre, c.nombre,
         coalesce(r.km_alerta,false), coalesce(r.alerta_consumo,false),
         coalesce(r.sin_asignacion,false), coalesce(r.retroactiva,false),
         sgc.echada_motivo_revision(r.*), r.foto_recibo_path, r.foto_tablero_path, r.foto_bomba_path, r.reenvio_de
  from sgc.registros_combustible r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  left join sgc.usuarios u on u.id = r.registrado_por
  left join sgc.conductores c on c.id = r.conductor_id
  where (sgc.is_admin() or sgc.es_flota_elevado())
    and r.revision = 'en_espera' and not coalesce(r.es_prueba,false)
    and (p_vehiculo_id is null or r.vehiculo_id = p_vehiculo_id)
    and (p_usuario_id is null or r.registrado_por = p_usuario_id)
  order by r.created_at asc;
$fn$;
grant execute on function sgc.echadas_por_aprobar(uuid, uuid) to authenticated, service_role;

-- ── (7) Aprobar (con corrección opcional vía editar_echada) ─────────────────
create or replace function sgc.aprobar_echada(p_id uuid, p_nota text default null, p_correccion jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_rol text; v_conductor uuid; v_placa text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo Logística o un administrador pueden aprobar echadas' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.registros_combustible where id = p_id and revision = 'en_espera') then
    raise exception 'Esa echada no está en espera de aprobación' using errcode = '22023';
  end if;
  v_rol := sgc.mi_rol_flota_elevado();
  -- Corrección opcional: reutiliza editar_echada (whitelist + historial + recálculo).
  if p_correccion is not null and p_correccion <> '{}'::jsonb then
    perform sgc.editar_echada(p_id, p_correccion, coalesce(nullif(p_nota,''),'Aprobada con corrección'));
  end if;
  update sgc.registros_combustible
     set revision = 'aprobada', revisada_por = v_uid, revisada_en = now(),
         revision_motivo = nullif(p_nota,''),
         -- resueltas las banderas de aviso al dar el visto bueno:
         km_alerta = false, sin_asignacion = false
   where id = p_id;
  perform sgc.recalcular_estados_combustible();
  -- Aviso al chofer.
  select conductor_id, vehiculo_id into v_conductor from sgc.registros_combustible where id = p_id;
  select placa into v_placa from sgc.vehiculos where id = (select vehiculo_id from sgc.registros_combustible where id = p_id);
  perform sgc.notificar(
    coalesce((select usuario_id from sgc.conductores where id = v_conductor),
             (select registrado_por from sgc.registros_combustible where id = p_id)),
    'combustible_aprobada', 'Tu echada fue aprobada',
    format('%s: tu echada quedó aprobada.', coalesce(v_placa,'Vehículo')),
    '/flota/combustible-log?echada=' || p_id::text);
  return (select to_jsonb(r) from sgc.registros_combustible r where r.id = p_id);
end $fn$;
grant execute on function sgc.aprobar_echada(uuid, text, jsonb) to authenticated;

-- ── (8) Rechazar (invalida + motivo obligatorio; nunca se borra) ────────────
create or replace function sgc.rechazar_echada(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_conductor uuid; v_placa text; v_dest uuid;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo Logística o un administrador pueden rechazar echadas' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo),'') = '' then
    raise exception 'El motivo del rechazo es obligatorio' using errcode = '22023';
  end if;
  if not exists (select 1 from sgc.registros_combustible where id = p_id and revision = 'en_espera') then
    raise exception 'Esa echada no está en espera de aprobación' using errcode = '22023';
  end if;
  update sgc.registros_combustible
     set revision = 'rechazada', invalidada = true, revisada_por = v_uid, revisada_en = now(),
         revision_motivo = btrim(p_motivo)
   where id = p_id;
  perform sgc.recalcular_estados_combustible();
  select conductor_id, vehiculo_id into v_conductor from sgc.registros_combustible where id = p_id;
  select placa into v_placa from sgc.vehiculos where id = (select vehiculo_id from sgc.registros_combustible where id = p_id);
  v_dest := coalesce((select usuario_id from sgc.conductores where id = v_conductor),
                     (select registrado_por from sgc.registros_combustible where id = p_id));
  perform sgc.notificar(v_dest, 'combustible_rechazada', 'Tu echada fue rechazada',
    format('%s: %s. Puedes corregir y reenviarla.', coalesce(v_placa,'Vehículo'), btrim(p_motivo)),
    '/flota/combustible-log?echada=' || p_id::text);
  return (select to_jsonb(r) from sgc.registros_combustible r where r.id = p_id);
end $fn$;
grant execute on function sgc.rechazar_echada(uuid, text) to authenticated;

-- ── (9) Reenviar (chofer): nueva echada corregida, la rechazada queda ───────
create or replace function sgc.reenviar_echada(p_original uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_orig sgc.registros_combustible%rowtype; v_res jsonb; v_new uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_orig from sgc.registros_combustible where id = p_original;
  if not found then raise exception 'Echada original no encontrada'; end if;
  if v_orig.revision <> 'rechazada' then
    raise exception 'Solo se reenvía una echada rechazada' using errcode = '22023';
  end if;
  -- El dueño (chofer) o un elevado pueden reenviar.
  if not (sgc.is_admin() or sgc.es_flota_elevado()
          or v_orig.registrado_por = v_uid
          or exists (select 1 from sgc.conductores c where c.id = v_orig.conductor_id and c.usuario_id = v_uid)) then
    raise exception 'No puedes reenviar esta echada' using errcode = '42501';
  end if;
  -- Reusa el camino normal de registro (recalcula km/rendimiento y vuelve a pasar por el trigger).
  v_res := sgc.registrar_combustible_app(
    gen_random_uuid(),
    coalesce(nullif(p_datos->>'vehiculo_id','')::uuid, v_orig.vehiculo_id),
    v_orig.conductor_id,
    coalesce(nullif(p_datos->>'fecha','')::date, v_orig.fecha),
    coalesce(nullif(p_datos->>'kilometraje','')::int, v_orig.kilometraje),
    coalesce(nullif(p_datos->>'galones','')::numeric, v_orig.galones),
    coalesce(nullif(p_datos->>'monto','')::numeric, v_orig.monto),
    coalesce(nullif(p_datos->>'estacion',''), v_orig.estacion),
    v_orig.foto_recibo_path, v_orig.foto_tablero_path,
    coalesce(nullif(p_datos->>'notas',''), v_orig.notas),
    v_orig.foto_bomba_path, v_orig.producto);
  v_new := nullif(v_res->>'id','')::uuid;
  if v_new is not null then
    update sgc.registros_combustible set reenvio_de = p_original where id = v_new;
  end if;
  return v_res;
end $fn$;
grant execute on function sgc.reenviar_echada(uuid, jsonb) to authenticated;

-- ── (10) recalcular_estados_combustible — EXCLUYE en_espera (no cuenta) ──────
create or replace function sgc.recalcular_estados_combustible()
 returns integer language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_count int := 0; r record;
  v_medida text; v_esperado numeric; v_baseline numeric; v_n int; v_prom numeric;
  v_dist_min numeric; v_piso_c numeric; v_techo_c numeric; v_min_reg int;
  v_estado text; v_motivo text; v_dir text; v_ep boolean;
begin
  if not sgc.es_flota_elevado() then raise exception 'Tu rol no puede recalcular el histórico de combustible' using errcode = '22023'; end if;
  for r in
    select id, vehiculo_id, km_recorridos, galones, rendimiento_km_gal, coalesce(es_prueba,false) as ep
      from sgc.registros_combustible
     where vehiculo_id is not null and not coalesce(invalidada, false)
       and revision <> 'en_espera'                                   -- BY1: en espera no cuenta
     order by vehiculo_id, coalesce(es_prueba,false), kilometraje
  loop
    v_ep := r.ep;
    select coalesce(medida_uso,'km'), rendimiento_esperado_km_gal into v_medida, v_esperado
      from sgc.vehiculos where id = r.vehiculo_id;
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
    select count(*), avg(rendimiento_km_gal) into v_n, v_prom
      from sgc.registros_combustible
     where vehiculo_id = r.vehiculo_id and id <> r.id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_ep
       and not coalesce(invalidada, false)
       and revision <> 'en_espera'                                   -- BY1
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;
    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n >= v_min_reg then v_prom else null end;
    select estado, motivo, direccion into v_estado, v_motivo, v_dir
      from sgc.clasificar_rendimiento(v_medida, r.km_recorridos, r.galones, r.rendimiento_km_gal, v_baseline, true);
    update sgc.registros_combustible
       set estado = v_estado, motivo_alerta = v_motivo, alerta_consumo = (v_estado = 'anormal')
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- ── (11) log_combustible — expone `revision` (la web separa Registro / Por aprobar) ─
drop function if exists sgc.log_combustible(date, date, uuid, uuid);
create function sgc.log_combustible(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_vehiculo_id uuid DEFAULT NULL::uuid, p_usuario_id uuid DEFAULT NULL::uuid)
 returns table(id uuid, fecha date, vehiculo_id uuid, placa text, kilometraje integer, km_anterior integer, km_recorridos integer, galones numeric, monto numeric, producto text, subtipo text, estado text, km_alerta boolean, sin_asignacion boolean, alerta_consumo boolean, revision text, registrado_por uuid, registrado_nombre text, conductor_nombre text, es_prueba boolean, created_at timestamp with time zone)
 language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select
    r.id, r.fecha, r.vehiculo_id, v.placa, r.kilometraje, r.km_anterior, r.km_recorridos,
    r.galones, r.monto, r.producto, r.subtipo, r.estado,
    coalesce(r.km_alerta, false), coalesce(r.sin_asignacion, false), coalesce(r.alerta_consumo, false),
    coalesce(r.revision, 'normal'),
    r.registrado_por, u.nombre, c.nombre, coalesce(r.es_prueba, false), r.created_at
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
grant execute on function sgc.log_combustible(date, date, uuid, uuid) to authenticated;

-- ── (12) Backfill: echadas existentes con bandera, no saneadas, no invalidadas ──
--     → en_espera (para que Raykler las apruebe/rechace). Reporta el conteo.
do $$
declare v_n int;
begin
  update sgc.registros_combustible
     set revision = 'en_espera'
   where revision = 'normal' and not coalesce(es_prueba,false) and not coalesce(invalidada,false)
     and not coalesce(saneada,false)
     and (coalesce(km_alerta,false) or coalesce(alerta_consumo,false)
          or coalesce(sin_asignacion,false) or coalesce(retroactiva,false));
  get diagnostics v_n = row_count;
  raise notice 'BY1 backfill: % echadas → en_espera', v_n;
end $$;

-- ── (13) Cron recordatorio: en espera > 48 h → Raykler + admin ──────────────
create or replace function sgc.recordar_echadas_por_aprobar()
returns integer language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_n int;
begin
  select count(*) into v_n from sgc.registros_combustible
   where revision = 'en_espera' and not coalesce(es_prueba,false)
     and created_at < now() - interval '48 hours';
  if v_n > 0 then
    perform sgc.notificar_modulo('flota', 'combustible_por_aprobar_recordatorio',
      'Echadas por aprobar',
      format('Hay %s echada(s) en espera de aprobación desde hace más de 48 h.', v_n),
      '/flota/combustible-log?revision=en_espera', null, null);
  end if;
  return v_n;
end $fn$;

commit;

-- Cron 07:30 RD = 11:30 UTC (idempotente).
select cron.unschedule('sgc-echadas-por-aprobar')
 where exists (select 1 from cron.job where jobname = 'sgc-echadas-por-aprobar');
select cron.schedule('sgc-echadas-por-aprobar', '30 11 * * *', $$select sgc.recordar_echadas_por_aprobar()$$);
