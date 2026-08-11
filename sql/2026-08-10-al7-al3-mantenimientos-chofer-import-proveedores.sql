-- =============================================================================
-- PROMPT-3 FASE 5 (AL7 + AL3) — Ronda 10/08/2026 (IDs AL). SGC padre.
-- Aditivo, idempotente, retrocompatible.
--
-- AL7 — El chofer registra mantenimientos/reparaciones del vehículo que tiene
--   EN USO (AK20): tipo flexible (rutina, reparación, tintado, bombillo, otros),
--   costo opcional, taller, fotos, notas; queda registrado quién lo hizo; se
--   notifica al jefe de flota. Endurece crear_mantenimiento_app: un no-elevado
--   solo registra sobre SU vehículo en uso (o del que es responsable).
--
-- AL3 — Log de importación de proveedores (quién / cuándo / cuántos). El import
--   en sí ya existe (AG7, web). Aquí queda la bitácora server-side.
-- =============================================================================

begin;

-- ── AL7.1 — Catálogo de tipos de mantenimiento más flexible ──────────────────
alter table sgc.mantenimientos drop constraint if exists mantenimientos_tipo_chk;
alter table sgc.mantenimientos add constraint mantenimientos_tipo_chk
  check (tipo = any (array[
    'preventivo','falla','accidente_dano','cambio_pieza','engrase','hidraulico',
    'reparacion','tintado','bombillo','neumatico','bateria','lavado','otros']));

-- ── AL7.2 — Parámetro: a quién se avisa cuando un chofer registra mantenimiento ─
insert into sgc.parametros (clave, valor, descripcion) values
  ('mantenimiento_aviso_roles', 'jefe_flota,logistica,admin',
   'AL7 — roles notificados cuando un chofer (no elevado) registra un mantenimiento de su vehículo en uso (CSV roles.codigo).')
on conflict (clave) do nothing;

-- ── AL7.3 — crear_mantenimiento_app endurecido + aviso a jefe de flota ───────
-- Se reemplaza la firma de 10 args por una de 13 (añade costo/proveedor/notas).
-- Una llamada con 10 args posicionales resuelve a la nueva (11-13 con default) →
-- sin ambigüedad al quedar una sola función.
drop function if exists sgc.crear_mantenimiento_app(uuid,uuid,text,text,date,numeric,jsonb,timestamptz,boolean,uuid);
create or replace function sgc.crear_mantenimiento_app(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text, p_fecha date,
  p_km numeric, p_fotos jsonb, p_capturado_en timestamp with time zone,
  p_incluye_preventivo boolean DEFAULT false, p_accidente_id uuid DEFAULT NULL::uuid,
  p_costo numeric DEFAULT NULL, p_proveedor text DEFAULT NULL, p_notas text DEFAULT NULL)
returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tipo text; v_elevado boolean; v_en_uso boolean; v_resp boolean;
  v_veh_nombre text; v_yo text; v_r record;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  v_elevado := sgc.is_admin() or sgc.tiene_modulo('flota');

  if exists (select 1 from sgc.mantenimientos where id = p_id) then
    return p_id;  -- idempotente
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  -- AL7: un no-elevado solo registra sobre su vehículo EN USO (AK20) o del que es
  -- responsable actual (bridge vehiculos.responsable_id).
  if not v_elevado then
    v_en_uso := exists (select 1 from sgc.vehiculo_usos vu
                        where vu.vehiculo_id = p_vehiculo_id and vu.usuario_id = v_uid and vu.fin_at is null);
    v_resp   := exists (select 1 from sgc.vehiculos v
                        where v.id = p_vehiculo_id and v.responsable_id = v_uid);
    if not (v_en_uso or v_resp) then
      raise exception 'Solo puedes registrar mantenimientos del vehículo que tienes en uso.';
    end if;
  end if;

  v_tipo := lower(coalesce(nullif(p_tipo,''),'preventivo'));
  if v_tipo not in ('preventivo','falla','accidente_dano','cambio_pieza','engrase',
                    'hidraulico','reparacion','tintado','bombillo','neumatico',
                    'bateria','lavado','otros') then
    v_tipo := 'otros';
  end if;

  insert into sgc.mantenimientos (id, vehiculo_id, tipo, descripcion, fecha,
    kilometraje_al_mantenimiento, estado, fotos, incluye_preventivo, accidente_id,
    costo, proveedor, notas, creado_por)
  values (
    p_id, p_vehiculo_id, v_tipo, p_descripcion,
    coalesce(p_fecha, current_date), p_km, 'pendiente',
    coalesce((select array_agg(f->>'storage_path') from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f
              where nullif(f->>'storage_path','') is not null), '{}'),
    coalesce(p_incluye_preventivo, false), p_accidente_id,
    p_costo, nullif(p_proveedor,''), nullif(p_notas,''), v_uid
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);

  -- AL7: aviso al jefe de flota cuando lo registra un chofer (no elevado).
  if not v_elevado then
    select nombre into v_veh_nombre from sgc.vehiculos where id = p_vehiculo_id;
    select nombre into v_yo from sgc.usuarios where id = v_uid;
    for v_r in
      select distinct ur.usuario_id
        from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where r.codigo in (select unnest(sgc.param_csv('mantenimiento_aviso_roles','jefe_flota,logistica,admin')))
          and ur.usuario_id is distinct from v_uid
    loop
      perform sgc.notificar(v_r.usuario_id, 'flota',
        'Mantenimiento registrado por un chofer',
        format('%s registró un mantenimiento (%s) del vehículo %s.',
               coalesce(v_yo,'Un chofer'), v_tipo, coalesce(v_veh_nombre,'—')),
        '/flota/mantenimientos');
    end loop;
  end if;

  return p_id;
end;
$function$;
grant execute on function sgc.crear_mantenimiento_app(uuid, uuid, text, text, date, numeric, jsonb, timestamptz, boolean, uuid, numeric, text, text) to authenticated, service_role;

-- ── AL7.4 — historial de vehículo: incluir quién registró (creado_por) ───────
create or replace function sgc.mantenimientos_por_vehiculo(p_vehiculo_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'No autorizado';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'tipo', m.tipo, 'descripcion', m.descripcion, 'fecha', m.fecha,
      'estado', m.estado, 'costo', m.costo, 'proveedor', m.proveedor,
      'kilometraje', m.kilometraje_al_mantenimiento, 'notas', m.notas,
      'fotos', coalesce(m.fotos, '{}'), 'incluye_preventivo', m.incluye_preventivo,
      'creado_por', m.creado_por,
      'registrado_por', (select nombre from sgc.usuarios u where u.id = m.creado_por),
      'created_at', m.created_at
    ) order by m.fecha desc, m.created_at desc)
    from sgc.mantenimientos m
    where m.vehiculo_id = p_vehiculo_id
  ), '[]'::jsonb);
end;
$function$;
grant execute on function sgc.mantenimientos_por_vehiculo(uuid) to authenticated, service_role;

-- ── AL3 — Log de importación de proveedores ──────────────────────────────────
create table if not exists sgc.proveedor_import_log (
  id           uuid primary key default gen_random_uuid(),
  importado_por uuid references sgc.usuarios(id),
  total        integer not null default 0,
  creados      integer not null default 0,
  actualizados integer not null default 0,
  saltados     integer not null default 0,
  fallidos     integer not null default 0,
  archivo      text,
  created_at   timestamptz not null default now()
);
alter table sgc.proveedor_import_log enable row level security;

drop policy if exists proveedor_import_log_sel on sgc.proveedor_import_log;
create policy proveedor_import_log_sel on sgc.proveedor_import_log
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
drop policy if exists proveedor_import_log_ins on sgc.proveedor_import_log;
create policy proveedor_import_log_ins on sgc.proveedor_import_log
  for insert to authenticated
  with check ((sgc.is_admin() or sgc.tiene_modulo('compras')) and importado_por = auth.uid());

grant select, insert on sgc.proveedor_import_log to authenticated;

-- RPC de registro (SECURITY DEFINER para evitar fricción de grants de secuencia).
create or replace function sgc.registrar_import_proveedores(
  p_total int, p_creados int, p_actualizados int, p_saltados int, p_fallidos int,
  p_archivo text default null)
returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'No autorizado para importar proveedores.';
  end if;
  insert into sgc.proveedor_import_log (importado_por, total, creados, actualizados, saltados, fallidos, archivo)
  values (v_uid, coalesce(p_total,0), coalesce(p_creados,0), coalesce(p_actualizados,0),
          coalesce(p_saltados,0), coalesce(p_fallidos,0), nullif(p_archivo,''))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.registrar_import_proveedores(int,int,int,int,int,text) to authenticated, service_role;

commit;
