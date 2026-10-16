-- Importar choferes (conductores) desde Excel + fotos por .zip emparejadas por nombre de
-- archivo, reusando el importador genérico (BT1/CC4) ya existente para proveedores/vehiculos/
-- articulos. Xaviel: "hagamos dos plantillas que los usuarios puedan usar para importar
-- Choferes y Vehículos... debe poder recibir una foto también a través de ese Excel."
--
-- DEFAULT elegido con Xaviel: la librería xlsx (SheetJS) no lee fotos embebidas en celdas →
-- el Excel trae una columna `archivo_foto` con el nombre exacto del archivo, y el usuario
-- sube además un .zip con esas fotos. El cliente empareja por nombre y sube cada foto al
-- bucket de la entidad usando el id devuelto por el RPC. Bucket nuevo 'conductores' (como
-- vehiculos/conduces) en vez de reusar 'vehiculos' con subcarpeta (más claro a largo plazo:
-- sirve también para que la ficha de chofer suba/cambie su foto fuera del import).
--
-- Aditiva y retrocompatible. Apply: node scripts/apply-migration.mjs sql/2026-10-16-importar-choferes-vehiculos-fotos.sql --env dev

begin;

-- 1) Columnas aditivas en conductores -------------------------------------------
alter table sgc.conductores
  add column if not exists foto_path text,
  add column if not exists importacion_id uuid;

comment on column sgc.conductores.foto_path is
  'Foto del chofer (bucket conductores). Independiente del avatar del usuario vinculado (AS2) — un conductor no siempre tiene usuario_id.';

-- 2) Bucket 'conductores' (privado, como vehiculos/conduces) + políticas --------
insert into storage.buckets (id, name, public, file_size_limit)
values ('conductores', 'conductores', false, 15728640)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'csd_conductores_bucket_insert') then
    create policy csd_conductores_bucket_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'conductores');
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_conductores_bucket_select') then
    create policy csd_conductores_bucket_select on storage.objects
      for select to authenticated
      using (bucket_id = 'conductores');
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_conductores_bucket_update') then
    create policy csd_conductores_bucket_update on storage.objects
      for update to authenticated
      using (bucket_id = 'conductores')
      with check (bucket_id = 'conductores');
  end if;
end
$$;

-- 3) importar_conductores (plantilla SGC propia, sin Odoo) ----------------------
-- Dedup por cédula (solo dígitos, como el resto del sistema). Devuelve además
-- `filas`: [{i,id}] por cada fila procesada (creada o actualizada), para que el
-- cliente pueda emparejar la foto del .zip con el id real tras importar.
create or replace function sgc.importar_conductores(p_filas jsonb, p_importacion_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_filas jsonb := '[]'::jsonb;
  v_cedula text; v_id uuid; v_prueba boolean := sgc.usuario_actual_es_prueba();
  v_tipo_veh text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  for v_fila in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_cedula := regexp_replace(coalesce(v_fila->>'cedula',''), '[^0-9]', '', 'g');
      if v_cedula = '' then v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta cédula'); continue; end if;
      if nullif(btrim(v_fila->>'nombre'),'') is null then
        v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta nombre'); continue;
      end if;
      v_tipo_veh := nullif(btrim(v_fila->>'tipo_vehiculo_autorizado'),'');
      if v_tipo_veh is not null and v_tipo_veh not in ('Liviano','Pesado','Ambos') then v_tipo_veh := 'Ambos'; end if;

      select id into v_id from sgc.conductores where regexp_replace(cedula,'[^0-9]','','g') = v_cedula limit 1;
      if v_id is null then
        insert into sgc.conductores (
          cedula, nombre, telefono, licencia_tipo, licencia_numero, licencia_vencimiento,
          tipo_vehiculo_autorizado, nota, activo, es_prueba, importacion_id)
        values (
          coalesce(nullif(btrim(v_fila->>'cedula'),''), v_cedula),
          btrim(v_fila->>'nombre'),
          nullif(btrim(v_fila->>'telefono'),''),
          coalesce(nullif(btrim(v_fila->>'licencia_tipo'),''), '02'),
          nullif(btrim(v_fila->>'licencia_numero'),''),
          nullif(btrim(v_fila->>'licencia_vencimiento'),'')::date,
          coalesce(v_tipo_veh, 'Ambos'),
          nullif(btrim(v_fila->>'nota'),''),
          true, v_prueba, p_importacion_id)
        returning id into v_id;
        v_nuevos := v_nuevos + 1;
      else
        update sgc.conductores set
          nombre = coalesce(nullif(btrim(v_fila->>'nombre'),''), nombre),
          telefono = coalesce(nullif(btrim(v_fila->>'telefono'),''), telefono),
          licencia_tipo = coalesce(nullif(btrim(v_fila->>'licencia_tipo'),''), licencia_tipo),
          licencia_numero = coalesce(nullif(btrim(v_fila->>'licencia_numero'),''), licencia_numero),
          licencia_vencimiento = coalesce(nullif(btrim(v_fila->>'licencia_vencimiento'),'')::date, licencia_vencimiento),
          tipo_vehiculo_autorizado = coalesce(v_tipo_veh, tipo_vehiculo_autorizado),
          nota = coalesce(nullif(btrim(v_fila->>'nota'),''), nota)
        where id = v_id;
        v_act := v_act + 1;
      end if;
      v_filas := v_filas || jsonb_build_object('i', v_i, 'id', v_id);
    exception when others then
      v_err := v_err || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'),160));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_err, 'filas', v_filas);
end;
$function$;
grant execute on function sgc.importar_conductores(jsonb, uuid) to authenticated, service_role;

-- 4) importar_vehiculos — añade `filas:[{i,id}]` al resultado (mismo contrato que
--    importar_conductores) para poder emparejar la foto del .zip tras importar.
--    FIX (hallado al probar esta misma plantilla): `vehiculos.anio` es NOT NULL sin
--    default y el insert original no lo poblaba → toda fila sin año reventaba con
--    "null value in column anio". Ahora cae al año actual si no viene en el Excel.
create or replace function sgc.importar_vehiculos(p_filas jsonb, p_importacion_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_filas jsonb := '[]'::jsonb;
  v_placa text; v_id uuid; v_prueba boolean := sgc.usuario_actual_es_prueba(); v_anio int;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  for v_fila in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_placa := upper(regexp_replace(coalesce(v_fila->>'placa',''), '[^A-Za-z0-9]', '', 'g'));
      if v_placa = '' then v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta placa'); continue; end if;
      v_anio := coalesce(nullif(btrim(v_fila->>'anio'),'')::int, extract(year from now())::int);
      select id into v_id from sgc.vehiculos where upper(regexp_replace(placa,'[^A-Za-z0-9]','','g')) = v_placa limit 1;
      if v_id is null then
        insert into sgc.vehiculos (placa, marca, modelo, anio, color, tipo, activo, es_prueba, importacion_id)
        values (coalesce(nullif(btrim(v_fila->>'placa'),''), v_placa),
                coalesce(nullif(btrim(v_fila->>'marca'),''), 'N/D'),
                coalesce(nullif(btrim(v_fila->>'modelo'),''), 'N/D'),
                v_anio,
                nullif(btrim(v_fila->>'color'),''),
                coalesce(nullif(btrim(v_fila->>'tipo'),''), 'vehiculo'),
                true, v_prueba, p_importacion_id)
        returning id into v_id;
        v_nuevos := v_nuevos + 1;
      else
        update sgc.vehiculos set
          marca = coalesce(nullif(btrim(v_fila->>'marca'),''), marca),
          modelo = coalesce(nullif(btrim(v_fila->>'modelo'),''), modelo),
          color = coalesce(nullif(btrim(v_fila->>'color'),''), color)
        where id = v_id;
        v_act := v_act + 1;
      end if;
      v_filas := v_filas || jsonb_build_object('i', v_i, 'id', v_id);
    exception when others then
      v_err := v_err || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'),160));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_err, 'filas', v_filas);
end;
$function$;
grant execute on function sgc.importar_vehiculos(jsonb, uuid) to authenticated, service_role;

-- 5) deshacer_importacion — también limpia conductores creados por la importación --
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
  delete from sgc.conductores where importacion_id = p_id; get diagnostics v_tmp = row_count; v_borradas := v_borradas + v_tmp;
  update sgc.importaciones set deshecha_at = now() where id = p_id;
  return jsonb_build_object('borradas', v_borradas);
end;
$function$;
grant execute on function sgc.deshacer_importacion(uuid) to authenticated, service_role;

commit;
