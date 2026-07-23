-- ============================================================================
-- X1/X2 — Avisos de vencimiento: "vencida" ≠ "por vencer" + auto-resolución +
-- Historial. Consolida la generación (antes client-side por día) en un SWEEP
-- server-side con dedup ESTABLE por entidad+documento, tipos separados, umbral
-- configurable y auto-resolución (resuelto_auto). Aditivo/retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- ── Schema aditivo ──────────────────────────────────────────────────────────
alter table sgc.avisos_flota add column if not exists resuelto_at   timestamptz;
alter table sgc.avisos_flota add column if not exists resuelto_nota text;

-- estado: + 'resuelto_auto'
alter table sgc.avisos_flota drop constraint if exists avisos_flota_estado_chk;
alter table sgc.avisos_flota add  constraint avisos_flota_estado_chk
  check (estado = any (array['pendiente','atendido','resuelto_auto']));

-- tipo: + los 6 tipos separados por-vencer/vencida (se conservan los viejos).
alter table sgc.avisos_flota drop constraint if exists avisos_flota_tipo_chk;
alter table sgc.avisos_flota add  constraint avisos_flota_tipo_chk
  check (tipo = any (array[
    'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido','consumo_anormal',
    'licencia','matricula','seguro','reporte_semanal','conciliacion',
    'licencia_por_vencer','licencia_vencida',
    'matricula_por_vencer','matricula_vencida',
    'seguro_por_vencer','seguro_vencida']));

-- Umbral "por vencer" configurable por tipo de documento (default 30 días).
insert into sgc.flota_config (clave, valor)
select v.clave, 30 from (values
  ('umbral_por_vencer_licencia'),('umbral_por_vencer_matricula'),('umbral_por_vencer_seguro')
) v(clave)
on conflict (clave) do nothing;

-- ── Sweep unificado de vencimientos ─────────────────────────────────────────
-- Dedup estable `venc:{base}:{entidad}` → UNA fila por documento que transiciona
-- en el sitio (por_vencer → vencida) y se auto-resuelve al renovarse. Si se pasa
-- una entidad, evalúa solo esa (para triggers); sin args, barrido completo.
create or replace function sgc.evaluar_avisos_vencimiento(
  p_vehiculo_id uuid default null,
  p_conductor_id uuid default null
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  r record;
  v_dias int;
  v_umbral int;
  v_base text;
  v_tipo text;
  v_sev text;
  v_msg text;
  v_dedup text;
  v_scoped boolean := (p_vehiculo_id is not null or p_conductor_id is not null);
begin
  -- ---- LICENCIAS (conductores) ----
  if not v_scoped or p_conductor_id is not null then
    select coalesce(valor,30) into v_umbral from sgc.flota_config where clave='umbral_por_vencer_licencia';
    v_umbral := coalesce(v_umbral,30);
    for r in
      select c.id, c.nombre, c.licencia_vencimiento, coalesce(c.activo,true) as activo
      from sgc.conductores c
      where (p_conductor_id is null or c.id = p_conductor_id)
    loop
      v_dedup := 'venc:licencia:'||r.id::text;
      if r.activo and r.licencia_vencimiento is not null
         and (r.licencia_vencimiento - current_date) <= v_umbral then
        v_dias := r.licencia_vencimiento - current_date;
        if v_dias < 0 then
          v_tipo := 'licencia_vencida'; v_sev := 'alta';
          v_msg := format('Licencia de %s VENCIDA (venció %s). No puede operar.', r.nombre, to_char(r.licencia_vencimiento,'DD/MM/YYYY'));
        else
          v_tipo := 'licencia_por_vencer'; v_sev := 'media';
          v_msg := format('Licencia de %s por vencer en %s día(s) (%s).', r.nombre, v_dias, to_char(r.licencia_vencimiento,'DD/MM/YYYY'));
        end if;
        insert into sgc.avisos_flota (tipo, conductor_id, mensaje, severidad, estado, dedup_key)
        values (v_tipo, r.id, v_msg, v_sev, 'pendiente', v_dedup)
        on conflict (dedup_key) do update
          set tipo = excluded.tipo, mensaje = excluded.mensaje, severidad = excluded.severidad,
              -- re-abrir solo si estaba auto-resuelto; respetar 'atendido' manual.
              estado = case when sgc.avisos_flota.estado = 'resuelto_auto' then 'pendiente' else sgc.avisos_flota.estado end,
              resuelto_at = case when sgc.avisos_flota.estado = 'resuelto_auto' then null else sgc.avisos_flota.resuelto_at end;
      else
        -- Condición ya no aplica → auto-resolver el activo.
        update sgc.avisos_flota
          set estado='resuelto_auto', resuelto_at=now(),
              resuelto_nota = coalesce(resuelto_nota,
                case when r.licencia_vencimiento is not null
                     then 'Licencia actualizada, vence '||to_char(r.licencia_vencimiento,'DD/MM/YYYY')
                     else 'Condición resuelta' end)
          where dedup_key = v_dedup and estado in ('pendiente');
      end if;
    end loop;
  end if;

  -- ---- MATRÍCULA + SEGURO (vehículos) ----
  if not v_scoped or p_vehiculo_id is not null then
    for r in
      select v.id, v.placa, v.vencimiento_matricula, v.vencimiento_seguro, coalesce(v.activo,true) as activo
      from sgc.vehiculos v
      where (p_vehiculo_id is null or v.id = p_vehiculo_id)
    loop
      -- iterar los dos documentos del vehículo
      for v_base in select unnest(array['matricula','seguro']) loop
        v_dedup := 'venc:'||v_base||':'||r.id::text;
        select coalesce(valor,30) into v_umbral from sgc.flota_config where clave='umbral_por_vencer_'||v_base;
        v_umbral := coalesce(v_umbral,30);
        declare v_fecha date := case v_base when 'matricula' then r.vencimiento_matricula else r.vencimiento_seguro end;
                v_label text := case v_base when 'matricula' then 'Matrícula' else 'Seguro' end;
        begin
          if r.activo and v_fecha is not null and (v_fecha - current_date) <= v_umbral then
            v_dias := v_fecha - current_date;
            if v_dias < 0 then
              v_tipo := v_base||'_vencida'; v_sev := 'alta';
              v_msg := format('%s de %s VENCIDA (venció %s).', v_label, r.placa, to_char(v_fecha,'DD/MM/YYYY'));
            else
              v_tipo := v_base||'_por_vencer'; v_sev := 'media';
              v_msg := format('%s de %s por vencer en %s día(s) (%s).', v_label, r.placa, v_dias, to_char(v_fecha,'DD/MM/YYYY'));
            end if;
            insert into sgc.avisos_flota (tipo, vehiculo_id, mensaje, severidad, estado, dedup_key)
            values (v_tipo, r.id, v_msg, v_sev, 'pendiente', v_dedup)
            on conflict (dedup_key) do update
              set tipo = excluded.tipo, mensaje = excluded.mensaje, severidad = excluded.severidad,
                  estado = case when sgc.avisos_flota.estado = 'resuelto_auto' then 'pendiente' else sgc.avisos_flota.estado end,
                  resuelto_at = case when sgc.avisos_flota.estado = 'resuelto_auto' then null else sgc.avisos_flota.resuelto_at end;
          else
            update sgc.avisos_flota
              set estado='resuelto_auto', resuelto_at=now(),
                  resuelto_nota = coalesce(resuelto_nota,
                    case when v_fecha is not null
                         then v_label||' actualizado, vence '||to_char(v_fecha,'DD/MM/YYYY')
                         else 'Condición resuelta' end)
              where dedup_key = v_dedup and estado in ('pendiente');
          end if;
        end;
      end loop;
    end loop;
  end if;
end;
$function$;

grant execute on function sgc.evaluar_avisos_vencimiento(uuid, uuid) to authenticated, service_role;

-- ── Trigger de auto-resolución en conductores (licencia) ────────────────────
create or replace function sgc.tg_conductor_venc() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  perform sgc.evaluar_avisos_vencimiento(null, NEW.id);
  return NEW;
end; $function$;

drop trigger if exists trg_conductor_venc on sgc.conductores;
create trigger trg_conductor_venc
  after insert or update of licencia_vencimiento, activo on sgc.conductores
  for each row execute function sgc.tg_conductor_venc();

-- ── reevaluar_vencimiento_vehiculo: conserva el gating no_disponible pero delega
--    los avisos al sweep unificado (evita duplicar con los docvenc: viejos). ────
create or replace function sgc.reevaluar_vencimiento_vehiculo(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v         sgc.vehiculos;
  mat_venc  boolean;
  seg_venc  boolean;
begin
  select * into v from sgc.vehiculos where id = p_id;
  if not found or not coalesce(v.activo, true) or coalesce(v.estado,'activo') = 'baja' then
    return;
  end if;

  mat_venc := v.vencimiento_matricula is not null and v.vencimiento_matricula < current_date;
  seg_venc := v.vencimiento_seguro    is not null and v.vencimiento_seguro    < current_date;

  -- Avisos de vencimiento: los gestiona el sweep unificado (X1/X2).
  perform sgc.evaluar_avisos_vencimiento(p_id, null);

  -- Estado del vehículo (gating por documentos vencidos).
  if (mat_venc or seg_venc) and coalesce(v.estado,'activo') <> 'no_disponible' then
    update sgc.vehiculos set estado='no_disponible', updated_at=now() where id=p_id;
  elsif not mat_venc and not seg_venc and coalesce(v.estado,'') = 'no_disponible' then
    -- Reactiva si ya no hay documentos vencidos (antes dependía de avisos docvenc).
    update sgc.vehiculos set estado='activo', updated_at=now() where id=p_id;
  end if;
end;
$function$;

-- ── Limpieza de avisos legacy para no duplicar con el nuevo esquema `venc:` ──
-- Los per-día ('licencia'/'matricula'/'seguro' con dedup tipo:id:fecha) y los
-- docvenc: pendientes se pasan a historial (resuelto_auto); el sweep crea los
-- nuevos venc: con tipos separados.
update sgc.avisos_flota
  set estado='resuelto_auto', resuelto_at=now(),
      resuelto_nota=coalesce(resuelto_nota,'Reemplazado por el nuevo esquema de vencimientos')
where estado='pendiente'
  and tipo in ('licencia','matricula','seguro')
  and (dedup_key is null or dedup_key not like 'venc:%');

-- ── Barrido inicial: genera los avisos venc: con el esquema nuevo ───────────
select sgc.evaluar_avisos_vencimiento(null, null);

-- ── X1b — set del umbral "por vencer" (admin/elevado). Aplica a los 3 documentos. ──
create or replace function sgc.set_umbral_por_vencer(p_dias int)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'El umbral debe estar entre 1 y 365 días';
  end if;
  insert into sgc.flota_config (clave, valor) values
    ('umbral_por_vencer_licencia', p_dias),
    ('umbral_por_vencer_matricula', p_dias),
    ('umbral_por_vencer_seguro', p_dias)
  on conflict (clave) do update set valor = excluded.valor;
  -- Re-evaluar de inmediato con el nuevo umbral.
  perform sgc.evaluar_avisos_vencimiento(null, null);
end;
$function$;

grant execute on function sgc.set_umbral_por_vencer(int) to authenticated;
