-- CF7 — Documentos reales de Sonia: subir Word, variables propias, versiones, config legal
-- -------------------------------------------------------------------------------------
-- Campos aditivos para el mapa de variables del contrato real + almacenamiento del .docx
-- original + versionado de plantillas (CE7) + configuración legal (empresa, testigos,
-- plantilla por defecto por tipo). Todo editable por legal/abogado/admin, sin Tecnología.
-- -------------------------------------------------------------------------------------

-- ── (1) Campos aditivos para las variables del contrato ───────────────────────────────
alter table sgc.personal_obra
  add column if not exists domicilio   text,
  add column if not exists tarifa_hora numeric(12,2);
-- proyectos.cliente YA existe. empresa: gerente general + testigos frecuentes.
alter table sgc.empresa
  add column if not exists gerente_general    text,
  add column if not exists testigos_frecuentes jsonb not null default '[]'::jsonb;

-- ── (2) Plantillas: .docx original + variables propias + plantilla por defecto ────────
alter table sgc.plantillas_documento
  add column if not exists docx_path  text,                       -- .docx original subido (bucket plantillas-docx)
  add column if not exists variables  jsonb not null default '[]'::jsonb,  -- variables propias de Sonia
  add column if not exists es_default boolean not null default false,       -- plantilla por defecto de su categoría
  add column if not exists version    int not null default 1;

-- Bucket privado para los .docx originales de las plantillas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plantillas-docx', 'plantillas-docx', false, 10485760,
        array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict (id) do nothing;
drop policy if exists "plantillas-docx: leer" on storage.objects;
create policy "plantillas-docx: leer" on storage.objects for select to authenticated
  using (bucket_id = 'plantillas-docx' and (sgc.is_admin() or sgc.tiene_modulo('plantillas') or sgc.tiene_modulo('legal')));
drop policy if exists "plantillas-docx: subir" on storage.objects;
create policy "plantillas-docx: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'plantillas-docx' and (sgc.is_admin() or sgc.tiene_modulo('plantillas') or sgc.tiene_modulo('legal')));

-- ── (3) Versionado de plantillas (CE7) ────────────────────────────────────────────────
create table if not exists sgc.plantillas_documento_versiones (
  id             uuid primary key default gen_random_uuid(),
  plantilla_id   uuid not null references sgc.plantillas_documento(id) on delete cascade,
  version        int not null,
  nombre         text not null,
  contenido_html text not null,
  campos         jsonb not null default '[]'::jsonb,
  variables      jsonb not null default '[]'::jsonb,
  docx_path      text,
  motivo         text,
  creado_por     uuid references sgc.usuarios(id),
  created_at     timestamptz not null default now(),
  unique (plantilla_id, version)
);
comment on table sgc.plantillas_documento_versiones is 'CF7/CE7 — historial de versiones de las plantillas de documento.';
alter table sgc.plantillas_documento_versiones enable row level security;
drop policy if exists "plantilla_versiones: ver" on sgc.plantillas_documento_versiones;
create policy "plantilla_versiones: ver" on sgc.plantillas_documento_versiones for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('plantillas') or sgc.tiene_modulo('legal'));
grant select on sgc.plantillas_documento_versiones to authenticated;
grant select, insert on sgc.plantillas_documento_versiones to service_role;

-- Guardar una versión (snapshot de la plantilla actual antes de sobrescribir).
create or replace function sgc.guardar_plantilla_version(p_plantilla uuid, p_motivo text default null)
returns int
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_ver int;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('plantillas') or sgc.tiene_modulo('legal')) then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  select coalesce(max(version),0)+1 into v_ver from sgc.plantillas_documento_versiones where plantilla_id = p_plantilla;
  insert into sgc.plantillas_documento_versiones (plantilla_id, version, nombre, contenido_html, campos, variables, docx_path, motivo, creado_por)
  select id, v_ver, nombre, contenido_html, coalesce(campos,'[]'::jsonb), coalesce(variables,'[]'::jsonb), docx_path, p_motivo, auth.uid()
  from sgc.plantillas_documento where id = p_plantilla;
  update sgc.plantillas_documento set version = v_ver where id = p_plantilla;
  return v_ver;
end;
$function$;
grant execute on function sgc.guardar_plantilla_version(uuid, text) to authenticated;

-- Listar versiones.
create or replace function sgc.plantilla_versiones_listar(p_plantilla uuid)
returns jsonb
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(to_jsonb(v)
    || jsonb_build_object('creado_por_nombre', (select u.nombre from sgc.usuarios u where u.id = v.creado_por))
    order by v.version desc), '[]'::jsonb)
  from sgc.plantillas_documento_versiones v
  where v.plantilla_id = p_plantilla
    and (sgc.is_admin() or sgc.tiene_modulo('plantillas') or sgc.tiene_modulo('legal'));
$function$;
grant execute on function sgc.plantilla_versiones_listar(uuid) to authenticated;

-- Restaurar una versión anterior (guarda antes la actual como nueva versión).
create or replace function sgc.restaurar_plantilla_version(p_plantilla uuid, p_version int)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_row sgc.plantillas_documento_versiones;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('plantillas') or sgc.tiene_modulo('legal')) then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  select * into v_row from sgc.plantillas_documento_versiones where plantilla_id = p_plantilla and version = p_version;
  if not found then raise exception 'Versión no encontrada' using errcode='P0002'; end if;
  perform sgc.guardar_plantilla_version(p_plantilla, 'Antes de restaurar la v'||p_version);
  update sgc.plantillas_documento set
    nombre = v_row.nombre, contenido_html = v_row.contenido_html,
    campos = v_row.campos, variables = v_row.variables, docx_path = v_row.docx_path
  where id = p_plantilla;
end;
$function$;
grant execute on function sgc.restaurar_plantilla_version(uuid, int) to authenticated;

-- Marcar una plantilla como la por defecto de su categoría (desmarca las demás).
create or replace function sgc.set_plantilla_default(p_plantilla uuid)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_cat text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('plantillas') or sgc.tiene_modulo('legal')) then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  select categoria into v_cat from sgc.plantillas_documento where id = p_plantilla;
  if v_cat is null then raise exception 'Plantilla no encontrada' using errcode='P0002'; end if;
  update sgc.plantillas_documento set es_default = (id = p_plantilla) where categoria = v_cat;
end;
$function$;
grant execute on function sgc.set_plantilla_default(uuid) to authenticated;
