-- =============================================================================
-- PROMPT-7 FASE 4 (AV4) — Ficha del personal de obra (aseguramiento + cuadrilla +
-- foto cara/documento) + import de listados como CICLO periódico (diff/historial/
-- bajas). Ronda 24/08/2026 (IDs AV). Aditivo, idempotente, retrocompatible.
--
-- Base AR1 ya existente: `personal_obra` (+ lote_import, es_prueba), `personal_obra_fotos`
-- (con `tipo`), `cargos`, RPC `importar_personal_obra`, `puede_ver/gestionar_personal_obra`
-- (cubren admin/proyectos/rrhh/direccion + responsable + N:M ingenieros AV3).
-- `personal_obra` está VACÍA en prod → extender es seguro.
--
-- Defaults aprobados por Xaviel ("do the best" + OK explícito):
--   • Asegurado = flag manual + fecha + documento de respaldo opcional.
--   • Tipos de documento: cedula / id_permiso_trabajo / pasaporte.
--   • Bajas del listado nuevo = se SEÑALAN; RRHH confirma (no automático).
--   • Foto cara y foto documento = dos registros distintos en personal_obra_fotos.tipo.
--   • Acceso = puede_ver/gestionar_personal_obra (ya incluye ingenieros de la obra).
-- =============================================================================

begin;

-- ── 1) Campos de ficha (aditivos) ─────────────────────────────────────────────
alter table sgc.personal_obra
  add column if not exists cuadrilla text,                       -- eje TECNICO (varillero/carpintero/ayudante/capataz)
  add column if not exists aseguramiento_estado text not null default 'desconocido',
  add column if not exists aseguramiento_fecha date,
  add column if not exists aseguramiento_doc_path text,
  add column if not exists activo_en_obra boolean not null default true;

do $$ begin
  alter table sgc.personal_obra
    add constraint personal_obra_aseguramiento_chk
    check (aseguramiento_estado in ('asegurado','no_asegurado','desconocido'));
exception when duplicate_object then null; end $$;

comment on column sgc.personal_obra.cuadrilla is 'AV4 — eje TECNICO (cuadrilla): varillero/carpintero/ayudante/capataz…';
comment on column sgc.personal_obra.aseguramiento_estado is 'AV4 — asegurado|no_asegurado|desconocido (flag manual).';
comment on column sgc.personal_obra.activo_en_obra is 'AV4 — activo en la obra (el ciclo de import da de baja a los que ya no vienen).';

-- ── 2) Historial de listados (cabecera de cada import periódico) ──────────────
create table if not exists sgc.personal_obra_listados (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  fecha_listado date,
  enc_obra text,
  archivo_nombre text,
  total_altas int not null default 0,
  total_actualizados int not null default 0,
  total_bajas int not null default 0,
  es_prueba boolean not null default false,
  importado_por uuid references sgc.usuarios(id),
  created_at timestamptz not null default now()
);
comment on table sgc.personal_obra_listados is 'AV4 — cabecera de cada listado importado (trazabilidad: quién estuvo en qué obra y cuándo). personal_obra.lote_import = este id.';
create index if not exists ix_personal_obra_listados_proy on sgc.personal_obra_listados (proyecto_id, created_at desc);

alter table sgc.personal_obra_listados enable row level security;
do $$ begin
  create policy personal_obra_listados_sel on sgc.personal_obra_listados
    for select using (sgc.puede_ver_personal_obra(proyecto_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy personal_obra_listados_ins on sgc.personal_obra_listados
    for insert with check (sgc.puede_gestionar_personal_obra(proyecto_id));
exception when duplicate_object then null; end $$;
grant select, insert on sgc.personal_obra_listados to authenticated, service_role;

-- ── 3) Preview del import: diff contra el estado actual (sin escribir) ────────
-- Devuelve {altas, actualizaciones (con antes→después), bajas (activos que ya no vienen)}.
create or replace function sgc.personal_obra_import_preview(p_proyecto_id uuid, p_rows jsonb)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_row jsonb; v_doc text; v_nombre text; v_existe sgc.personal_obra%rowtype;
  v_altas jsonb := '[]'::jsonb; v_act jsonb := '[]'::jsonb; v_bajas jsonb := '[]'::jsonb;
  v_docs text[] := array[]::text[];
begin
  if not sgc.puede_ver_personal_obra(p_proyecto_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows debe ser un arreglo' using errcode = 'AT400';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_nombre := nullif(trim(v_row->>'nombre'), '');
    v_doc := nullif(trim(v_row->>'documento_numero'), '');
    if v_nombre is null then continue; end if;
    if v_doc is not null then v_docs := v_docs || v_doc; end if;

    v_existe := null;
    if v_doc is not null then
      select * into v_existe from sgc.personal_obra
       where proyecto_id = p_proyecto_id and documento_numero = v_doc limit 1;
    end if;

    if v_existe.id is not null then
      v_act := v_act || jsonb_build_object(
        'id', v_existe.id, 'documento_numero', v_doc,
        'antes', jsonb_build_object('nombre', v_existe.nombre, 'nacionalidad', v_existe.nacionalidad, 'cuadrilla', v_existe.cuadrilla, 'activo_en_obra', v_existe.activo_en_obra),
        'despues', jsonb_build_object('nombre', v_nombre, 'nacionalidad', nullif(trim(v_row->>'nacionalidad'),''), 'cuadrilla', nullif(trim(v_row->>'cuadrilla'),'')));
    else
      v_altas := v_altas || jsonb_build_object('nombre', v_nombre, 'documento_numero', v_doc,
        'nacionalidad', nullif(trim(v_row->>'nacionalidad'),''), 'cuadrilla', nullif(trim(v_row->>'cuadrilla'),''));
    end if;
  end loop;

  -- Bajas: activos en la obra cuyo documento NO viene en el listado nuevo.
  select coalesce(jsonb_agg(jsonb_build_object('id', po.id, 'nombre', po.nombre, 'documento_numero', po.documento_numero, 'cuadrilla', po.cuadrilla)), '[]'::jsonb)
    into v_bajas
  from sgc.personal_obra po
  where po.proyecto_id = p_proyecto_id
    and coalesce(po.activo_en_obra, true)
    and po.documento_numero is not null
    and not (po.documento_numero = any(v_docs));

  return jsonb_build_object('altas', v_altas, 'actualizaciones', v_act, 'bajas', v_bajas);
end;
$$;
grant execute on function sgc.personal_obra_import_preview(uuid, jsonb) to authenticated, service_role;

-- ── 4) Import como CICLO: cabecera de listado + upsert (con cuadrilla) + bajas ─
-- p_bajas = ids de personal_obra confirmados como baja por RRHH (se marcan inactivo).
-- Retrocompatible: `importar_personal_obra` (AT5) sigue existiendo intacto.
create or replace function sgc.importar_listado_personal_obra(
  p_proyecto_id uuid,
  p_rows jsonb,
  p_lote uuid,
  p_fecha_listado date default null,
  p_enc_obra text default null,
  p_archivo text default null,
  p_bajas uuid[] default null
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'public'
as $$
declare
  v_row jsonb; v_i int := 0;
  v_creados int := 0; v_actualizados int := 0; v_bajas int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_doc text; v_nombre text; v_existe uuid; v_es_prueba boolean;
begin
  if not sgc.puede_gestionar_personal_obra(p_proyecto_id) then
    raise exception 'No autorizado para gestionar el personal de esta obra' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows debe ser un arreglo' using errcode = 'AT400';
  end if;

  select coalesce(es_prueba, false) into v_es_prueba from sgc.proyectos where id = p_proyecto_id;

  -- Cabecera del listado (id = lote, para enlazar con personal_obra.lote_import).
  insert into sgc.personal_obra_listados (id, proyecto_id, fecha_listado, enc_obra, archivo_nombre, es_prueba, importado_por)
  values (coalesce(p_lote, gen_random_uuid()), p_proyecto_id, p_fecha_listado, nullif(trim(p_enc_obra),''), nullif(trim(p_archivo),''), coalesce(v_es_prueba,false), auth.uid())
  on conflict (id) do update set fecha_listado = excluded.fecha_listado, enc_obra = excluded.enc_obra, archivo_nombre = excluded.archivo_nombre;

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
        update sgc.personal_obra set
          nombre = v_nombre,
          apellido = coalesce(nullif(trim(v_row->>'apellido'), ''), apellido),
          nacionalidad = coalesce(nullif(trim(v_row->>'nacionalidad'), ''), nacionalidad),
          tipo_documento = coalesce(nullif(trim(v_row->>'tipo_documento'), ''), tipo_documento),
          cargo_id = coalesce(nullif(v_row->>'cargo_id','')::uuid, cargo_id),
          cuadrilla = coalesce(nullif(trim(v_row->>'cuadrilla'), ''), cuadrilla),
          notas = coalesce(nullif(trim(v_row->>'notas'), ''), notas),
          activo_en_obra = true,       -- reaparece en el listado → sigue activo
          estado = coalesce(nullif(estado,''), 'activo'),
          lote_import = coalesce(p_lote, lote_import),
          updated_at = now()
        where id = v_existe;
        v_actualizados := v_actualizados + 1;
      else
        insert into sgc.personal_obra
          (proyecto_id, nombre, apellido, nacionalidad, tipo_documento, documento_numero,
           cargo_id, cuadrilla, notas, activo_en_obra, estado, registrado_por, lote_import)
        values (
          p_proyecto_id, v_nombre, nullif(trim(v_row->>'apellido'), ''),
          coalesce(nullif(trim(v_row->>'nacionalidad'), ''), 'dominicano'),
          coalesce(nullif(trim(v_row->>'tipo_documento'), ''), 'cedula'),
          v_doc, nullif(v_row->>'cargo_id','')::uuid, nullif(trim(v_row->>'cuadrilla'), ''),
          nullif(trim(v_row->>'notas'), ''), true, 'activo', auth.uid(), p_lote);
        v_creados := v_creados + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('fila', v_i, 'documento', v_doc, 'msg', SQLERRM);
    end;
  end loop;

  -- Bajas CONFIRMADAS por RRHH (no automáticas): marcar inactivo en obra.
  if p_bajas is not null and array_length(p_bajas, 1) is not null then
    update sgc.personal_obra
       set activo_en_obra = false, estado = 'inactivo', updated_at = now()
     where proyecto_id = p_proyecto_id and id = any(p_bajas);
    get diagnostics v_bajas = row_count;
  end if;

  update sgc.personal_obra_listados
     set total_altas = v_creados, total_actualizados = v_actualizados, total_bajas = v_bajas
   where id = p_lote;

  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados,
                            'bajas', v_bajas, 'errores', v_errores);
end;
$$;
grant execute on function sgc.importar_listado_personal_obra(uuid, jsonb, uuid, date, text, text, uuid[]) to authenticated, service_role;

commit;
