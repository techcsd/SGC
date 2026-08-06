-- ============================================================================
-- AG16 · Gestión de Producción de Obra — FASE 2: Plan del día + Charla de
-- seguridad + Checklists de calidad. Rutinas 1 y 4 del Gerente de Producción.
--
-- Reutiliza: Tareas (+AG15) para el plan del día, `charlas_seguridad` (ola2)
-- para la charla, y el motor `cl_plantillas`/`cl_registros` (ola2, ya de obra)
-- GENERALIZADO con una `categoria` para separar liberación (CL-01..07) de
-- checklists de calidad por actividad (replanteo, encofrado, acero, hormigonado).
--
-- Aditivo y retrocompatible. RLS: se AMPLÍA para el módulo `obra` + submódulos
-- granulares (obra.plan_dia, obra.checklists). Bucket: reutiliza `obra`.
-- ============================================================================
set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Plan del día — Tareas gana `brigada` (etiqueta libre) y fecha del día
-- ─────────────────────────────────────────────────────────────────────────────
-- El plan del día son sgc.tareas con proyecto_id + fecha_limite = ese día. Se
-- añade `brigada` para agrupar por cuadrilla sin modelo formal (v1).
alter table sgc.tareas add column if not exists brigada text;
create index if not exists idx_tareas_proyecto_fecha on sgc.tareas(proyecto_id, fecha_limite) where proyecto_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Charla de seguridad — duración
-- ─────────────────────────────────────────────────────────────────────────────
alter table sgc.charlas_seguridad add column if not exists duracion_min int;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Checklists de calidad — generalizar el motor cl_*
-- ─────────────────────────────────────────────────────────────────────────────
-- `categoria` separa las CL de liberación (con ciclo de firmas) de las QA por
-- actividad. Las CL-01..07 existentes quedan en 'liberacion' (default).
alter table sgc.cl_plantillas add column if not exists categoria text not null default 'liberacion';
do $$ begin
  alter table sgc.cl_plantillas add constraint cl_plantillas_categoria_chk
    check (categoria in ('liberacion','calidad'));
exception when duplicate_object then null; end $$;

-- cl_registros: categoría (redundante para consultar sin join) + estado libre.
alter table sgc.cl_registros add column if not exists categoria text not null default 'liberacion';

-- Seed de plantillas de calidad por actividad (idempotente por codigo).
insert into sgc.cl_plantillas (codigo, nombre, fase, categoria, orden) select * from (values
  ('QA-01','Replanteo y trazado','replanteo','calidad',101),
  ('QA-02','Niveles y cotas','niveles','calidad',102),
  ('QA-03','Encofrado','encofrado','calidad',103),
  ('QA-04','Armado de acero','acero','calidad',104),
  ('QA-05','Previo a hormigonado','hormigonado','calidad',105)
) as v(codigo,nombre,fase,categoria,orden)
where not exists (select 1 from sgc.cl_plantillas p where p.codigo = v.codigo);

-- Ítems de las plantillas QA (idempotente: solo si la plantilla no tiene ítems).
do $$
declare v_pid uuid;
begin
  -- QA-01 Replanteo
  select id into v_pid from sgc.cl_plantillas where codigo='QA-01';
  if v_pid is not null and not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v_pid) then
    insert into sgc.cl_plantilla_items (plantilla_id, seccion, etiqueta, orden) values
      (v_pid,'Replanteo','Ejes marcados según planos',1),
      (v_pid,'Replanteo','Distancias verificadas',2),
      (v_pid,'Replanteo','Referencias de nivel establecidas',3);
  end if;
  -- QA-02 Niveles
  select id into v_pid from sgc.cl_plantillas where codigo='QA-02';
  if v_pid is not null and not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v_pid) then
    insert into sgc.cl_plantilla_items (plantilla_id, seccion, etiqueta, orden) values
      (v_pid,'Niveles','Cotas verificadas con equipo',1),
      (v_pid,'Niveles','Pendientes según diseño',2);
  end if;
  -- QA-03 Encofrado
  select id into v_pid from sgc.cl_plantillas where codigo='QA-03';
  if v_pid is not null and not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v_pid) then
    insert into sgc.cl_plantilla_items (plantilla_id, seccion, etiqueta, orden) values
      (v_pid,'Encofrado','Dimensiones según planos',1),
      (v_pid,'Encofrado','Plomo y alineación',2),
      (v_pid,'Encofrado','Apuntalamiento adecuado',3),
      (v_pid,'Encofrado','Limpieza interior',4);
  end if;
  -- QA-04 Acero
  select id into v_pid from sgc.cl_plantillas where codigo='QA-04';
  if v_pid is not null and not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v_pid) then
    insert into sgc.cl_plantilla_items (plantilla_id, seccion, etiqueta, orden) values
      (v_pid,'Acero','Diámetros según planos',1),
      (v_pid,'Acero','Cantidad y separación de barras',2),
      (v_pid,'Acero','Recubrimiento (separadores)',3),
      (v_pid,'Acero','Empalmes y ganchos',4);
  end if;
  -- QA-05 Previo a hormigonado
  select id into v_pid from sgc.cl_plantillas where codigo='QA-05';
  if v_pid is not null and not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v_pid) then
    insert into sgc.cl_plantilla_items (plantilla_id, seccion, etiqueta, orden) values
      (v_pid,'Hormigonado','Encofrado y acero liberados',1),
      (v_pid,'Hormigonado','Instalaciones embebidas colocadas',2),
      (v_pid,'Hormigonado','Acceso y equipos listos',3),
      (v_pid,'Hormigonado','Sin no conformidades abiertas',4);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS — ampliar charlas_seguridad y cl_* al módulo `obra` + submódulos
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists charlas_seguridad_all on sgc.charlas_seguridad;
create policy charlas_seguridad_all on sgc.charlas_seguridad for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_ver_submodulo('obra.plan_dia'))
  with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_operar_submodulo('obra.plan_dia'));

do $$
declare t text;
begin
  foreach t in array array['cl_plantillas','cl_plantilla_items','cl_registros','cl_registro_items','cl_registro_fotos']
  loop
    execute format('drop policy if exists %I_obra on sgc.%I', t, t);
    execute format($p$create policy %I_obra on sgc.%I for all to authenticated
        using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_ver_submodulo('obra.checklists'))
        with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_operar_submodulo('obra.checklists'))$p$, t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- Registrar / actualizar charla de seguridad del día (idempotente por p_id).
create or replace function sgc.registrar_charla_seguridad(
  p_id uuid, p_proyecto_id uuid, p_fecha date, p_tema text,
  p_duracion_min int default 5, p_notas text default null,
  p_asistentes int default null, p_fotos text[] default '{}', p_firmas text[] default '{}'
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid;
begin
  insert into sgc.charlas_seguridad
    (id, proyecto_id, fecha, tema, duracion_min, notas, asistentes, fotos, firmas, creado_por)
  values
    (coalesce(p_id, gen_random_uuid()), p_proyecto_id, coalesce(p_fecha, current_date), p_tema,
     coalesce(p_duracion_min,5), p_notas, p_asistentes, coalesce(p_fotos,'{}'), coalesce(p_firmas,'{}'), auth.uid())
  on conflict (id) do update set
     tema = excluded.tema, duracion_min = excluded.duracion_min, notas = excluded.notas,
     asistentes = excluded.asistentes, fotos = excluded.fotos, firmas = excluded.firmas,
     fecha = excluded.fecha
  returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.registrar_charla_seguridad(uuid,uuid,date,text,int,text,int,text[],text[]) to authenticated, service_role;

-- Plan del día: charla + tareas del día de una obra.
create or replace function sgc.plan_del_dia(p_proyecto_id uuid, p_fecha date)
returns jsonb language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select jsonb_build_object(
    'charla', (
      select to_jsonb(c) from sgc.charlas_seguridad c
      where c.proyecto_id = p_proyecto_id and c.fecha = p_fecha
      order by c.created_at desc limit 1
    ),
    'tareas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'titulo', t.titulo, 'descripcion', t.descripcion, 'estado', t.estado,
        'prioridad', t.prioridad, 'brigada', t.brigada, 'asignado_a', t.asignado_a,
        'responsable', u.nombre, 'linked_tipo', t.linked_tipo, 'linked_id', t.linked_id
      ) order by t.brigada nulls last, t.created_at)
      from sgc.tareas t left join sgc.usuarios u on u.id = t.asignado_a
      where t.proyecto_id = p_proyecto_id and t.fecha_limite = p_fecha
    ), '[]'::jsonb)
  );
$$;
grant execute on function sgc.plan_del_dia(uuid,date) to authenticated, service_role;

-- Ejecutar checklist de calidad (idempotente por p_id): registro + ítems + fotos.
-- p_respuestas: [{etiqueta, seccion, cumple(bool|null), comentario, orden}]
-- p_fotos: [{storage_path, correcto(bool|null), descripcion}]
create or replace function sgc.ejecutar_checklist_calidad(
  p_id uuid, p_plantilla_id uuid, p_proyecto_id uuid, p_elemento_id uuid default null,
  p_respuestas jsonb default '[]', p_fotos jsonb default '[]', p_observaciones text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid;
begin
  insert into sgc.cl_registros
    (id, proyecto_id, plantilla_id, elemento_id, categoria, estado, observaciones, creado_por, updated_at)
  values
    (coalesce(p_id, gen_random_uuid()), p_proyecto_id, p_plantilla_id, p_elemento_id, 'calidad',
     'completado', p_observaciones, auth.uid(), now())
  on conflict (id) do update set
     plantilla_id = excluded.plantilla_id, elemento_id = excluded.elemento_id,
     observaciones = excluded.observaciones, updated_at = now()
  returning id into v_id;

  -- Reemplaza ítems y fotos (idempotencia total del envío).
  delete from sgc.cl_registro_items where registro_id = v_id;
  insert into sgc.cl_registro_items (registro_id, etiqueta, seccion, cumple, comentario, orden)
  select v_id, r->>'etiqueta', r->>'seccion',
         case when r->>'cumple' is null then null else (r->>'cumple')::boolean end,
         r->>'comentario', coalesce((r->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_respuestas,'[]')) r;

  delete from sgc.cl_registro_fotos where registro_id = v_id;
  insert into sgc.cl_registro_fotos (registro_id, storage_path, correcto, descripcion)
  select v_id, f->>'storage_path',
         case when f->>'correcto' is null then null else (f->>'correcto')::boolean end,
         f->>'descripcion'
  from jsonb_array_elements(coalesce(p_fotos,'[]')) f
  where f->>'storage_path' is not null;

  return v_id;
end $$;
grant execute on function sgc.ejecutar_checklist_calidad(uuid,uuid,uuid,uuid,jsonb,jsonb,text) to authenticated, service_role;
