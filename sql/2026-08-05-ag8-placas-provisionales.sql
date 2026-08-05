-- ============================================================================
-- AG8 — Placas provisionales (PP) + marbete DGII: registro, conteo de días,
-- extensiones e historial, avisos persistentes (patrón Y17) con push a admin/
-- jefe de flota. Aditivo/retrocompatible.
--
-- Un vehículo entra con placa PP (provisional); el dealer promete la definitiva
-- en N días (variable: 15/20/30/45). Al cumplirse el plazo (y 5 días antes) el
-- sistema avisa; el aviso permite: entregar (registra placa definitiva + marbete
-- DGII juntos), ampliar plazo, o marcar aún pendiente.
-- ============================================================================

set search_path = sgc, public;

-- ── Tabla: proceso de placa provisional por vehículo ────────────────────────
create table if not exists sgc.vehiculo_placas_pp (
  id               uuid primary key default gen_random_uuid(),
  vehiculo_id      uuid not null references sgc.vehiculos(id) on delete cascade,
  dealer           text,
  placa_pp         text,
  fecha_registro   date not null default current_date,
  dias_prometidos  int  not null check (dias_prometidos between 1 and 365),
  fecha_limite     date not null,
  estado           text not null default 'pendiente'
                     check (estado in ('pendiente','entregada','vencida')),
  -- Al entregarse: placa definitiva + marbete DGII (juntos).
  placa_definitiva text,
  marbete_dgii     boolean not null default false,
  marbete_numero   text,
  fecha_entrega    date,
  notas            text,
  created_by       uuid references sgc.usuarios(id),
  es_prueba        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Un solo proceso PP ACTIVO (no entregado) por vehículo.
create unique index if not exists uq_placas_pp_activo
  on sgc.vehiculo_placas_pp (vehiculo_id)
  where estado <> 'entregada';

create index if not exists idx_placas_pp_vehiculo on sgc.vehiculo_placas_pp (vehiculo_id);
create index if not exists idx_placas_pp_estado   on sgc.vehiculo_placas_pp (estado);

-- ── Tabla: historial de extensiones de plazo ────────────────────────────────
create table if not exists sgc.vehiculo_placa_pp_extensiones (
  id                     uuid primary key default gen_random_uuid(),
  placa_pp_id            uuid not null references sgc.vehiculo_placas_pp(id) on delete cascade,
  dias_agregados         int not null,
  fecha_limite_anterior  date,
  fecha_limite_nueva     date not null,
  motivo                 text,
  created_by             uuid references sgc.usuarios(id),
  created_at             timestamptz not null default now()
);
create index if not exists idx_placa_pp_ext_pp on sgc.vehiculo_placa_pp_extensiones (placa_pp_id);

-- ── RLS: mismo criterio que avisos_flota (flota elevado; admin ve todo) ──────
alter table sgc.vehiculo_placas_pp            enable row level security;
alter table sgc.vehiculo_placa_pp_extensiones enable row level security;

drop policy if exists placas_pp_all on sgc.vehiculo_placas_pp;
create policy placas_pp_all on sgc.vehiculo_placas_pp
  for all using (sgc.es_flota_elevado()) with check (sgc.es_flota_elevado());
drop policy if exists "placas_pp es_prueba" on sgc.vehiculo_placas_pp;
create policy "placas_pp es_prueba" on sgc.vehiculo_placas_pp
  for select using ((not es_prueba) or sgc.is_admin());

drop policy if exists placa_pp_ext_all on sgc.vehiculo_placa_pp_extensiones;
create policy placa_pp_ext_all on sgc.vehiculo_placa_pp_extensiones
  for all using (sgc.es_flota_elevado()) with check (sgc.es_flota_elevado());

grant select, insert, update, delete on sgc.vehiculo_placas_pp            to authenticated;
grant select, insert, update, delete on sgc.vehiculo_placa_pp_extensiones to authenticated;

-- Umbral "por vencer" para placas PP (default 5 días — asunción I, confirmable).
insert into sgc.flota_config (clave, valor) values ('umbral_por_vencer_placa_pp', 5)
on conflict (clave) do nothing;

-- ── avisos_flota: + tipos pp_por_vencer / pp_vencida ────────────────────────
alter table sgc.avisos_flota drop constraint if exists avisos_flota_tipo_chk;
alter table sgc.avisos_flota add  constraint avisos_flota_tipo_chk
  check (tipo = any (array[
    'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido','consumo_anormal',
    'licencia','matricula','seguro','reporte_semanal','conciliacion',
    'licencia_por_vencer','licencia_vencida',
    'matricula_por_vencer','matricula_vencida',
    'seguro_por_vencer','seguro_vencida',
    'pp_por_vencer','pp_vencida']));

-- ── Helper: ids de admin + jefe de flota (destinatarios de push) ─────────────
create or replace function sgc.destinatarios_flota()
returns setof uuid
language sql stable
set search_path to 'sgc','pg_temp'
as $$
  select distinct u.id
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo,true)
    and ('flota' = any(r.modulos) or 'admin' = any(r.modulos));
$$;
grant execute on function sgc.destinatarios_flota() to authenticated, service_role;

-- ── Sweep de avisos PP (patrón Y17: persistente, dedup estable, auto-resuelve,
--    push controlado sólo al crear/escalar). ─────────────────────────────────
create or replace function sgc.evaluar_avisos_placas_pp(p_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  r        record;
  v_umbral int;
  v_dias   int;
  v_tipo   text;
  v_sev    text;
  v_msg    text;
  v_dedup  text;
  v_prev   sgc.avisos_flota;
  v_notify boolean;
  v_uid    uuid;
begin
  select coalesce(valor,5) into v_umbral from sgc.flota_config where clave='umbral_por_vencer_placa_pp';
  v_umbral := coalesce(v_umbral,5);

  for r in
    select pp.id, pp.vehiculo_id, pp.estado, pp.fecha_limite, pp.placa_pp, v.placa
    from sgc.vehiculo_placas_pp pp
    join sgc.vehiculos v on v.id = pp.vehiculo_id
    where (p_id is null or pp.id = p_id)
  loop
    v_dedup := 'pp:'||r.id::text;

    if r.estado = 'entregada' then
      -- Condición resuelta → auto-resolver el aviso activo.
      update sgc.avisos_flota
        set estado='resuelto_auto', resuelto_at=now(),
            resuelto_nota=coalesce(resuelto_nota,'Placa definitiva entregada')
        where dedup_key=v_dedup and estado='pendiente';
      continue;
    end if;

    v_dias := r.fecha_limite - current_date;

    -- Mantener el estado del proceso coherente (vencida cuando pasó el plazo).
    if v_dias < 0 and r.estado <> 'vencida' then
      update sgc.vehiculo_placas_pp set estado='vencida', updated_at=now() where id=r.id;
    end if;

    if v_dias > v_umbral then
      -- Todavía lejos del plazo: no hay aviso; limpiar uno viejo si existía.
      update sgc.avisos_flota
        set estado='resuelto_auto', resuelto_at=now(),
            resuelto_nota=coalesce(resuelto_nota,'Plazo ampliado / aún con margen')
        where dedup_key=v_dedup and estado='pendiente';
      continue;
    end if;

    if v_dias < 0 then
      v_tipo := 'pp_vencida'; v_sev := 'alta';
      v_msg := format('Placa provisional de %s VENCIDA (el dealer debía entregar la definitiva el %s). Gestionar con el dealer.',
                      r.placa, to_char(r.fecha_limite,'DD/MM/YYYY'));
    else
      v_tipo := 'pp_por_vencer'; v_sev := 'media';
      v_msg := format('Placa provisional de %s por vencer en %s día(s) (%s).',
                      r.placa, v_dias, to_char(r.fecha_limite,'DD/MM/YYYY'));
    end if;

    select * into v_prev from sgc.avisos_flota where dedup_key=v_dedup limit 1;
    -- Notificar sólo si es nuevo, si reabre (resuelto_auto) o si escaló a vencida.
    v_notify := (v_prev.id is null)
                or (v_prev.estado='resuelto_auto')
                or (v_prev.tipo='pp_por_vencer' and v_tipo='pp_vencida');

    insert into sgc.avisos_flota (tipo, vehiculo_id, referencia_id, mensaje, severidad, estado, dedup_key)
    values (v_tipo, r.vehiculo_id, r.id, v_msg, v_sev, 'pendiente', v_dedup)
    on conflict (dedup_key) do update
      set tipo=excluded.tipo, mensaje=excluded.mensaje, severidad=excluded.severidad,
          referencia_id=excluded.referencia_id,
          estado = case when sgc.avisos_flota.estado='resuelto_auto' then 'pendiente' else sgc.avisos_flota.estado end,
          resuelto_at = case when sgc.avisos_flota.estado='resuelto_auto' then null else sgc.avisos_flota.resuelto_at end;

    if v_notify then
      for v_uid in select sgc.destinatarios_flota() loop
        perform sgc.notificar(v_uid, case when v_sev='alta' then 'warning' else 'info' end,
                              case when v_tipo='pp_vencida' then 'Placa PP vencida' else 'Placa PP por vencer' end,
                              v_msg, '/flota/vehiculos/'||r.vehiculo_id::text);
      end loop;
    end if;
  end loop;
end;
$function$;
grant execute on function sgc.evaluar_avisos_placas_pp(uuid) to authenticated, service_role;

-- ── RPC: registrar una placa provisional ────────────────────────────────────
create or replace function sgc.crear_placa_pp(
  p_vehiculo_id uuid,
  p_dealer text,
  p_placa_pp text,
  p_dias int,
  p_fecha_registro date default current_date,
  p_notas text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_id uuid; v_limite date;
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'Los días prometidos deben estar entre 1 y 365';
  end if;
  v_limite := coalesce(p_fecha_registro, current_date) + p_dias;
  insert into sgc.vehiculo_placas_pp (vehiculo_id, dealer, placa_pp, fecha_registro, dias_prometidos, fecha_limite, notas, created_by)
  values (p_vehiculo_id, nullif(trim(p_dealer),''), nullif(trim(p_placa_pp),''),
          coalesce(p_fecha_registro, current_date), p_dias, v_limite, nullif(trim(p_notas),''), auth.uid())
  returning id into v_id;
  perform sgc.evaluar_avisos_placas_pp(v_id);
  return v_id;
end;
$function$;
grant execute on function sgc.crear_placa_pp(uuid, text, text, int, date, text) to authenticated;

-- ── RPC: ampliar plazo (re-agenda + historial) ──────────────────────────────
create or replace function sgc.ampliar_placa_pp(
  p_id uuid,
  p_dias_nuevos int,
  p_motivo text default null
) returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_ant date; v_nueva date;
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado'; end if;
  if p_dias_nuevos is null or p_dias_nuevos < 1 or p_dias_nuevos > 365 then
    raise exception 'Los días a ampliar deben estar entre 1 y 365';
  end if;
  select fecha_limite into v_ant from sgc.vehiculo_placas_pp where id=p_id and estado <> 'entregada';
  if v_ant is null then raise exception 'Proceso de placa PP no encontrado o ya entregado'; end if;
  -- Re-agenda desde la mayor entre hoy y el plazo actual (evita plazos en el pasado).
  v_nueva := greatest(v_ant, current_date) + p_dias_nuevos;
  update sgc.vehiculo_placas_pp
    set fecha_limite=v_nueva, dias_prometidos=dias_prometidos + p_dias_nuevos,
        estado='pendiente', updated_at=now()
    where id=p_id;
  insert into sgc.vehiculo_placa_pp_extensiones (placa_pp_id, dias_agregados, fecha_limite_anterior, fecha_limite_nueva, motivo, created_by)
  values (p_id, p_dias_nuevos, v_ant, v_nueva, nullif(trim(p_motivo),''), auth.uid());
  perform sgc.evaluar_avisos_placas_pp(p_id);
end;
$function$;
grant execute on function sgc.ampliar_placa_pp(uuid, int, text) to authenticated;

-- ── RPC: entregar (placa definitiva + marbete DGII juntos) ───────────────────
create or replace function sgc.entregar_placa_pp(
  p_id uuid,
  p_placa_definitiva text,
  p_marbete boolean default true,
  p_marbete_numero text default null,
  p_fecha_entrega date default current_date,
  p_actualizar_vehiculo boolean default true
) returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_veh uuid;
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_placa_definitiva),'') = '' then
    raise exception 'Debes indicar la placa definitiva';
  end if;
  update sgc.vehiculo_placas_pp
    set estado='entregada', placa_definitiva=trim(p_placa_definitiva),
        marbete_dgii=coalesce(p_marbete,true), marbete_numero=nullif(trim(p_marbete_numero),''),
        fecha_entrega=coalesce(p_fecha_entrega,current_date), updated_at=now()
    where id=p_id
    returning vehiculo_id into v_veh;
  if v_veh is null then raise exception 'Proceso de placa PP no encontrado'; end if;
  -- Reemplaza la placa provisional por la definitiva en el vehículo.
  if coalesce(p_actualizar_vehiculo,true) then
    update sgc.vehiculos set placa=trim(p_placa_definitiva), updated_at=now() where id=v_veh;
  end if;
  perform sgc.evaluar_avisos_placas_pp(p_id);
end;
$function$;
grant execute on function sgc.entregar_placa_pp(uuid, text, boolean, text, date, boolean) to authenticated;

-- ── Cron diario: barrer los avisos PP (no había cron para vencimientos) ──────
select cron.schedule('sgc-placas-pp-sweep', '15 6 * * *', $$select sgc.evaluar_avisos_placas_pp(null);$$)
where not exists (select 1 from cron.job where jobname='sgc-placas-pp-sweep');

-- Barrido inicial.
select sgc.evaluar_avisos_placas_pp(null);
