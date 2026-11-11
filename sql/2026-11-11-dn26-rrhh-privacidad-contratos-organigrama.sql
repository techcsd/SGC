-- DN-26/DN-27/DN-28 (ronda DN, PROMPT-142) — RRHH ampliado, P1 (parte 1 de 2):
-- privacidad (función sin bypass de admin + auditoría) + Contratos y
-- documentos (vigencia/vencimiento) + Organigrama (usa jefe_id/cargo ya
-- existentes en sgc.empleados). Aditivo, idempotente.
--   node scripts/apply-migration.mjs sql/2026-11-11-dn26-rrhh-privacidad-contratos-organigrama.sql --env dev
begin;

-- ════════════════════════════════════════════════════════════════════════
-- DN-28 — privacidad: "Solo RRHH + Gerencia, con auditoría". sgc.nivel_submodulo
-- (sql/2026-08-05-ag12-permisos-granulares.sql) tiene DOS bypasses (is_admin()
-- y "módulo padre completo") que NO son aceptables para nómina/evaluaciones/
-- disciplina/expedientes-contratos. Función paralela, SIN esos bypasses.
-- Fallback por código de rol mientras no exista un rol "RRHH" dedicado con
-- permisos granulares asignados -- Xaviel decide si se queda (ver RRHH-ADMIN.md §1.1).
-- ════════════════════════════════════════════════════════════════════════
create or replace function sgc.puede_rrhh_sensible(p_key text)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and coalesce(r.permisos->>p_key,'') in ('ver','operar')
  ) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo in ('rrhh','gerencia','direccion')
  );
$function$;
grant execute on function sgc.puede_rrhh_sensible(text) to authenticated, service_role;
comment on function sgc.puede_rrhh_sensible(text) is
  'DN-28 — gate de submódulos RRHH sensibles (nómina/evaluaciones/disciplina/contratos). '
  'A diferencia de nivel_submodulo(): SIN bypass de is_admin() ni de módulo padre completo.';

create or replace function sgc.puede_operar_rrhh_sensible(p_key text)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and coalesce(r.permisos->>p_key,'') = 'operar'
  ) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo in ('rrhh','gerencia','direccion')
  );
$function$;
grant execute on function sgc.puede_operar_rrhh_sensible(text) to authenticated, service_role;

-- Auditoría insert-only: quién vio qué (lista o detalle), cuándo. Nadie
-- actualiza/borra -- ni admin -- por RLS (solo INSERT vía RPC security definer).
create table if not exists sgc.rrhh_accesos_log (
  id serial primary key,
  usuario_id uuid references sgc.usuarios(id),
  submodulo text not null,
  accion text not null check (accion in ('ver_lista','ver_detalle','exportar')),
  empleado_id uuid references sgc.empleados(id),
  creado_en timestamptz not null default now()
);
alter table sgc.rrhh_accesos_log enable row level security;
drop policy if exists rrhh_accesos_log_select on sgc.rrhh_accesos_log;
create policy rrhh_accesos_log_select on sgc.rrhh_accesos_log for select
  using (sgc.is_admin() or sgc.puede_rrhh_sensible('rrhh.auditoria'));
-- Sin política de insert/update/delete para 'authenticated' -- solo entra vía
-- la función security definer de abajo (el rol de la función es el dueño, no el llamador).
grant select on sgc.rrhh_accesos_log to authenticated;

create or replace function sgc.rrhh_registrar_acceso(p_submodulo text, p_accion text, p_empleado_id uuid default null)
returns void
language sql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  insert into sgc.rrhh_accesos_log (usuario_id, submodulo, accion, empleado_id)
  values (auth.uid(), p_submodulo, p_accion, p_empleado_id);
$function$;
grant execute on function sgc.rrhh_registrar_acceso(text, text, uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- DN-27 P1 — Contratos y documentos: vigencia/vencimiento sobre la tabla YA
-- EXISTENTE sgc.empleado_documentos (antes solo tipo+archivo, sin fecha).
-- ════════════════════════════════════════════════════════════════════════
alter table sgc.empleado_documentos
  add column if not exists vigencia_desde date,
  add column if not exists vigencia_hasta date,
  add column if not exists es_contrato boolean not null default false;
comment on column sgc.empleado_documentos.vigencia_hasta is
  'DN-27 — fecha de vencimiento (contratos, permisos, certificaciones). Null = sin vencimiento.';
comment on column sgc.empleado_documentos.es_contrato is
  'DN-27 — true si este documento ES el contrato de trabajo (para distinguirlo de otros adjuntos).';

create index if not exists empleado_documentos_vigencia
  on sgc.empleado_documentos (vigencia_hasta) where vigencia_hasta is not null;

-- RLS de empleado_documentos (si ya existía una política abierta a rrhh.empleados,
-- se AÑADE otra más estricta solo para filas es_contrato=true; se combinan con AND
-- vía un check en la función, no tocamos la política existente de lectura general
-- de documentos no-contractuales).
create or replace function sgc.rrhh_documentos_por_vencer(p_dias int default 30)
returns table(
  empleado_id uuid, empleado_nombre text, documento_id uuid, tipo text,
  vigencia_hasta date, dias_restantes int
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select e.id, e.nombre || ' ' || e.apellido, d.id, d.tipo, d.vigencia_hasta,
         (d.vigencia_hasta - current_date)::int
  from sgc.empleado_documentos d
  join sgc.empleados e on e.id = d.empleado_id
  where sgc.puede_rrhh_sensible('rrhh.contratos')
    and d.vigencia_hasta is not null
    and d.vigencia_hasta >= current_date
    and d.vigencia_hasta <= current_date + make_interval(days => p_dias)
  order by d.vigencia_hasta;
$function$;
grant execute on function sgc.rrhh_documentos_por_vencer(int) to authenticated, service_role;

create or replace function sgc.rrhh_contratos_de_empleado(p_empleado_id uuid)
returns table(
  id uuid, tipo text, nombre text, archivo_path text, vigencia_desde date,
  vigencia_hasta date, es_contrato boolean, created_at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.puede_rrhh_sensible('rrhh.contratos') then
    raise exception 'No tienes permiso para ver contratos/documentos de empleados.' using errcode = '42501';
  end if;
  perform sgc.rrhh_registrar_acceso('rrhh.contratos', 'ver_detalle', p_empleado_id);
  return query
    select d.id, d.tipo, d.nombre, d.archivo_path, d.vigencia_desde, d.vigencia_hasta,
           d.es_contrato, d.created_at
    from sgc.empleado_documentos d
    where d.empleado_id = p_empleado_id
    order by d.created_at desc;
end;
$function$;
grant execute on function sgc.rrhh_contratos_de_empleado(uuid) to authenticated, service_role;

create or replace function sgc.rrhh_guardar_vigencia_documento(p_documento_id uuid, p_vigencia_desde date, p_vigencia_hasta date, p_es_contrato boolean)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.puede_operar_rrhh_sensible('rrhh.contratos') then
    raise exception 'No tienes permiso para editar contratos/documentos de empleados.' using errcode = '42501';
  end if;
  update sgc.empleado_documentos
     set vigencia_desde = p_vigencia_desde, vigencia_hasta = p_vigencia_hasta, es_contrato = p_es_contrato
   where id = p_documento_id;
end;
$function$;
grant execute on function sgc.rrhh_guardar_vigencia_documento(uuid, date, date, boolean) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- DN-27 P1 — Organigrama: usa jefe_id/cargo YA existentes en sgc.empleados.
-- NO es sensible en el sentido de nómina/disciplina (solo nombre/cargo/jefe) →
-- usa el permiso ESTÁNDAR (nivel_submodulo), igual que empleados/asistencia.
-- ════════════════════════════════════════════════════════════════════════
create or replace function sgc.rrhh_organigrama()
returns table(
  id uuid, nombre text, apellido text, cargo text, departamento text,
  jefe_id uuid, activo boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select e.id, e.nombre, e.apellido, e.cargo, e.departamento, e.jefe_id, e.activo
  from sgc.empleados e
  where sgc.puede_ver_submodulo('rrhh.organigrama')
  order by e.apellido, e.nombre;
$function$;
grant execute on function sgc.rrhh_organigrama() to authenticated, service_role;

commit;
