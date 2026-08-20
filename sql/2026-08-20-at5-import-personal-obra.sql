-- ============================================================================
-- AT5 — Import de personal de obra desde Excel (formato real de Sonia).
-- Aditivo: reutiliza el modelo AR1 (personal_obra + cargos). Import atómico con
-- dedupe por número de documento y capacidad de DESHACER el lote.
-- ============================================================================
set search_path = sgc, public;

-- Marca de lote de importación (para poder deshacer todo el lote de una vez).
alter table sgc.personal_obra add column if not exists lote_import uuid;
create index if not exists idx_personal_obra_lote on sgc.personal_obra (lote_import) where lote_import is not null;

-- El Excel trae OCUPACION=INGENIERO en varias filas, pero el catálogo AR1 no tenía
-- un cargo "Ingeniero" — se agrega (idempotente) para poder mapearlo sin inventar.
insert into sgc.cargos (codigo, nombre, categoria, orden)
values ('ING', 'Ingeniero', 'supervision', 15)
on conflict (codigo) do nothing;

-- ── Import atómico con dedupe por documento + reporte por fila ───────────────
-- p_rows: [{ nombre, apellido, nacionalidad, tipo_documento, documento_numero,
--            cargo_id, notas }]
-- p_modo: 'actualizar' (si el documento ya existe en la obra, actualiza) | 'saltar'.
-- Devuelve { creados, actualizados, saltados, errores:[{fila, documento, msg}] }.
create or replace function sgc.importar_personal_obra(
  p_proyecto_id uuid, p_rows jsonb, p_lote uuid, p_modo text default 'actualizar'
) returns jsonb
language plpgsql security definer set search_path = sgc, public as $$
declare
  v_row jsonb; v_i int := 0;
  v_creados int := 0; v_actualizados int := 0; v_saltados int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_doc text; v_nombre text; v_existe uuid;
begin
  if not sgc.puede_gestionar_personal_obra(p_proyecto_id) then
    raise exception 'No autorizado para gestionar el personal de esta obra' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows debe ser un arreglo' using errcode = 'AT400';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_nombre := nullif(trim(v_row->>'nombre'), '');
    v_doc := nullif(trim(v_row->>'documento_numero'), '');
    begin
      if v_nombre is null then
        v_errores := v_errores || jsonb_build_object('fila', v_i, 'documento', v_doc, 'msg', 'Falta el nombre');
        continue;
      end if;

      v_existe := null;
      if v_doc is not null then
        select id into v_existe from sgc.personal_obra
         where proyecto_id = p_proyecto_id and documento_numero = v_doc limit 1;
      end if;

      if v_existe is not null then
        if p_modo = 'saltar' then
          v_saltados := v_saltados + 1;
          continue;
        end if;
        update sgc.personal_obra set
          nombre = v_nombre,
          apellido = nullif(trim(v_row->>'apellido'), ''),
          nacionalidad = coalesce(nullif(trim(v_row->>'nacionalidad'), ''), nacionalidad),
          tipo_documento = coalesce(nullif(trim(v_row->>'tipo_documento'), ''), tipo_documento),
          cargo_id = coalesce(nullif(v_row->>'cargo_id','')::uuid, cargo_id),
          notas = coalesce(nullif(trim(v_row->>'notas'), ''), notas),
          updated_at = now()
        where id = v_existe;
        v_actualizados := v_actualizados + 1;
      else
        insert into sgc.personal_obra
          (proyecto_id, nombre, apellido, nacionalidad, tipo_documento, documento_numero,
           cargo_id, notas, registrado_por, lote_import)
        values (
          p_proyecto_id, v_nombre, nullif(trim(v_row->>'apellido'), ''),
          coalesce(nullif(trim(v_row->>'nacionalidad'), ''), 'dominicano'),
          coalesce(nullif(trim(v_row->>'tipo_documento'), ''), 'cedula'),
          v_doc, nullif(v_row->>'cargo_id','')::uuid,
          nullif(trim(v_row->>'notas'), ''), auth.uid(), p_lote);
        v_creados := v_creados + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('fila', v_i, 'documento', v_doc, 'msg', SQLERRM);
    end;
  end loop;

  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados,
                            'saltados', v_saltados, 'errores', v_errores);
end;
$$;
grant execute on function sgc.importar_personal_obra(uuid, jsonb, uuid, text) to authenticated, service_role;

-- Deshacer un lote de import: elimina SOLO las filas creadas por ese lote (las
-- actualizaciones no se revierten). Devuelve cuántas se eliminaron.
create or replace function sgc.deshacer_lote_personal(p_lote uuid)
returns int
language plpgsql security definer set search_path = sgc, public as $$
declare v_proyecto uuid; v_n int := 0;
begin
  select proyecto_id into v_proyecto from sgc.personal_obra where lote_import = p_lote limit 1;
  if v_proyecto is null then return 0; end if;
  if not sgc.puede_gestionar_personal_obra(v_proyecto) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  delete from sgc.personal_obra where lote_import = p_lote;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.deshacer_lote_personal(uuid) to authenticated, service_role;
