-- ════════════════════════════════════════════════════════════════════════════
-- BH6 — La tarea de Wagner "invisible" en la app.
--
-- Diagnóstico de datos (verificado contra prod): Wagner tiene UNA sola fila de
-- usuario (5cc6dc87…) y UNA sola en auth.users; la tarea "Ingeniero retira
-- esosnpuntales" está BIEN asignada a esa fila, estado 'pendiente'. NO es
-- duplicado de persona ni el coalesce. Quedan dos defectos estructurales:
--
--   (1) 🔴 Hueco de privacidad (familia AY): mis_tareas_app dejaba pasar a
--       cualquiera con tiene_modulo('tareas') → veía TODAS las tareas del sistema
--       (por eso la tarea salía en la lista de OTRO usuario). El gemelo estricto
--       mis_tareas_asistente ya existe para Compa por esta misma razón; el hueco
--       seguía abierto en la app. "Mis tareas" = estrictamente mías; lo global
--       vive en "Gestión de tareas".
--
--   (2) asignar_tarea_obra hacía coalesce(p_asignado_a, auth.uid()) → si el
--       asignado no se pasaba/resolvía, la tarea se la quedaba en silencio quien
--       la creó (vía tool proponer_tarea de Compa, p.ej.). Falla explícito.
--
-- ⚠️ mis_tareas_app solo TIGHTENS (nunca afloja). Un gestor que en la app veía
-- todo en "Mis tareas" pasa a ver solo lo suyo — que es lo correcto; lo global es
-- "Gestión de tareas" (web hoy; app en PROMPT-31). Smoke por rol recomendado.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- (1) mis_tareas_app — estrictamente mías (fuera tiene_modulo). ───────────────
create or replace function sgc.mis_tareas_app(p_incluir_completadas boolean default false)
 returns table(id uuid, titulo text, descripcion text, estado text, prioridad text, asignado_a uuid, asignado_a_nombre text, asignado_por uuid, asignado_por_nombre text, proyecto_id uuid, proyecto_nombre text, fecha_limite date, fecha_completada date, created_at timestamp with time zone, linked_tipo text, linked_id uuid, linked_params jsonb, auto_completada boolean)
 language sql stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select t.id, t.titulo, t.descripcion, t.estado, t.prioridad,
         t.asignado_a, ua.nombre, t.asignado_por, up.nombre,
         t.proyecto_id, p.nombre, t.fecha_limite, t.fecha_completada, t.created_at,
         t.linked_tipo, t.linked_id, t.linked_params, t.auto_completada
  from sgc.tareas t
  left join sgc.usuarios ua on ua.id = t.asignado_a
  left join sgc.usuarios up on up.id = t.asignado_por
  left join sgc.proyectos p on p.id = t.proyecto_id
  where (
      -- BH6 — estrictamente mías: asignada a mí, o creada por mí, o admin.
      -- Se quita tiene_modulo('tareas') (hueco de privacidad AY). Lo global va en
      -- "Gestión de tareas".
      t.asignado_a = auth.uid()
      or t.asignado_por = auth.uid()
      or sgc.is_admin()
    )
    and (p_incluir_completadas or t.estado not in ('completada', 'cancelada'))
  order by
    case t.estado when 'en_progreso' then 0 when 'pendiente' then 1 else 2 end,
    case t.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
    t.fecha_limite nulls last,
    t.created_at desc;
$function$;

-- (2) asignar_tarea_obra — sin coalesce silencioso; falla explícito. ──────────
create or replace function sgc.asignar_tarea_obra(p_id uuid, p_proyecto_id uuid, p_titulo text, p_descripcion text default null, p_asignado_a uuid default null, p_brigada text default null, p_prioridad text default 'media', p_fecha_limite date default null)
 returns uuid
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid := coalesce(p_id, gen_random_uuid());
  v_brigada text := nullif(btrim(coalesce(p_brigada, '')), '');
begin
  if not sgc.puede_operar_submodulo('obra.plan_dia') then
    raise exception 'No tienes permiso para asignar tareas de obra.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_titulo), '') = '' then
    raise exception 'La tarea necesita un título.';
  end if;
  -- BH6 — nada de coalesce a uno mismo: hay que decir a QUIÉN o a qué BRIGADA.
  if p_asignado_a is null and v_brigada is null then
    raise exception 'Indica a quién (o a qué brigada) se asigna la tarea.';
  end if;
  if p_asignado_a is not null and not exists (select 1 from sgc.usuarios where id = p_asignado_a) then
    raise exception 'El usuario asignado no existe.';
  end if;

  insert into sgc.tareas (id, titulo, descripcion, estado, prioridad, asignado_a, asignado_por, proyecto_id, fecha_limite, brigada)
  values (v_id, btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), 'pendiente',
          coalesce(p_prioridad, 'media'), p_asignado_a, v_uid, p_proyecto_id, p_fecha_limite, v_brigada)
  on conflict (id) do nothing;

  begin
    if p_asignado_a is not null and p_asignado_a <> v_uid then
      perform sgc.notificar(p_asignado_a, 'tarea', 'Nueva tarea de obra', btrim(p_titulo), '/tareas');
    end if;
  exception when others then null;
  end;

  return v_id;
end $function$;

-- (3) usuarios_asignables — selector que DESAMBIGUA (rol + email + duplicados). ─
-- Homologa el <select> de nombres sueltos (directorio_usuarios) con la disciplina
-- de buscar_usuarios: oculta es_prueba salvo a admin/usuario de prueba, y marca
-- los homónimos para no volver a asignarle a la persona equivocada (BH6/AU18).
create or replace function sgc.usuarios_asignables()
returns table(id uuid, nombre text, email text, roles_label text, es_prueba boolean, es_duplicado boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with base as (
    select u.id, u.nombre, u.email, coalesce(u.es_prueba, false) as es_prueba,
      (select string_agg(distinct r.nombre, ', ' order by r.nombre)
         from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = u.id) as roles_label
    from sgc.usuarios u
    where coalesce(u.activo, true) = true
      and (not coalesce(u.es_prueba, false) or sgc.is_admin() or sgc.soy_usuario_prueba())
  )
  select b.id, b.nombre, b.email, b.roles_label, b.es_prueba,
         (count(*) over (partition by lower(btrim(b.nombre))) > 1) as es_duplicado
  from base b
  order by b.nombre;
$function$;
grant execute on function sgc.usuarios_asignables() to authenticated;

commit;
