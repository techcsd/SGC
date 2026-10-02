-- CF1 — Firma del empleador y de los testigos (opcional: ahora / después / en papel)
-- -------------------------------------------------------------------------------------
-- Hoy sólo firma el TRABAJADOR (personal-registro paso 3 → personal_obra_firmas).  El
-- contrato real de Sonia tiene 4 líneas de firma: EL EMPLEADOR · EL TRABAJADOR · Testigo
-- · Testigo.  CF1 modela las líneas por rol como hijas del documento firmado, cada una
-- con su estado (pendiente / firmada digital / firmada en papel).
--
-- Modelo (aditivo, no rompe lo existente):
--   personal_obra_firmas           = el DOCUMENTO firmado (snapshot congelado AZ1).
--   personal_obra_firma_lineas     = una fila por rol (trabajador/empleador/testigo_1/2).
--   La firma del trabajador que ya existe se backfillea como su línea 'trabajador'.
-- -------------------------------------------------------------------------------------

-- ── (1) Tabla de líneas de firma por rol ─────────────────────────────────────────────
create table if not exists sgc.personal_obra_firma_lineas (
  id              uuid primary key default gen_random_uuid(),
  firma_id        uuid not null references sgc.personal_obra_firmas(id) on delete cascade,
  rol             text not null check (rol in ('trabajador','empleador','testigo_1','testigo_2')),
  estado          text not null default 'pendiente' check (estado in ('pendiente','firmado','papel')),
  metodo          text check (metodo in ('pad','foto','fisico')),
  firma_path      text,                                   -- PNG del pad, o foto/escaneo si 'fisico'
  firmante_nombre text,                                   -- nombre del testigo/empleador (si aplica)
  firmante_cedula text,                                   -- cédula del testigo (si aplica)
  firmado_por     uuid references sgc.usuarios(id),       -- usuario del sistema que registró la firma
  firmado_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (firma_id, rol)
);
comment on table sgc.personal_obra_firma_lineas is 'CF1 — líneas de firma por rol de un documento de personal (empleador/testigos, además del trabajador).';
create index if not exists idx_firma_lineas_firma on sgc.personal_obra_firma_lineas(firma_id);
create index if not exists idx_firma_lineas_pendientes on sgc.personal_obra_firma_lineas(estado) where estado = 'pendiente';

alter table sgc.personal_obra_firma_lineas enable row level security;
-- Visibilidad/edición = la misma del documento padre (vía personal_obra → obra).
drop policy if exists "firma_lineas: ver" on sgc.personal_obra_firma_lineas;
create policy "firma_lineas: ver" on sgc.personal_obra_firma_lineas for select to authenticated
  using (exists (
    select 1 from sgc.personal_obra_firmas f join sgc.personal_obra po on po.id = f.personal_id
    where f.id = personal_obra_firma_lineas.firma_id and sgc.puede_ver_personal_obra(po.proyecto_id)
  ));
drop policy if exists "firma_lineas: gestionar" on sgc.personal_obra_firma_lineas;
create policy "firma_lineas: gestionar" on sgc.personal_obra_firma_lineas for all to authenticated
  using (exists (
    select 1 from sgc.personal_obra_firmas f join sgc.personal_obra po on po.id = f.personal_id
    where f.id = personal_obra_firma_lineas.firma_id and sgc.puede_ver_personal_obra(po.proyecto_id)
  ))
  with check (exists (
    select 1 from sgc.personal_obra_firmas f join sgc.personal_obra po on po.id = f.personal_id
    where f.id = personal_obra_firma_lineas.firma_id and sgc.puede_ver_personal_obra(po.proyecto_id)
  ));
grant select, insert, update, delete on sgc.personal_obra_firma_lineas to authenticated;

-- ── (2) Backfill: la firma existente del trabajador = su línea 'trabajador' ───────────
insert into sgc.personal_obra_firma_lineas (firma_id, rol, estado, metodo, firma_path, firmado_at)
select f.id, 'trabajador', 'firmado',
       case when f.metodo = 'foto' then 'foto' else 'pad' end,
       f.firma_path, f.firmado_at
from sgc.personal_obra_firmas f
where not exists (
  select 1 from sgc.personal_obra_firma_lineas l where l.firma_id = f.id and l.rol = 'trabajador'
);

-- ── (3) Al crear un documento firmado, sembrar sus líneas por rol ─────────────────────
-- p_roles: lista de roles de firma que el documento necesita además del trabajador.
create or replace function sgc.sembrar_lineas_firma(
  p_firma_id uuid,
  p_roles text[] default array['empleador']::text[]
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare r text;
begin
  -- línea del trabajador (ya firmada: la firma del pad del paso 3)
  insert into sgc.personal_obra_firma_lineas (firma_id, rol, estado, metodo, firma_path, firmado_at)
  select f.id, 'trabajador', 'firmado', case when f.metodo='foto' then 'foto' else 'pad' end, f.firma_path, f.firmado_at
  from sgc.personal_obra_firmas f where f.id = p_firma_id
  on conflict (firma_id, rol) do nothing;
  -- líneas pendientes de los demás roles
  foreach r in array coalesce(p_roles, array['empleador']::text[]) loop
    if r in ('empleador','testigo_1','testigo_2') then
      insert into sgc.personal_obra_firma_lineas (firma_id, rol, estado)
      values (p_firma_id, r, 'pendiente')
      on conflict (firma_id, rol) do nothing;
    end if;
  end loop;
end;
$function$;
grant execute on function sgc.sembrar_lineas_firma(uuid, text[]) to authenticated;

-- ── (4) Firmar / marcar una línea ────────────────────────────────────────────────────
-- metodo 'pad'/'foto' → estado 'firmado' (firma digital);  'fisico' → estado 'papel'.
create or replace function sgc.firmar_linea_documento(
  p_firma_id uuid,
  p_rol text,
  p_metodo text,                 -- 'pad' | 'foto' | 'fisico'
  p_firma_path text default null,
  p_firmante_nombre text default null,
  p_firmante_cedula text default null
) returns jsonb
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_proyecto uuid; v_estado text;
begin
  select po.proyecto_id into v_proyecto
  from sgc.personal_obra_firmas f join sgc.personal_obra po on po.id = f.personal_id
  where f.id = p_firma_id;
  if v_proyecto is null then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
  -- Permiso: firma del empleador/testigos la registra legal/abogado/admin.
  if not (sgc.is_admin() or sgc.tiene_modulo('legal')) then
    raise exception 'Sólo Legal o Administración pueden registrar esta firma' using errcode='42501';
  end if;
  if p_rol not in ('empleador','testigo_1','testigo_2') then
    raise exception 'Rol de firma inválido: %', p_rol using errcode='22023';
  end if;
  v_estado := case when p_metodo = 'fisico' then 'papel' else 'firmado' end;
  insert into sgc.personal_obra_firma_lineas (firma_id, rol, estado, metodo, firma_path, firmante_nombre, firmante_cedula, firmado_por, firmado_at)
  values (p_firma_id, p_rol, v_estado, p_metodo, p_firma_path, nullif(trim(p_firmante_nombre),''), nullif(trim(p_firmante_cedula),''), auth.uid(), now())
  on conflict (firma_id, rol) do update
    set estado = excluded.estado, metodo = excluded.metodo, firma_path = excluded.firma_path,
        firmante_nombre = excluded.firmante_nombre, firmante_cedula = excluded.firmante_cedula,
        firmado_por = excluded.firmado_por, firmado_at = excluded.firmado_at;
  return (select to_jsonb(l) from sgc.personal_obra_firma_lineas l where l.firma_id = p_firma_id and l.rol = p_rol);
end;
$function$;
grant execute on function sgc.firmar_linea_documento(uuid, text, text, text, text, text) to authenticated;

-- ── (5) Líneas de un documento (para pintar estado en el expediente/PDF) ──────────────
create or replace function sgc.lineas_firma_documento(p_firma_id uuid)
returns jsonb
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(to_jsonb(l) order by
           case l.rol when 'empleador' then 1 when 'trabajador' then 2 when 'testigo_1' then 3 else 4 end), '[]'::jsonb)
  from sgc.personal_obra_firma_lineas l
  join sgc.personal_obra_firmas f on f.id = l.firma_id
  join sgc.personal_obra po on po.id = f.personal_id
  where l.firma_id = p_firma_id and sgc.puede_ver_personal_obra(po.proyecto_id);
$function$;
grant execute on function sgc.lineas_firma_documento(uuid) to authenticated;

-- ── (6) Bandeja de firmas pendientes (Legal) ─────────────────────────────────────────
create or replace function sgc.firmas_pendientes_legal()
returns jsonb
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(x order by x->>'firmado_trabajador_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'firma_id', f.id,
      'personal_id', po.id,
      'trabajador', po.nombre || ' ' || coalesce(po.apellido,''),
      'documento_nombre', f.documento_nombre,
      'proyecto', (select p.nombre from sgc.proyectos p where p.id = po.proyecto_id),
      'proyecto_id', po.proyecto_id,
      'firmado_trabajador_at', f.firmado_at,
      'roles_pendientes', (select jsonb_agg(l.rol order by l.rol) from sgc.personal_obra_firma_lineas l
                             where l.firma_id = f.id and l.estado = 'pendiente'),
      'dias', floor(extract(epoch from (now() - f.firmado_at))/86400)::int
    ) as x
    from sgc.personal_obra_firmas f
    join sgc.personal_obra po on po.id = f.personal_id
    where po.eliminado_at is null
      and exists (select 1 from sgc.personal_obra_firma_lineas l where l.firma_id = f.id and l.estado = 'pendiente')
      and (sgc.is_admin() or sgc.tiene_modulo('legal') or sgc.puede_ver_personal_obra(po.proyecto_id))
  ) s;
$function$;
grant execute on function sgc.firmas_pendientes_legal() to authenticated;

-- ── (7) Recordatorio a Legal a los 3 días (cron diario) ──────────────────────────────
create or replace function sgc.recordar_firmas_pendientes()
returns int
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_n int;
begin
  -- documentos con alguna línea pendiente de ≥3 días
  select count(*) into v_n
  from sgc.personal_obra_firmas f
  join sgc.personal_obra po on po.id = f.personal_id and po.eliminado_at is null
  where f.firmado_at < now() - interval '3 days'
    and exists (select 1 from sgc.personal_obra_firma_lineas l where l.firma_id = f.id and l.estado='pendiente');
  if v_n = 0 then return 0; end if;
  -- notificar a los usuarios con módulo legal (fan-out por el helper del sistema)
  perform sgc.notificar_modulo(
    'legal', 'firmas_pendientes',
    'Firmas pendientes de contratos',
    v_n || ' documento(s) de personal esperan la firma del empleador o de testigos (3+ días).',
    '/legal/firmas-pendientes');
  return v_n;
end;
$function$;
