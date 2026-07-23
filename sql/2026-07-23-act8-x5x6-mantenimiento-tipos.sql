-- ============================================================================
-- X5/X6 — Visitas a taller tipificadas + km_ultimo_mantenimiento alimentado.
-- 4 tipos fijos: preventivo | falla | accidente_dano | cambio_pieza.
-- Solo el PREVENTIVO (o una visita marcada "incluyó preventivo") reinicia el
-- ciclo de mantenimiento; km_ultimo_mantenimiento nunca retrocede. Aditivo.
-- ============================================================================

set search_path = sgc, public;

-- ── Migrar el vocabulario existente al de 4 tipos fijos ─────────────────────
-- Histórico: correctivo/emergencia = reparación por falla; preventivo se queda.
update sgc.mantenimientos set tipo = 'falla'
  where tipo in ('correctivo','emergencia');
update sgc.mantenimientos set tipo = 'preventivo'
  where tipo is null or tipo not in ('preventivo','falla','accidente_dano','cambio_pieza');

alter table sgc.mantenimientos alter column tipo set default 'preventivo';
alter table sgc.mantenimientos drop constraint if exists mantenimientos_tipo_chk;
alter table sgc.mantenimientos add  constraint mantenimientos_tipo_chk
  check (tipo = any (array['preventivo','falla','accidente_dano','cambio_pieza']));

-- ── Columnas aditivas ───────────────────────────────────────────────────────
-- Checkbox "también se hizo mantenimiento preventivo" (para visitas no-preventivas).
alter table sgc.mantenimientos add column if not exists incluye_preventivo boolean not null default false;
-- Referencia opcional al accidente vinculado (para tipo accidente_dano).
alter table sgc.mantenimientos add column if not exists accidente_id uuid references sgc.vehiculo_accidentes(id) on delete set null;

-- ── km_ultimo_mantenimiento vía trigger (centraliza todas las vías de escritura) ──
-- Solo PREVENTIVO (o incluye_preventivo) reinicia el ciclo, y nunca retrocede.
create or replace function sgc.tg_mant_km_ultimo() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if NEW.estado = 'completado'
     and (NEW.tipo = 'preventivo' or coalesce(NEW.incluye_preventivo, false))
     and NEW.kilometraje_al_mantenimiento is not null then
    -- X5 — tomar el más reciente (mayor km); no pisar con retroactivos menores.
    update sgc.vehiculos
       set km_ultimo_mantenimiento = greatest(coalesce(km_ultimo_mantenimiento, 0), NEW.kilometraje_al_mantenimiento::int),
           updated_at = now()
     where id = NEW.vehiculo_id
       and coalesce(km_ultimo_mantenimiento, 0) < NEW.kilometraje_al_mantenimiento::int;

    -- X2 — auto-resolver los avisos de mantenimiento pendientes del vehículo.
    update sgc.avisos_flota
       set estado='resuelto_auto', resuelto_at=now(),
           resuelto_nota=coalesce(resuelto_nota, 'Mantenimiento preventivo registrado a '||NEW.kilometraje_al_mantenimiento||' km')
     where vehiculo_id = NEW.vehiculo_id and estado='pendiente'
       and tipo in ('mantenimiento_vencido','pre_cita');
  end if;
  return NEW;
end; $function$;

drop trigger if exists trg_mant_km_ultimo on sgc.mantenimientos;
create trigger trg_mant_km_ultimo
  after insert or update of estado, kilometraje_al_mantenimiento, tipo, incluye_preventivo on sgc.mantenimientos
  for each row execute function sgc.tg_mant_km_ultimo();

-- ── completar_mantenimiento: el km_ultimo lo maneja el trigger; aquí solo
--    estado + odómetro (sin actualización incondicional ni gate duplicado). ──
create or replace function sgc.completar_mantenimiento(p_id uuid, p_km integer default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_veh uuid; v_km int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then raise exception 'No autorizado'; end if;

  select vehiculo_id, coalesce(p_km, kilometraje_al_mantenimiento)
    into v_veh, v_km
  from sgc.mantenimientos where id = p_id;
  if v_veh is null then raise exception 'Mantenimiento no encontrado'; end if;

  -- Al pasar a 'completado' el trigger trg_mant_km_ultimo actualiza el ciclo
  -- (solo si es preventivo/incluye_preventivo) y auto-resuelve los avisos.
  update sgc.mantenimientos
     set estado = 'completado',
         kilometraje_al_mantenimiento = coalesce(p_km, kilometraje_al_mantenimiento)
   where id = p_id;

  -- P7 — el km del mantenimiento avanza el odómetro real (no retrocede).
  if v_km is not null then
    perform sgc.avanzar_odometro(v_veh, v_km);
  end if;
end; $function$;

-- ── crear_mantenimiento_app: default tipo → preventivo; valida los 4 tipos ──
-- Se agregan 2 params con DEFAULT → hay que eliminar el overload de 8 args para
-- no dejar la función ambigua. El nuevo (10 args) acepta las llamadas viejas.
drop function if exists sgc.crear_mantenimiento_app(
  uuid, uuid, text, text, date, numeric, jsonb, timestamp with time zone);

create or replace function sgc.crear_mantenimiento_app(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text, p_fecha date,
  p_km numeric, p_fotos jsonb, p_capturado_en timestamp with time zone,
  p_incluye_preventivo boolean default false, p_accidente_id uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_tipo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.mantenimientos where id = p_id) then
    return p_id;  -- idempotente
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  v_tipo := lower(coalesce(nullif(p_tipo,''),'preventivo'));
  if v_tipo not in ('preventivo','falla','accidente_dano','cambio_pieza') then
    v_tipo := 'preventivo';
  end if;

  insert into sgc.mantenimientos (id, vehiculo_id, tipo, descripcion, fecha,
    kilometraje_al_mantenimiento, estado, fotos, incluye_preventivo, accidente_id)
  values (
    p_id, p_vehiculo_id, v_tipo, p_descripcion,
    coalesce(p_fecha, current_date), p_km, 'pendiente',
    coalesce((select array_agg(f->>'storage_path') from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f
              where nullif(f->>'storage_path','') is not null), '{}'),
    coalesce(p_incluye_preventivo, false), p_accidente_id
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);
  return p_id;
end;
$function$;

-- ── X5 Backfill one-shot: vehículos con preventivos completados y campo vacío ──
update sgc.vehiculos v
   set km_ultimo_mantenimiento = sub.max_km, updated_at = now()
from (
  select vehiculo_id, max(kilometraje_al_mantenimiento)::int as max_km
  from sgc.mantenimientos
  where tipo = 'preventivo' and estado = 'completado' and kilometraje_al_mantenimiento is not null
  group by vehiculo_id
) sub
where v.id = sub.vehiculo_id
  and coalesce(v.km_ultimo_mantenimiento, 0) = 0;
