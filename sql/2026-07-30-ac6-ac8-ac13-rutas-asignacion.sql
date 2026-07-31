-- ============================================================================
-- AC13 + AC6 + AC8 — Rutas multi-parada, fotos de ruta, bloqueo de re-asignación
-- (30/07/2026)
-- ----------------------------------------------------------------------------
-- AC13: una ruta puede tener N paradas ordenadas (aditivo; retrocompatible con
--       rutas de 1 destino: origen/destino siguen igual, paradas son extra).
-- AC6:  fotos al crear/iniciar la ruta (evidencia inicial), bucket `vehiculos`.
-- AC8:  no re-asignar un vehículo que ya está asignado a OTRO usuario (roster
--       activo o custodia abierta sin devolución). Mensaje claro + helper para
--       que la web deshabilite esos vehículos en los selectores.
-- ============================================================================

set search_path = sgc, public;

-- ── AC13 — paradas de ruta ─────────────────────────────────────────────────
create table if not exists sgc.ruta_paradas (
  id           uuid primary key default gen_random_uuid(),
  ruta_id      uuid not null references sgc.rutas(id) on delete cascade,
  orden        int  not null default 1,
  ubicacion    text not null,
  lat          numeric(9,6),
  lng          numeric(9,6),
  notas        text,
  proyecto_id  uuid references sgc.proyectos(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ruta_paradas_ruta on sgc.ruta_paradas(ruta_id, orden);
comment on table sgc.ruta_paradas is 'AC13 — paradas ordenadas de una ruta (multi-destino estilo Uber).';

-- ── AC6 — fotos de ruta (evidencia inicial) ────────────────────────────────
create table if not exists sgc.ruta_fotos (
  id           uuid primary key default gen_random_uuid(),
  ruta_id      uuid not null references sgc.rutas(id) on delete cascade,
  momento      text not null default 'inicial',   -- inicial | en_curso | fin
  storage_path text not null,                      -- bucket `vehiculos`, ruta/{rutaId}/{uuid}.jpg
  orden        int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ruta_fotos_ruta on sgc.ruta_fotos(ruta_id, orden);
comment on table sgc.ruta_fotos is 'AC6 — fotos de evidencia de una ruta (bucket vehiculos).';

-- ── RLS (mismo alcance que la ruta madre) ──────────────────────────────────
alter table sgc.ruta_paradas enable row level security;
alter table sgc.ruta_fotos    enable row level security;

-- Predicado reutilizable como EXISTS sobre la ruta madre.
-- SELECT
drop policy if exists ruta_paradas_sel on sgc.ruta_paradas;
create policy ruta_paradas_sel on sgc.ruta_paradas for select to authenticated
using (exists (select 1 from sgc.rutas r where r.id = ruta_paradas.ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
            or r.conductor_id in (select sgc.mis_conductor_ids()))));
drop policy if exists ruta_fotos_sel on sgc.ruta_fotos;
create policy ruta_fotos_sel on sgc.ruta_fotos for select to authenticated
using (exists (select 1 from sgc.rutas r where r.id = ruta_fotos.ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
            or r.conductor_id in (select sgc.mis_conductor_ids()))));
-- INSERT (creador de la ruta / conductor asignado / elevado)
drop policy if exists ruta_paradas_ins on sgc.ruta_paradas;
create policy ruta_paradas_ins on sgc.ruta_paradas for insert to authenticated
with check (exists (select 1 from sgc.rutas r where r.id = ruta_paradas.ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
            or r.conductor_id in (select sgc.mis_conductor_ids()))));
drop policy if exists ruta_fotos_ins on sgc.ruta_fotos;
create policy ruta_fotos_ins on sgc.ruta_fotos for insert to authenticated
with check (exists (select 1 from sgc.rutas r where r.id = ruta_fotos.ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
            or r.conductor_id in (select sgc.mis_conductor_ids()))));
-- DELETE paradas (para reordenar/limpiar) — mismo alcance
drop policy if exists ruta_paradas_del on sgc.ruta_paradas;
create policy ruta_paradas_del on sgc.ruta_paradas for delete to authenticated
using (exists (select 1 from sgc.rutas r where r.id = ruta_paradas.ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
            or r.conductor_id in (select sgc.mis_conductor_ids()))));

-- ── AC13 — RPC: reemplazar paradas de una ruta (bulk ordenado, offline-ready) ─
create or replace function sgc.set_ruta_paradas(p_ruta_id uuid, p_paradas jsonb)
returns int language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare v_uid uuid := auth.uid(); v_n int := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not exists (select 1 from sgc.rutas r where r.id = p_ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = v_uid
            or r.conductor_id in (select sgc.mis_conductor_ids()))) then
    raise exception 'No tienes permiso sobre esta ruta';
  end if;

  delete from sgc.ruta_paradas where ruta_id = p_ruta_id;
  insert into sgc.ruta_paradas (ruta_id, orden, ubicacion, lat, lng, notas, proyecto_id)
  select p_ruta_id,
         coalesce((p->>'orden')::int, (row_number() over ())::int),
         p->>'ubicacion',
         nullif(p->>'lat','')::numeric, nullif(p->>'lng','')::numeric,
         nullif(p->>'notas',''), nullif(p->>'proyecto_id','')::uuid
    from jsonb_array_elements(coalesce(p_paradas,'[]'::jsonb)) p
   where nullif(p->>'ubicacion','') is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.set_ruta_paradas(uuid, jsonb) to authenticated, service_role;

-- ── AC8 — helper: vehículos asignados/en custodia por OTRO (para deshabilitar) ─
create or replace function sgc.vehiculos_asignados()
returns table(vehiculo_id uuid, usuario_id uuid, nombre text, motivo text)
language sql stable security definer
set search_path to 'sgc','pg_temp' as $$
  -- Custodia abierta (entrega sin devolución) — la más fuerte.
  select e.vehiculo_id, e.conductor_usuario_id, u.nombre, 'custodia'::text
    from sgc.vehiculo_entregas e
    join sgc.usuarios u on u.id = e.conductor_usuario_id
   where e.tipo = 'recepcion' and e.estado = 'abierta'
  union
  -- Roster activo.
  select va.vehiculo_id, va.usuario_id, u.nombre, 'asignacion'::text
    from sgc.vehiculo_asignaciones va
    join sgc.usuarios u on u.id = va.usuario_id
   where va.activa;
$$;
grant execute on function sgc.vehiculos_asignados() to authenticated, service_role;

-- ── AC8 — guard en el self-assign: no reasignar si ya está en poder de OTRO ──
create or replace function sgc.asignarme_vehiculo(p_vehiculo_id uuid, p_client_uuid uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_asig_id   uuid;
  v_cond_id   uuid;
  v_estado    text;
  v_activo    boolean;
  v_km_ult    int;
  v_intervalo int;
  v_veh       record;
  v_otro_nom  text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  if p_client_uuid is not null then
    select id into v_asig_id from sgc.vehiculo_asignaciones where client_uuid = p_client_uuid;
    if v_asig_id is not null then
      return (select to_jsonb(a) || jsonb_build_object('aceptada', true)
                from sgc.vehiculo_asignaciones a where a.id = v_asig_id);
    end if;
  end if;

  select estado, coalesce(activo, true), km_ultimo_mantenimiento, intervalo_mantenimiento_km
    into v_estado, v_activo, v_km_ult, v_intervalo
    from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not v_activo or v_estado in ('baja','no_disponible') then
    raise exception 'El vehículo no está disponible (estado: %).', v_estado;
  end if;

  -- AC8 — custodia abierta a nombre de OTRO usuario: no se puede reasignar.
  select u.nombre into v_otro_nom
    from sgc.vehiculo_entregas e join sgc.usuarios u on u.id = e.conductor_usuario_id
   where e.vehiculo_id = p_vehiculo_id and e.tipo = 'recepcion' and e.estado = 'abierta'
     and e.conductor_usuario_id <> v_uid
   limit 1;
  if v_otro_nom is not null then
    raise exception 'El vehículo está asignado a % (entrega sin devolución). Debe devolverse antes de reasignarlo.', v_otro_nom
      using errcode = 'DR409';
  end if;

  -- AC8 — asignación de roster activa a nombre de OTRO usuario.
  select u.nombre into v_otro_nom
    from sgc.vehiculo_asignaciones va join sgc.usuarios u on u.id = va.usuario_id
   where va.vehiculo_id = p_vehiculo_id and va.activa and va.usuario_id <> v_uid
   limit 1;
  if v_otro_nom is not null then
    raise exception 'El vehículo ya está asignado a %.', v_otro_nom using errcode = 'DR409';
  end if;

  select id into v_cond_id from sgc.conductores where usuario_id = v_uid and activo limit 1;

  select id into v_asig_id
    from sgc.vehiculo_asignaciones
   where vehiculo_id = p_vehiculo_id and usuario_id = v_uid and activa
   limit 1;

  if v_asig_id is null then
    insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, conductor_id, origen, client_uuid)
    values (p_vehiculo_id, v_uid, v_cond_id, 'auto', p_client_uuid)
    returning id into v_asig_id;
  end if;

  update sgc.vehiculos set responsable_id = v_uid
   where id = p_vehiculo_id and responsable_id is null;

  select placa, marca, modelo, anio, tipo, kilometraje, vencimiento_matricula, vencimiento_seguro
    into v_veh
    from sgc.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'aceptada',              true,
    'asignacion_id',         v_asig_id,
    'vehiculo_id',           p_vehiculo_id,
    'conductor_id',          v_cond_id,
    'placa',                 v_veh.placa,
    'marca',                 v_veh.marca,
    'modelo',                v_veh.modelo,
    'anio',                  v_veh.anio,
    'tipo',                  v_veh.tipo,
    'kilometraje',           v_veh.kilometraje,
    'vencimiento_matricula', v_veh.vencimiento_matricula,
    'vencimiento_seguro',    v_veh.vencimiento_seguro,
    'proximo_mantenimiento_km',
        case when v_km_ult is not null then v_km_ult + coalesce(v_intervalo,5000) else null end
  );
end;
$function$;
