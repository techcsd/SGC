-- ============================================================================
-- AG16 · Gestión de Producción de Obra — FASE 1: No Conformidades e Incidentes
-- (base de calidad/seguridad). Rutinas 2 y 9 del Gerente de Producción de Obra.
--
-- Reutiliza CSD-OPE-01 "Ola 2" (obra_no_conformidades ya existe: aquí se EXTIENDE
-- con el ciclo completo — tipo/fotos/responsable/acción correctiva/verificación).
-- El trigger que bloquea el vaciado con una NC abierta sigue intacto.
--
-- Añade: módulo de permisos `obra` + roles gerente_produccion/capataz (AG12),
-- motor único de acciones correctivas (NC + incidentes), tabla obra_incidentes
-- propia (con puente a bitácora), notificaciones (asignación + vencimiento) y
-- sweep diario de recordatorios.
--
-- Aditivo y retrocompatible. Buckets: reutiliza `obra` (ola3). RLS: obra +
-- proyectos + bitacora + admin + submódulo granular.
-- ============================================================================
set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Módulo `obra` + roles nuevos (AG12)
-- ─────────────────────────────────────────────────────────────────────────────
-- El admin gana el módulo `obra` (gotcha recurrente: array_append al rol admin).
update sgc.roles
  set modulos = array_append(modulos, 'obra')
  where codigo = 'admin' and not ('obra' = any(modulos));

-- Gerente de Producción de Obra: protagonista. Módulo obra completo + bitácora +
-- proyectos (cronograma/obras). permisos={} porque los módulos padre bastan.
insert into sgc.roles (codigo, nombre, modulos, permisos, descripcion)
values (
  'gerente_produccion', 'Gerente de Producción de Obra',
  array['obra','bitacora','proyectos']::text[], '{}'::jsonb,
  'Dirige la producción en obra: plan del día, no conformidades, checklists de calidad, subcontratistas, avance e informe semanal.'
)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      modulos = (select array(select distinct unnest(sgc.roles.modulos || excluded.modulos))),
      descripcion = excluded.descripcion;

-- Capataz: campo. SIN módulo padre (para NO heredar 'operar' en todos los
-- submódulos de obra); solo los submódulos que opera vía permisos granulares.
insert into sgc.roles (codigo, nombre, modulos, permisos, descripcion)
values (
  'capataz', 'Capataz',
  array[]::text[],
  '{"obra.plan_dia":"operar","obra.no_conformidades":"operar","obra.checklists":"operar"}'::jsonb,
  'Ejecuta en campo: ve su plan del día, levanta no conformidades y ejecuta checklists de calidad.'
)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      permisos = sgc.roles.permisos || excluded.permisos,
      descripcion = excluded.descripcion;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) EXTENSIÓN de obra_no_conformidades → ciclo completo (aditivo)
-- ─────────────────────────────────────────────────────────────────────────────
alter table sgc.obra_no_conformidades
  add column if not exists titulo          text,
  add column if not exists tipo            text,   -- calidad|orden_limpieza|epp|seguridad
  add column if not exists ubicacion       text,   -- frente/eje/bloque libre
  add column if not exists responsable_id  uuid references sgc.usuarios(id),
  add column if not exists fotos           text[] not null default '{}',
  add column if not exists fecha_deteccion date   not null default current_date,
  add column if not exists verificada_por  uuid references sgc.usuarios(id),
  add column if not exists verificada_en   timestamptz;

-- tipo: catálogo (nullable para filas legacy).
do $$ begin
  alter table sgc.obra_no_conformidades
    add constraint obra_nc_tipo_chk
    check (tipo is null or tipo in ('calidad','orden_limpieza','epp','seguridad'));
exception when duplicate_object then null; end $$;

-- estado: amplía abierta|cerrada → +en_correccion|verificada (compat: 'cerrada' sigue).
alter table sgc.obra_no_conformidades drop constraint if exists obra_nc_estado_chk;
alter table sgc.obra_no_conformidades
  add constraint obra_nc_estado_chk
  check (estado in ('abierta','en_correccion','verificada','cerrada'));

create index if not exists idx_obra_nc_estado on sgc.obra_no_conformidades(proyecto_id, estado);
create index if not exists idx_obra_nc_responsable on sgc.obra_no_conformidades(responsable_id) where responsable_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Motor único de acciones correctivas (NC + incidentes)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists sgc.obra_acciones_correctivas (
  id               uuid primary key default gen_random_uuid(),
  proyecto_id      uuid not null references sgc.proyectos(id) on delete cascade,
  origen_tipo      text not null check (origen_tipo in ('nc','incidente')),
  origen_id        uuid not null,
  descripcion      text not null,
  responsable_id   uuid references sgc.usuarios(id),
  fecha_compromiso date,
  estado           text not null default 'abierta' check (estado in ('abierta','hecha','verificada')),
  evidencia_fotos  text[] not null default '{}',
  hecha_en         timestamptz,
  hecha_por        uuid references sgc.usuarios(id),
  verificada_en    timestamptz,
  verificada_por   uuid references sgc.usuarios(id),
  ultimo_recordatorio date,          -- antispam del sweep de vencimiento
  creado_por       uuid references sgc.usuarios(id),
  created_at       timestamptz not null default now()
);
create index if not exists idx_acc_correc_origen on sgc.obra_acciones_correctivas(origen_tipo, origen_id);
create index if not exists idx_acc_correc_proyecto on sgc.obra_acciones_correctivas(proyecto_id, estado);
create index if not exists idx_acc_correc_responsable on sgc.obra_acciones_correctivas(responsable_id) where responsable_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Incidentes / casi-accidentes de obra (tabla propia, puente a bitácora)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists sgc.obra_incidentes (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references sgc.proyectos(id) on delete cascade,
  elemento_id  uuid references sgc.obra_elementos(id) on delete set null,
  bitacora_id  uuid references sgc.bitacoras(id) on delete set null,  -- escalado desde parte diario
  tipo         text not null check (tipo in ('casi_accidente','incidente','accidente')),
  descripcion  text not null,
  gravedad     text not null default 'media' check (gravedad in ('baja','media','alta','critica')),
  lesionados   int  not null default 0,
  ubicacion    text,
  investigacion text,
  fotos        text[] not null default '{}',
  fecha        date not null default current_date,
  estado       text not null default 'abierto' check (estado in ('abierto','en_investigacion','cerrado')),
  creado_por   uuid references sgc.usuarios(id),
  cerrado_en   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_obra_incidentes_proyecto on sgc.obra_incidentes(proyecto_id, estado);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RLS + grants (obra + proyectos + bitacora + admin + submódulo granular)
-- ─────────────────────────────────────────────────────────────────────────────
-- NC: se AMPLÍA la política existente para incluir el módulo `obra` y el
-- submódulo granular (permisivas OR → nunca quitan acceso a quien ya lo tenía).
drop policy if exists obra_nc_all on sgc.obra_no_conformidades;
create policy obra_nc_all on sgc.obra_no_conformidades for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_operar_submodulo('obra.no_conformidades'))
  with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_operar_submodulo('obra.no_conformidades'));
drop policy if exists obra_nc_sub_sel on sgc.obra_no_conformidades;
create policy obra_nc_sub_sel on sgc.obra_no_conformidades for select to authenticated
  using (sgc.puede_ver_submodulo('obra.no_conformidades'));

-- Elementos/vaciados: añade `obra` al conjunto de módulos (retrocompat).
drop policy if exists obra_elem_all on sgc.obra_elementos;
create policy obra_elem_all on sgc.obra_elementos for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'))
  with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'));

-- Nuevas tablas: mismo criterio, submódulo obra.no_conformidades.
do $$
declare t text;
begin
  foreach t in array array['obra_acciones_correctivas','obra_incidentes']
  loop
    execute format('alter table sgc.%I enable row level security', t);
    execute format('drop policy if exists %I_all on sgc.%I', t, t);
    execute format($p$create policy %I_all on sgc.%I for all to authenticated
        using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_operar_submodulo('obra.no_conformidades'))
        with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_operar_submodulo('obra.no_conformidades'))$p$, t, t);
    execute format('drop policy if exists %I_sub_sel on sgc.%I', t, t);
    execute format($p$create policy %I_sub_sel on sgc.%I for select to authenticated
        using (sgc.puede_ver_submodulo('obra.no_conformidades'))$p$, t, t);
    execute format('grant select, insert, update, delete on sgc.%I to authenticated', t);
    execute format('grant all on sgc.%I to service_role', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Config de notificaciones (AG14) + eventos de obra
-- ─────────────────────────────────────────────────────────────────────────────
insert into sgc.notificaciones_config (evento, descripcion, in_app, push, email) values
  ('obra_accion_correctiva', 'Acción correctiva asignada a un responsable en obra', true, true, false),
  ('obra_accion_vencida',    'Acción correctiva vencida (recordatorio)',            true, true, false),
  ('obra_incidente_nuevo',   'Incidente / casi-accidente registrado en obra',       true, true, false)
on conflict (evento) do nothing;

-- Helper: ¿el canal está activo para un evento?
create or replace function sgc.obra_notif_activo(p_evento text, p_canal text)
returns boolean language sql stable set search_path to 'sgc','pg_temp' as $$
  select coalesce((
    select case p_canal when 'in_app' then in_app when 'push' then push when 'email' then email else false end
    from sgc.notificaciones_config where evento = p_evento and activo
  ), false);
$$;
grant execute on function sgc.obra_notif_activo(text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) RPCs del ciclo (SECURITY DEFINER, idempotentes por p_id)
-- ─────────────────────────────────────────────────────────────────────────────

-- Levantar No Conformidad.
create or replace function sgc.levantar_nc(
  p_id uuid, p_proyecto_id uuid, p_tipo text, p_titulo text, p_descripcion text,
  p_severidad text default 'media', p_ubicacion text default null,
  p_elemento_id uuid default null, p_vaciado_id uuid default null,
  p_responsable_id uuid default null, p_fotos text[] default '{}',
  p_bloquea_vaciado boolean default false
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid;
begin
  insert into sgc.obra_no_conformidades
    (id, proyecto_id, elemento_id, vaciado_id, titulo, tipo, descripcion, severidad,
     ubicacion, responsable_id, fotos, bloquea_vaciado, estado, creado_por, fecha_deteccion)
  values
    (coalesce(p_id, gen_random_uuid()), p_proyecto_id, p_elemento_id, p_vaciado_id, p_titulo,
     p_tipo, p_descripcion, coalesce(p_severidad,'media'), p_ubicacion, p_responsable_id,
     coalesce(p_fotos,'{}'), coalesce(p_bloquea_vaciado,false), 'abierta', auth.uid(), current_date)
  on conflict (id) do update set
     titulo = excluded.titulo, tipo = excluded.tipo, descripcion = excluded.descripcion,
     severidad = excluded.severidad, ubicacion = excluded.ubicacion,
     responsable_id = excluded.responsable_id, fotos = excluded.fotos,
     elemento_id = excluded.elemento_id, vaciado_id = excluded.vaciado_id,
     bloquea_vaciado = excluded.bloquea_vaciado
  returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.levantar_nc(uuid,uuid,text,text,text,text,text,uuid,uuid,uuid,text[],boolean) to authenticated, service_role;

-- Asignar acción correctiva (a una NC o incidente) + notificar al responsable.
create or replace function sgc.asignar_accion_correctiva(
  p_id uuid, p_proyecto_id uuid, p_origen_tipo text, p_origen_id uuid,
  p_descripcion text, p_responsable_id uuid default null, p_fecha_compromiso date default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid; v_titulo text;
begin
  if p_origen_tipo not in ('nc','incidente') then
    raise exception 'origen_tipo inválido: %', p_origen_tipo;
  end if;

  insert into sgc.obra_acciones_correctivas
    (id, proyecto_id, origen_tipo, origen_id, descripcion, responsable_id, fecha_compromiso, creado_por)
  values
    (coalesce(p_id, gen_random_uuid()), p_proyecto_id, p_origen_tipo, p_origen_id,
     p_descripcion, p_responsable_id, p_fecha_compromiso, auth.uid())
  on conflict (id) do update set
     descripcion = excluded.descripcion, responsable_id = excluded.responsable_id,
     fecha_compromiso = excluded.fecha_compromiso
  returning id into v_id;

  -- La NC pasa a "en corrección" al asignarle una acción.
  if p_origen_tipo = 'nc' then
    update sgc.obra_no_conformidades
      set estado = 'en_correccion'
      where id = p_origen_id and estado = 'abierta';
  elsif p_origen_tipo = 'incidente' then
    update sgc.obra_incidentes
      set estado = 'en_investigacion'
      where id = p_origen_id and estado = 'abierto';
  end if;

  -- Notificar al responsable (in-app + push vía notificar).
  if p_responsable_id is not null and sgc.obra_notif_activo('obra_accion_correctiva','in_app') then
    v_titulo := 'Acción correctiva asignada';
    perform sgc.notificar(
      p_responsable_id, 'warning', v_titulo,
      coalesce(p_descripcion,'Tienes una acción correctiva asignada') ||
        case when p_fecha_compromiso is not null then ' · Vence ' || to_char(p_fecha_compromiso,'DD/MM/YYYY') else '' end,
      '/obra');
  end if;
  return v_id;
end $$;
grant execute on function sgc.asignar_accion_correctiva(uuid,uuid,text,uuid,text,uuid,date) to authenticated, service_role;

-- Marcar acción como hecha (con evidencia).
create or replace function sgc.marcar_accion_hecha(p_accion_id uuid, p_evidencia_fotos text[] default '{}')
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  update sgc.obra_acciones_correctivas
    set estado = 'hecha', hecha_en = now(), hecha_por = auth.uid(),
        evidencia_fotos = coalesce(p_evidencia_fotos, evidencia_fotos)
    where id = p_accion_id;
end $$;
grant execute on function sgc.marcar_accion_hecha(uuid,text[]) to authenticated, service_role;

-- Verificar y cerrar una NC (marca sus acciones verificadas).
create or replace function sgc.verificar_cerrar_nc(p_nc_id uuid, p_nota text default null)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_creador uuid;
begin
  update sgc.obra_acciones_correctivas
    set estado = 'verificada', verificada_en = now(), verificada_por = auth.uid()
    where origen_tipo = 'nc' and origen_id = p_nc_id and estado <> 'verificada';

  update sgc.obra_no_conformidades
    set estado = 'cerrada', verificada_por = auth.uid(), verificada_en = now(), cerrada_en = now()
    where id = p_nc_id
    returning creado_por into v_creador;

  if v_creador is not null then
    perform sgc.notificar(v_creador, 'success', 'No conformidad cerrada',
      coalesce(p_nota,'La no conformidad fue verificada y cerrada.'), '/obra');
  end if;
end $$;
grant execute on function sgc.verificar_cerrar_nc(uuid,text) to authenticated, service_role;

-- Registrar incidente / casi-accidente de obra.
create or replace function sgc.registrar_incidente_obra(
  p_id uuid, p_proyecto_id uuid, p_tipo text, p_descripcion text,
  p_gravedad text default 'media', p_lesionados int default 0, p_ubicacion text default null,
  p_investigacion text default null, p_fotos text[] default '{}',
  p_elemento_id uuid default null, p_bitacora_id uuid default null, p_fecha date default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid; v_uid uuid;
begin
  insert into sgc.obra_incidentes
    (id, proyecto_id, elemento_id, bitacora_id, tipo, descripcion, gravedad, lesionados,
     ubicacion, investigacion, fotos, fecha, creado_por)
  values
    (coalesce(p_id, gen_random_uuid()), p_proyecto_id, p_elemento_id, p_bitacora_id, p_tipo,
     p_descripcion, coalesce(p_gravedad,'media'), coalesce(p_lesionados,0), p_ubicacion,
     p_investigacion, coalesce(p_fotos,'{}'), coalesce(p_fecha, current_date), auth.uid())
  on conflict (id) do update set
     tipo = excluded.tipo, descripcion = excluded.descripcion, gravedad = excluded.gravedad,
     lesionados = excluded.lesionados, ubicacion = excluded.ubicacion,
     investigacion = excluded.investigacion, fotos = excluded.fotos,
     elemento_id = excluded.elemento_id, bitacora_id = excluded.bitacora_id
  returning id into v_id;

  -- Incidente grave/crítico → avisar a los gestores de obra del proyecto.
  if coalesce(p_gravedad,'media') in ('alta','critica') and sgc.obra_notif_activo('obra_incidente_nuevo','in_app') then
    for v_uid in
      select distinct u.id from sgc.usuarios u
      join sgc.usuarios_roles ur on ur.usuario_id = u.id
      join sgc.roles r on r.id = ur.rol_id
      where coalesce(u.activo,true) and ('obra' = any(r.modulos) or 'admin' = any(r.modulos))
    loop
      perform sgc.notificar(v_uid, 'warning', 'Incidente en obra ('||p_gravedad||')',
        left(coalesce(p_descripcion,''), 140), '/obra');
    end loop;
  end if;
  return v_id;
end $$;
grant execute on function sgc.registrar_incidente_obra(uuid,uuid,text,text,text,int,text,text,text[],uuid,uuid,date) to authenticated, service_role;

-- Cerrar incidente.
create or replace function sgc.cerrar_incidente_obra(p_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  update sgc.obra_incidentes set estado='cerrado', cerrado_en=now() where id = p_id;
end $$;
grant execute on function sgc.cerrar_incidente_obra(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Sweep diario: recordatorio de acciones correctivas vencidas
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sgc.evaluar_avisos_obra()
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare r record;
begin
  for r in
    select id, responsable_id, descripcion, fecha_compromiso
    from sgc.obra_acciones_correctivas
    where estado = 'abierta'
      and responsable_id is not null
      and fecha_compromiso is not null
      and fecha_compromiso <= current_date
      and (ultimo_recordatorio is null or ultimo_recordatorio < current_date)
  loop
    if sgc.obra_notif_activo('obra_accion_vencida','in_app') then
      perform sgc.notificar(r.responsable_id, 'warning', 'Acción correctiva vencida',
        left(coalesce(r.descripcion,''),140) || ' · venció ' || to_char(r.fecha_compromiso,'DD/MM/YYYY'),
        '/obra');
    end if;
    update sgc.obra_acciones_correctivas set ultimo_recordatorio = current_date where id = r.id;
  end loop;
end $$;
revoke all on function sgc.evaluar_avisos_obra() from public, anon, authenticated;
grant execute on function sgc.evaluar_avisos_obra() to service_role;

do $$ begin perform cron.unschedule('sgc-obra-avisos'); exception when others then null; end $$;
select cron.schedule('sgc-obra-avisos', '20 6 * * *', $cron$ select sgc.evaluar_avisos_obra(); $cron$);
