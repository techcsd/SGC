-- ============================================================================
-- CC4b (PROMPT-74 F7) — Idempotencia por `odoo_ref` en los importadores.
-- ----------------------------------------------------------------------------
-- Recrea importar_proveedores / importar_vehiculos / importar_articulos para que,
-- cuando la fila trae `odoo_ref` (el `ID` externo de Odoo), (a) empareje PRIMERO
-- por odoo_ref (reimportar actualiza, no duplica) y (b) lo GUARDE en la fila.
-- El resto de la lógica (gate, dedup por RNC/nombre/placa/código, campos) se
-- conserva byte a byte respecto a la versión viva en prod.
-- BU1 (regla 18): --env dev primero, luego --env prod --yes.
-- ============================================================================

begin;

-- ── Proveedores ──────────────────────────────────────────────────────────────
create or replace function sgc.importar_proveedores(p_filas jsonb, p_modo text default 'actualizar'::text)
returns jsonb language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_row jsonb; v_i int := 0;
  v_nuevos int := 0; v_actualizados int := 0; v_saltados int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_nombre text; v_rnc text; v_ref text; v_existe uuid; v_fila int;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.es_flota_elevado()) then
    raise exception 'No autorizado para importar proveedores' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' then
    raise exception 'p_filas debe ser un arreglo' using errcode = '22023';
  end if;
  for v_row in select * from jsonb_array_elements(p_filas) loop
    v_i := v_i + 1;
    v_fila := coalesce((v_row->>'fila')::int, v_i);
    v_nombre := nullif(btrim(v_row->>'nombre'), '');
    v_rnc := nullif(btrim(v_row->>'rnc'), '');
    v_ref := nullif(btrim(v_row->>'odoo_ref'), '');
    begin
      if v_nombre is null then
        v_errores := v_errores || jsonb_build_object('fila', v_fila, 'nombre', null, 'rnc', v_rnc, 'msg', 'Falta el nombre');
        continue;
      end if;
      -- Empareja por odoo_ref (idempotencia) → luego por RNC o nombre normalizado.
      v_existe := null;
      if v_ref is not null then
        select id into v_existe from sgc.proveedores where odoo_ref = v_ref limit 1;
      end if;
      if v_existe is null then
        select id into v_existe from sgc.proveedores
         where (v_rnc is not null and rnc = v_rnc)
            or lower(btrim(nombre)) = lower(btrim(v_nombre))
         limit 1;
      end if;
      if v_existe is not null then
        if p_modo = 'saltar' then v_saltados := v_saltados + 1; continue; end if;
        update sgc.proveedores set
          nombre = v_nombre,
          rnc = coalesce(v_rnc, rnc),
          contacto = coalesce(nullif(btrim(v_row->>'contacto'),''), contacto),
          telefono = coalesce(nullif(btrim(v_row->>'telefono'),''), telefono),
          email = coalesce(nullif(btrim(v_row->>'email'),''), email),
          direccion = coalesce(nullif(btrim(v_row->>'direccion'),''), direccion),
          activo = coalesce((v_row->>'activo')::boolean, activo),
          is_hardware_store = coalesce((v_row->>'is_hardware_store')::boolean, is_hardware_store),
          odoo_ref = coalesce(v_ref, odoo_ref)
        where id = v_existe;
        v_actualizados := v_actualizados + 1;
      else
        insert into sgc.proveedores (nombre, rnc, contacto, telefono, email, direccion, activo, is_hardware_store, odoo_ref)
        values (
          v_nombre, v_rnc,
          nullif(btrim(v_row->>'contacto'),''),
          nullif(btrim(v_row->>'telefono'),''),
          nullif(btrim(v_row->>'email'),''),
          nullif(btrim(v_row->>'direccion'),''),
          coalesce((v_row->>'activo')::boolean, true),
          coalesce((v_row->>'is_hardware_store')::boolean, false),
          v_ref
        );
        v_nuevos := v_nuevos + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('fila', v_fila, 'nombre', v_nombre, 'rnc', v_rnc, 'msg', SQLERRM);
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_actualizados, 'saltados', v_saltados, 'errores', v_errores);
end $function$;

-- ── Vehículos ────────────────────────────────────────────────────────────────
create or replace function sgc.importar_vehiculos(p_filas jsonb, p_importacion_id uuid)
returns jsonb language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_placa text; v_ref text; v_id uuid; v_prueba boolean := sgc.usuario_actual_es_prueba();
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  for v_fila in select * from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_placa := upper(regexp_replace(coalesce(v_fila->>'placa',''), '[^A-Za-z0-9]', '', 'g'));
      v_ref := nullif(btrim(v_fila->>'odoo_ref'), '');
      if v_placa = '' and v_ref is null then v_err := v_err || jsonb_build_object('i', v_i, 'motivo', 'Falta placa'); continue; end if;
      v_id := null;
      if v_ref is not null then select id into v_id from sgc.vehiculos where odoo_ref = v_ref limit 1; end if;
      if v_id is null and v_placa <> '' then
        select id into v_id from sgc.vehiculos where upper(regexp_replace(placa,'[^A-Za-z0-9]','','g')) = v_placa limit 1;
      end if;
      if v_id is null then
        insert into sgc.vehiculos (placa, marca, modelo, color, tipo, activo, es_prueba, importacion_id, odoo_ref)
        values (coalesce(nullif(btrim(v_fila->>'placa'),''), v_placa),
                coalesce(nullif(btrim(v_fila->>'marca'),''), 'N/D'),
                coalesce(nullif(btrim(v_fila->>'modelo'),''), 'N/D'),
                nullif(btrim(v_fila->>'color'),''),
                coalesce(nullif(btrim(v_fila->>'tipo'),''), 'vehiculo'),
                true, v_prueba, p_importacion_id, v_ref);
        v_nuevos := v_nuevos + 1;
      else
        update sgc.vehiculos set
          marca = coalesce(nullif(btrim(v_fila->>'marca'),''), marca),
          modelo = coalesce(nullif(btrim(v_fila->>'modelo'),''), modelo),
          color = coalesce(nullif(btrim(v_fila->>'color'),''), color),
          odoo_ref = coalesce(v_ref, odoo_ref)
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

-- ── Artículos ────────────────────────────────────────────────────────────────
create or replace function sgc.importar_articulos(p_filas jsonb, p_importacion_id uuid)
returns jsonb language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_fila jsonb; v_i int := 0; v_nuevos int := 0; v_act int := 0; v_err jsonb := '[]'::jsonb;
  v_nombre text; v_codigo text; v_unidad text; v_cat text; v_cat_id int; v_ref text; v_id uuid;
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
      v_ref := nullif(btrim(v_fila->>'odoo_ref'),'');
      v_codigo := coalesce(nullif(btrim(v_fila->>'codigo'),''), upper(left(regexp_replace(v_nombre,'[^A-Za-z0-9]','','g'),8)) || '-' || v_i);
      v_unidad := coalesce(nullif(btrim(v_fila->>'unidad'),''), 'ud');
      v_cat := coalesce(nullif(btrim(v_fila->>'categoria'),''), 'Importados');
      select id into v_cat_id from sgc.categorias_inventario where lower(nombre) = lower(v_cat) limit 1;
      if v_cat_id is null then
        insert into sgc.categorias_inventario (nombre) values (v_cat) returning id into v_cat_id;
      end if;
      v_id := null;
      if v_ref is not null then select id into v_id from sgc.articulos where odoo_ref = v_ref limit 1; end if;
      if v_id is null then
        select id into v_id from sgc.articulos where lower(codigo) = lower(v_codigo) or lower(nombre) = lower(v_nombre) limit 1;
      end if;
      if v_id is null then
        insert into sgc.articulos (codigo, nombre, categoria_id, unidad, es_prueba, importacion_id, odoo_ref)
        values (v_codigo, v_nombre, v_cat_id, v_unidad, v_prueba, p_importacion_id, v_ref);
        v_nuevos := v_nuevos + 1;
      else
        update sgc.articulos set odoo_ref = coalesce(v_ref, odoo_ref) where id = v_id;  -- no pisa nombre/código; guarda odoo_ref
        v_act := v_act + 1;
      end if;
    exception when others then
      v_err := v_err || jsonb_build_object('i', v_i, 'motivo', left(coalesce(sqlerrm,'error'),160));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_err);
end;
$function$;

commit;
