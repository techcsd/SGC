-- BO3 (§E-2, re-pegada) — Importación de proveedores FILA A FILA con reporte.
-- Nota #16: "Importación completada 0/0/1585 con error". La causa (UNIQUE nombre +
-- duplicados) y la UI (catch + dedup + Estado) ya están en prod (1.128.0). DEFAULT: se
-- completa con un RPC fila a fila (patrón importar_personal_obra) para que una fila mala
-- no tumbe el lote entero: cada fila en su propio begin/exception.

begin;

create or replace function sgc.importar_proveedores(p_filas jsonb, p_modo text DEFAULT 'actualizar'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_row jsonb; v_i int := 0;
  v_nuevos int := 0; v_actualizados int := 0; v_saltados int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_nombre text; v_rnc text; v_existe uuid; v_fila int;
begin
  -- Gate = el mismo de la RLS de insert de proveedores.
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
    begin
      if v_nombre is null then
        v_errores := v_errores || jsonb_build_object('fila', v_fila, 'nombre', null, 'rnc', v_rnc, 'msg', 'Falta el nombre');
        continue;
      end if;

      -- Dedup por RNC o nombre normalizado.
      v_existe := null;
      select id into v_existe from sgc.proveedores
       where (v_rnc is not null and rnc = v_rnc)
          or lower(btrim(nombre)) = lower(btrim(v_nombre))
       limit 1;

      if v_existe is not null then
        if p_modo = 'saltar' then
          v_saltados := v_saltados + 1;
          continue;
        end if;
        update sgc.proveedores set
          nombre = v_nombre,
          rnc = coalesce(v_rnc, rnc),
          contacto = coalesce(nullif(btrim(v_row->>'contacto'),''), contacto),
          telefono = coalesce(nullif(btrim(v_row->>'telefono'),''), telefono),
          email = coalesce(nullif(btrim(v_row->>'email'),''), email),
          direccion = coalesce(nullif(btrim(v_row->>'direccion'),''), direccion),
          activo = coalesce((v_row->>'activo')::boolean, activo),
          is_hardware_store = coalesce((v_row->>'is_hardware_store')::boolean, is_hardware_store)
        where id = v_existe;
        v_actualizados := v_actualizados + 1;
      else
        insert into sgc.proveedores (nombre, rnc, contacto, telefono, email, direccion, activo, is_hardware_store)
        values (
          v_nombre, v_rnc,
          nullif(btrim(v_row->>'contacto'),''),
          nullif(btrim(v_row->>'telefono'),''),
          nullif(btrim(v_row->>'email'),''),
          nullif(btrim(v_row->>'direccion'),''),
          coalesce((v_row->>'activo')::boolean, true),
          coalesce((v_row->>'is_hardware_store')::boolean, false)
        );
        v_nuevos := v_nuevos + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('fila', v_fila, 'nombre', v_nombre, 'rnc', v_rnc, 'msg', SQLERRM);
    end;
  end loop;

  return jsonb_build_object(
    'nuevos', v_nuevos, 'actualizados', v_actualizados, 'saltados', v_saltados,
    'errores', v_errores);
end $function$;

grant execute on function sgc.importar_proveedores(jsonb, text) to authenticated;

commit;
