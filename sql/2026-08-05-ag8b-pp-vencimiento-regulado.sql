-- ============================================================================
-- AG8b — Corrección del modelo de placas provisionales (PP): la PP tiene un
-- VENCIMIENTO REGULADO propio (~3 meses), impreso en la propia placa. Ese es el
-- límite legal (después no puede circular) y es lo que debe disparar el aviso.
-- El "dealer" y los "días prometidos" son variables y solo SEGUIMIENTO de cuándo
-- el dealer entregará la definitiva. Aditivo/retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- Fecha de vencimiento regulada de la PP (la que dice la placa) — dato primario.
alter table sgc.vehiculo_placas_pp add column if not exists fecha_vencimiento_pp date;
-- Días prometidos deja de ser obligatorio (ahora es seguimiento del dealer).
alter table sgc.vehiculo_placas_pp alter column dias_prometidos drop not null;
-- Fecha en que el dealer prometió entregar la definitiva (seguimiento, opcional).
alter table sgc.vehiculo_placas_pp add column if not exists fecha_entrega_prometida date;

-- Vigencia regulada por defecto (días) para pre-cargar la fecha si no la escriben.
insert into sgc.flota_config (clave, valor) values ('pp_vigencia_dias_default', 90)
on conflict (clave) do nothing;
-- Más margen de aviso para un vencimiento legal (antes 5 → 15 días).
update sgc.flota_config set valor = 15 where clave = 'umbral_por_vencer_placa_pp' and valor = 5;

-- ── crear_placa_pp: ahora primaria la fecha de vencimiento de la PP ─────────
drop function if exists sgc.crear_placa_pp(uuid, text, text, int, date, text);
create or replace function sgc.crear_placa_pp(
  p_vehiculo_id uuid,
  p_dealer text default null,
  p_placa_pp text default null,
  p_fecha_vencimiento date default null,   -- la que dice la placa (primaria)
  p_dias int default null,                  -- fallback si no dan la fecha
  p_fecha_registro date default current_date,
  p_fecha_entrega_prometida date default null,
  p_notas text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_id uuid; v_venc date; v_reg date; v_default int;
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado'; end if;
  v_reg := coalesce(p_fecha_registro, current_date);
  select coalesce(valor,90) into v_default from sgc.flota_config where clave='pp_vigencia_dias_default';
  -- Determinar el vencimiento: la fecha de la placa manda; si no, registro + días
  -- (del dealer o el default regulado).
  if p_fecha_vencimiento is not null then
    v_venc := p_fecha_vencimiento;
  elsif p_dias is not null then
    v_venc := v_reg + p_dias;
  else
    v_venc := v_reg + coalesce(v_default,90);
  end if;
  insert into sgc.vehiculo_placas_pp
    (vehiculo_id, dealer, placa_pp, fecha_registro, dias_prometidos, fecha_limite,
     fecha_vencimiento_pp, fecha_entrega_prometida, notas, created_by)
  values
    (p_vehiculo_id, nullif(trim(p_dealer),''), nullif(trim(p_placa_pp),''), v_reg,
     p_dias, v_venc, v_venc, p_fecha_entrega_prometida, nullif(trim(p_notas),''), auth.uid())
  returning id into v_id;
  perform sgc.evaluar_avisos_placas_pp(v_id);
  return v_id;
end;
$function$;
grant execute on function sgc.crear_placa_pp(uuid, text, text, date, int, date, date, text) to authenticated;

-- ── ampliar_placa_pp: extiende el vencimiento regulado (renovación de la PP) ──
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
  select coalesce(fecha_vencimiento_pp, fecha_limite) into v_ant
    from sgc.vehiculo_placas_pp where id=p_id and estado <> 'entregada';
  if v_ant is null then raise exception 'Proceso de placa PP no encontrado o ya entregado'; end if;
  v_nueva := greatest(v_ant, current_date) + p_dias_nuevos;
  update sgc.vehiculo_placas_pp
    set fecha_limite=v_nueva, fecha_vencimiento_pp=v_nueva, estado='pendiente', updated_at=now()
    where id=p_id;
  insert into sgc.vehiculo_placa_pp_extensiones (placa_pp_id, dias_agregados, fecha_limite_anterior, fecha_limite_nueva, motivo, created_by)
  values (p_id, p_dias_nuevos, v_ant, v_nueva, nullif(trim(p_motivo),''), auth.uid());
  perform sgc.evaluar_avisos_placas_pp(p_id);
end;
$function$;
grant execute on function sgc.ampliar_placa_pp(uuid, int, text) to authenticated;

-- ── sweep: usar el vencimiento regulado (coalesce con fecha_limite legacy) ────
create or replace function sgc.evaluar_avisos_placas_pp(p_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  r record; v_umbral int; v_dias int; v_tipo text; v_sev text; v_msg text;
  v_dedup text; v_prev sgc.avisos_flota; v_notify boolean; v_uid uuid; v_venc date;
begin
  select coalesce(valor,15) into v_umbral from sgc.flota_config where clave='umbral_por_vencer_placa_pp';
  v_umbral := coalesce(v_umbral,15);

  for r in
    select pp.id, pp.vehiculo_id, pp.estado,
           coalesce(pp.fecha_vencimiento_pp, pp.fecha_limite) as venc, pp.placa_pp, v.placa
    from sgc.vehiculo_placas_pp pp
    join sgc.vehiculos v on v.id = pp.vehiculo_id
    where (p_id is null or pp.id = p_id)
  loop
    v_dedup := 'pp:'||r.id::text;
    v_venc := r.venc;

    if r.estado = 'entregada' then
      update sgc.avisos_flota set estado='resuelto_auto', resuelto_at=now(),
             resuelto_nota=coalesce(resuelto_nota,'Placa definitiva entregada')
        where dedup_key=v_dedup and estado='pendiente';
      continue;
    end if;

    v_dias := v_venc - current_date;

    if v_dias < 0 and r.estado <> 'vencida' then
      update sgc.vehiculo_placas_pp set estado='vencida', updated_at=now() where id=r.id;
    end if;

    if v_dias > v_umbral then
      update sgc.avisos_flota set estado='resuelto_auto', resuelto_at=now(),
             resuelto_nota=coalesce(resuelto_nota,'Plazo ampliado / aún con margen')
        where dedup_key=v_dedup and estado='pendiente';
      continue;
    end if;

    if v_dias < 0 then
      v_tipo := 'pp_vencida'; v_sev := 'alta';
      v_msg := format('Placa provisional de %s VENCIDA el %s (plazo regulado). El vehículo NO puede circular hasta tener la placa definitiva.',
                      r.placa, to_char(v_venc,'DD/MM/YYYY'));
    else
      v_tipo := 'pp_por_vencer'; v_sev := 'media';
      v_msg := format('Placa provisional de %s vence en %s día(s) (%s, plazo regulado). Gestionar la placa definitiva con el dealer.',
                      r.placa, v_dias, to_char(v_venc,'DD/MM/YYYY'));
    end if;

    select * into v_prev from sgc.avisos_flota where dedup_key=v_dedup limit 1;
    v_notify := (v_prev.id is null) or (v_prev.estado='resuelto_auto')
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

-- ── Corrige el registro del Kia K2700: vencimiento regulado ~3 meses ─────────
-- (placeholder desde la fecha de registro; Xaviel confirma la fecha impresa real).
update sgc.vehiculo_placas_pp
  set fecha_vencimiento_pp = fecha_registro + 90,
      fecha_limite = fecha_registro + 90,
      dias_prometidos = null,
      notas = 'Carga inicial AG8. Vencimiento regulado ~3 meses (placeholder); confirmar la fecha impresa en la placa.'
  where vehiculo_id = '759cb234-0d2a-489e-a987-fe777f1af0ad' and estado <> 'entregada';

select sgc.evaluar_avisos_placas_pp(null);
