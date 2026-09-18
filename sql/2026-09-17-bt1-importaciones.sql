-- BT1 — Importar echadas de TotalEnergies (y crear las que faltan) + importador genérico
-- de datos (Odoo y otros). Nota #47: "Raykler must be able to upload 'echadas de combustible'
-- from the report that TotalEnergies gives us … update the previous echadas that some users
-- didn't register. And must be able to import other things … as for example Odoo…"
--
-- Lo que YA existe (no se rehace): conciliación (`conciliaciones_combustible` +
-- `conciliacion_combustible_detalle` + `combustible_transacciones_proveedor` con las filas
-- de la factura parseadas), `combustible_tarjeta_map` (tarjeta→vehículo YA existe → NO se
-- añade `vehiculos.tarjeta_combustible`, se reutiliza el mapa), `importar_proveedores`/
-- `importar_personal_obra`/`cronograma_importar`.
--
-- DEFAULT / desviaciones reportadas:
--  · `registros_combustible.origen` YA significa 'estacion'|'deposito_obra' (de dónde salió
--    el combustible), NO la fuente del dato → las echadas importadas se marcan con columnas
--    NUEVAS `importada`/`conciliacion_id`, no sobreescribiendo `origen` (queda 'estacion').
--  · Vehículo por placa/tarjeta = `combustible_tarjeta_map` (infra existente).
--
-- Aditiva y retrocompatible. begin/rollback validado en prod.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-17-bt1-importaciones.sql

begin;

-- =====================================================================================
-- PARTE A — Conciliación crea las echadas faltantes
-- =====================================================================================

-- 1) Columnas de traza de importación en la echada -------------------------------
alter table sgc.registros_combustible
  add column if not exists importada boolean not null default false,
  add column if not exists conciliacion_id uuid references sgc.conciliaciones_combustible(id),
  add column if not exists km_pendiente boolean not null default false,
  add column if not exists nro_factura text;

comment on column sgc.registros_combustible.importada is
  'BT1 — echada creada al importar la factura de TotalEnergies (chip IMPORTADA). origen sigue = estacion/deposito.';

-- Idempotencia: una misma línea de factura no se importa dos veces por conciliación.
create unique index if not exists uq_registros_combustible_import
  on sgc.registros_combustible (conciliacion_id, nro_factura)
  where importada and nro_factura is not null;

-- 1b) La echada IMPORTADA no exige foto de tablero (regla: import sin fotos) -----
create or replace function sgc.trg_combustible_requiere_tablero()
 returns trigger language plpgsql
as $function$
begin
  -- BM3 — el tablero es obligatorio SÓLO para la echada de estación con vehículo.
  -- BT1 — las echadas IMPORTADAS (de la factura) no traen foto → exentas.
  if coalesce(new.origen, 'estacion') <> 'deposito_obra'
     and not coalesce(new.titular_es_persona, false)
     and not coalesce(new.importada, false)
     and (new.foto_tablero_path is null or btrim(new.foto_tablero_path) = '') then
    raise exception 'La foto del tablero (odómetro/nivel) es obligatoria para registrar combustible.';
  end if;
  return new;
end;
$function$;

-- 2) notif_tipo para el km pendiente --------------------------------------------
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('combustible_km_pendiente', 'Km pendiente en echada importada',
        'Una echada importada de la factura no trae kilometraje; complétalo.', false,
        array['in_app'], true, 500)
on conflict (tipo) do nothing;

-- 2b) log_combustible expone importada/km_pendiente (chip IMPORTADA, AT11) -------
drop function if exists sgc.log_combustible(date, date, uuid, uuid);
create function sgc.log_combustible(p_desde date default null, p_hasta date default null, p_vehiculo_id uuid default null, p_usuario_id uuid default null)
 returns table(id uuid, fecha date, vehiculo_id uuid, placa text, kilometraje integer, km_anterior integer, km_recorridos integer, galones numeric, monto numeric, producto text, subtipo text, estado text, km_alerta boolean, sin_asignacion boolean, alerta_consumo boolean, registrado_por uuid, registrado_nombre text, conductor_nombre text, es_prueba boolean, created_at timestamp with time zone, importada boolean, km_pendiente boolean)
 language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select
    r.id, r.fecha, r.vehiculo_id, v.placa, r.kilometraje, r.km_anterior, r.km_recorridos,
    r.galones, r.monto, r.producto, r.subtipo, r.estado,
    coalesce(r.km_alerta, false), coalesce(r.sin_asignacion, false), coalesce(r.alerta_consumo, false),
    r.registrado_por, u.nombre, c.nombre, coalesce(r.es_prueba, false), r.created_at,
    coalesce(r.importada, false), coalesce(r.km_pendiente, false)
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
grant execute on function sgc.log_combustible(date, date, uuid, uuid) to authenticated, service_role;

-- 3) RPC: crear echadas desde las filas de la factura sin match ------------------
-- Cada fila (jsonb) = {fecha, galones, monto, precio_por_galon, nro_factura, tarjeta,
--   titular, estacion, producto, km, vehiculo_id?}. Devuelve {creadas, con_km_pendiente,
--   sin_asignacion, errores:[{i, motivo}]}. Gate es_flota_elevado(). Fila a fila (patrón BO3).
create or replace function sgc.importar_echadas_conciliacion(p_conciliacion_id uuid, p_filas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0;
  v_creadas int := 0; v_kmpend int := 0; v_sinasg int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_veh uuid; v_cond uuid; v_km int; v_prueba boolean;
  v_fecha date; v_gal numeric; v_monto numeric; v_precio numeric; v_factura text; v_tarjeta text;
  v_reg uuid;
begin
  if not sgc.es_flota_elevado() then
    raise exception 'No autorizado para importar echadas.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.conciliaciones_combustible where id = p_conciliacion_id) then
    perform sgc.error_campo('conciliacion_id', 'no_existe', 'La conciliación no existe.');
  end if;
  v_prueba := sgc.usuario_actual_es_prueba();

  for v_fila in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    begin
      v_fecha := nullif(v_fila->>'fecha','')::date;
      v_gal   := nullif(v_fila->>'galones','')::numeric;
      v_monto := nullif(v_fila->>'monto','')::numeric;
      v_precio:= nullif(v_fila->>'precio_por_galon','')::numeric;
      v_factura := nullif(btrim(v_fila->>'nro_factura'),'');
      v_tarjeta := nullif(btrim(v_fila->>'tarjeta'),'');
      v_km := nullif(v_fila->>'km','')::int;

      if v_fecha is null or v_gal is null then
        v_errores := v_errores || jsonb_build_object('i', v_i, 'motivo', 'Falta fecha o galones');
        continue;
      end if;

      -- Idempotencia: ya importada esta factura en esta conciliación.
      if v_factura is not null and exists (
        select 1 from sgc.registros_combustible r
        where r.conciliacion_id = p_conciliacion_id and r.nro_factura = v_factura and r.importada) then
        continue;
      end if;

      -- Vehículo: explícito → mapa de tarjeta → null.
      v_veh := nullif(v_fila->>'vehiculo_id','')::uuid;
      if v_veh is null and v_tarjeta is not null then
        select vehiculo_id into v_veh from sgc.combustible_tarjeta_map
         where codigo_tarjeta = v_tarjeta and vehiculo_id is not null limit 1;
      end if;

      -- Conductor: asignación/uso del vehículo en esa fecha (best-effort).
      v_cond := null;
      if v_veh is not null then
        select vu.usuario_id into v_cond
          from sgc.vehiculo_usos vu
         where vu.vehiculo_id = v_veh and vu.inicio_at::date <= v_fecha
         order by vu.inicio_at desc limit 1;
      end if;

      insert into sgc.registros_combustible (
        vehiculo_id, conductor_id, fecha, galones, monto, precio_por_galon, kilometraje,
        estacion, producto, tarjeta, titular, titular_es_persona, origen, es_prueba,
        es_prueba_origen, importada, conciliacion_id, nro_factura, km_pendiente,
        sin_asignacion, estado, tanque_lleno, alerta_consumo, registrado_por)
      values (
        v_veh, v_cond, v_fecha, v_gal, v_monto, v_precio, v_km,
        nullif(btrim(v_fila->>'estacion'),''), nullif(btrim(v_fila->>'producto'),''),
        v_tarjeta, nullif(btrim(v_fila->>'titular'),''), false, 'estacion', v_prueba,
        'manual', true, p_conciliacion_id, v_factura, (v_km is null),
        (v_cond is null), 'datos_insuficientes', false, false, auth.uid())
      returning id into v_reg;

      v_creadas := v_creadas + 1;
      if v_km is null then v_kmpend := v_kmpend + 1; end if;
      if v_cond is null then v_sinasg := v_sinasg + 1; end if;

      -- Enlaza la transacción de factura (si existe) para cerrar el ciclo de conciliación.
      update sgc.combustible_transacciones_proveedor
         set registro_id = v_reg
       where conciliacion_id = p_conciliacion_id and registro_id is null
         and numero_factura is not distinct from v_factura
         and fecha is not distinct from v_fecha;
    exception when others then
      v_errores := v_errores || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'), 160));
    end;
  end loop;

  -- Aviso a Flota si quedaron echadas sin kilometraje (regla 15: se acepta y se avisa).
  if v_kmpend > 0 then
    perform sgc.notificar_modulo('flota', 'combustible_km_pendiente',
      'Echadas importadas sin kilometraje',
      format('%s echada(s) importada(s) necesitan que completes el kilometraje.', v_kmpend),
      '/flota/combustible-log');
  end if;

  return jsonb_build_object('creadas', v_creadas, 'con_km_pendiente', v_kmpend,
    'sin_asignacion', v_sinasg, 'errores', v_errores);
end;
$function$;

grant execute on function sgc.importar_echadas_conciliacion(uuid, jsonb) to authenticated, service_role;

-- =====================================================================================
-- PARTE B — Importador genérico "Importar datos" (Odoo y otros)
-- =====================================================================================

-- 4) Registro de importaciones + deshacer 24 h ----------------------------------
create table if not exists sgc.importaciones (
  id uuid primary key default gen_random_uuid(),
  entidad text not null,
  archivo_path text,
  usuario_id uuid references sgc.usuarios(id),
  filas int not null default 0,
  nuevos int not null default 0,
  actualizados int not null default 0,
  errores jsonb not null default '[]'::jsonb,
  deshecha_at timestamptz,
  created_at timestamptz not null default now()
);
alter table sgc.importaciones enable row level security;
drop policy if exists importaciones_sel on sgc.importaciones;
create policy importaciones_sel on sgc.importaciones for select to authenticated
  using (sgc.is_admin() or sgc.es_flota_elevado() or sgc.tiene_modulo('inventario'));

-- Mapeo de columnas recordado por entidad y usuario.
create table if not exists sgc.importaciones_mapeo (
  usuario_id uuid not null references sgc.usuarios(id),
  entidad text not null,
  mapeo jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (usuario_id, entidad)
);
alter table sgc.importaciones_mapeo enable row level security;
drop policy if exists importaciones_mapeo_rw on sgc.importaciones_mapeo;
create policy importaciones_mapeo_rw on sgc.importaciones_mapeo for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Marca las filas creadas por una importación (para deshacer) — columna aditiva por tabla.
alter table sgc.vehiculos add column if not exists importacion_id uuid;
alter table sgc.articulos  add column if not exists importacion_id uuid;

create or replace function sgc.importaciones_mapeo_get(p_entidad text)
 returns jsonb language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select coalesce((select mapeo from sgc.importaciones_mapeo where usuario_id = auth.uid() and entidad = p_entidad), '{}'::jsonb);
$function$;
grant execute on function sgc.importaciones_mapeo_get(text) to authenticated, service_role;

create or replace function sgc.importaciones_mapeo_set(p_entidad text, p_mapeo jsonb)
 returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  insert into sgc.importaciones_mapeo (usuario_id, entidad, mapeo, updated_at)
  values (auth.uid(), p_entidad, coalesce(p_mapeo,'{}'::jsonb), now())
  on conflict (usuario_id, entidad) do update set mapeo = excluded.mapeo, updated_at = now();
end;
$function$;
grant execute on function sgc.importaciones_mapeo_set(text, jsonb) to authenticated, service_role;

-- 5) importar_vehiculos (Odoo fleet.vehicle) ------------------------------------
create or replace function sgc.importar_vehiculos(p_filas jsonb, p_importacion_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_placa text; v_id uuid; v_prueba boolean := sgc.usuario_actual_es_prueba();
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  for v_fila in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_placa := upper(regexp_replace(coalesce(v_fila->>'placa',''), '[^A-Za-z0-9]', '', 'g'));
      if v_placa = '' then v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta placa'); continue; end if;
      select id into v_id from sgc.vehiculos where upper(regexp_replace(placa,'[^A-Za-z0-9]','','g')) = v_placa limit 1;
      if v_id is null then
        insert into sgc.vehiculos (placa, marca, modelo, color, tipo, activo, es_prueba, importacion_id)
        values (coalesce(nullif(btrim(v_fila->>'placa'),''), v_placa),
                coalesce(nullif(btrim(v_fila->>'marca'),''), 'N/D'),
                coalesce(nullif(btrim(v_fila->>'modelo'),''), 'N/D'),
                nullif(btrim(v_fila->>'color'),''),
                coalesce(nullif(btrim(v_fila->>'tipo'),''), 'vehiculo'),
                true, v_prueba, p_importacion_id);
        v_nuevos := v_nuevos + 1;
      else
        update sgc.vehiculos set
          marca = coalesce(nullif(btrim(v_fila->>'marca'),''), marca),
          modelo = coalesce(nullif(btrim(v_fila->>'modelo'),''), modelo),
          color = coalesce(nullif(btrim(v_fila->>'color'),''), color)
        where id = v_id;
        v_act := v_act + 1;
      end if;
    exception when others then
      v_err := v_err || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'),160));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_err);
end;
$function$;
grant execute on function sgc.importar_vehiculos(jsonb, uuid) to authenticated, service_role;

-- 6) importar_articulos (Odoo product.template) — categoría por nombre (crea si falta) --
create or replace function sgc.importar_articulos(p_filas jsonb, p_importacion_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_nombre text; v_codigo text; v_unidad text; v_cat text; v_cat_id int; v_id uuid;
  v_prueba boolean := sgc.usuario_actual_es_prueba();
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  for v_fila in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_nombre := nullif(btrim(v_fila->>'nombre'),'');
      if v_nombre is null then v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta nombre'); continue; end if;
      v_codigo := coalesce(nullif(btrim(v_fila->>'codigo'),''), upper(left(regexp_replace(v_nombre,'[^A-Za-z0-9]','','g'),8)) || '-' || v_i);
      v_unidad := coalesce(nullif(btrim(v_fila->>'unidad'),''), 'ud');
      v_cat := coalesce(nullif(btrim(v_fila->>'categoria'),''), 'Importados');
      select id into v_cat_id from sgc.categorias_inventario where lower(nombre) = lower(v_cat) limit 1;
      if v_cat_id is null then
        insert into sgc.categorias_inventario (nombre) values (v_cat) returning id into v_cat_id;
      end if;
      select id into v_id from sgc.articulos where lower(codigo) = lower(v_codigo) or lower(nombre) = lower(v_nombre) limit 1;
      if v_id is null then
        insert into sgc.articulos (codigo, nombre, categoria_id, unidad, es_prueba, importacion_id)
        values (v_codigo, v_nombre, v_cat_id, v_unidad, v_prueba, p_importacion_id);
        v_nuevos := v_nuevos + 1;
      else
        v_act := v_act + 1; -- existe: no se pisa (dedup)
      end if;
    exception when others then
      v_err := v_err || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'),160));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_err);
end;
$function$;
grant execute on function sgc.importar_articulos(jsonb, uuid) to authenticated, service_role;

-- 7) crear_importacion + deshacer_importacion -----------------------------------
create or replace function sgc.crear_importacion(p_entidad text, p_archivo_path text default null, p_filas int default 0)
 returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_id uuid;
begin
  insert into sgc.importaciones (entidad, archivo_path, usuario_id, filas)
  values (p_entidad, p_archivo_path, auth.uid(), coalesce(p_filas,0)) returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function sgc.crear_importacion(text, text, int) to authenticated, service_role;

create or replace function sgc.registrar_resultado_importacion(p_id uuid, p_nuevos int, p_actualizados int, p_errores jsonb)
 returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  update sgc.importaciones set nuevos = coalesce(p_nuevos,0), actualizados = coalesce(p_actualizados,0),
    errores = coalesce(p_errores,'[]'::jsonb) where id = p_id;
end;
$function$;
grant execute on function sgc.registrar_resultado_importacion(uuid, int, int, jsonb) to authenticated, service_role;

create or replace function sgc.deshacer_importacion(p_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_imp sgc.importaciones%rowtype; v_borradas int := 0; v_tmp int;
begin
  select * into v_imp from sgc.importaciones where id = p_id;
  if not found then raise exception 'Importación no encontrada.'; end if;
  if not (sgc.is_admin() or v_imp.usuario_id = auth.uid()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if v_imp.deshecha_at is not null then raise exception 'Esta importación ya fue deshecha.'; end if;
  if v_imp.created_at < now() - interval '24 hours' then
    raise exception 'Solo se puede deshacer dentro de las 24 horas.';
  end if;
  -- Borra SOLO las filas creadas por esta importación (las actualizadas quedan).
  delete from sgc.vehiculos where importacion_id = p_id; get diagnostics v_tmp = row_count; v_borradas := v_borradas + v_tmp;
  delete from sgc.articulos  where importacion_id = p_id; get diagnostics v_tmp = row_count; v_borradas := v_borradas + v_tmp;
  update sgc.importaciones set deshecha_at = now() where id = p_id;
  return jsonb_build_object('borradas', v_borradas);
end;
$function$;
grant execute on function sgc.deshacer_importacion(uuid) to authenticated, service_role;

-- 8) Bucket privado para los archivos de importación ----------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('sgc-importaciones', 'sgc-importaciones', false, 10485760)
on conflict (id) do nothing;

drop policy if exists sgc_importaciones_rw on storage.objects;
create policy sgc_importaciones_rw on storage.objects for all to authenticated
  using (bucket_id = 'sgc-importaciones')
  with check (bucket_id = 'sgc-importaciones');

commit;
