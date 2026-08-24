-- ============================================================================
-- AW1 — Cronograma de un proyecto de PRUEBA sale vacío
--
-- Diagnóstico: "Riviera Bay TEST" (es_prueba=true) SÍ tiene 35 tareas de
-- cronograma, todas es_prueba=true. Pero listar_cronograma ocultaba las tareas
-- es_prueba a todo el que no fuera admin:
--     where ... and ((not t.es_prueba) or sgc.is_admin())
-- → un usuario no-admin abriendo un proyecto de prueba veía "Sin tareas".
--
-- Regla correcta: dentro de un proyecto de PRUEBA, sus tareas de prueba SÍ se
-- ven (ver datos de prueba en su propio contexto es lo esperado). En proyectos
-- reales se siguen ocultando las tareas de prueba a los no-admin.
-- ============================================================================

create or replace function sgc.listar_cronograma(p_proyecto_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'public'
as $function$
declare
  v_result jsonb;
  v_proy_prueba boolean;
begin
  if not sgc.puede_ver_cronograma(p_proyecto_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  -- ¿El proyecto es de prueba? En ese caso sus tareas de prueba son visibles.
  select coalesce(es_prueba, false) into v_proy_prueba
    from sgc.proyectos where id = p_proyecto_id;

  select jsonb_build_object(
    'tareas', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.orden, t.created_at)
      from sgc.cronograma_tareas t
      where t.proyecto_id = p_proyecto_id
        and ((not t.es_prueba) or sgc.is_admin() or v_proy_prueba)
    ), '[]'::jsonb),
    'recalculos', coalesce((
      select jsonb_agg(to_jsonb(rc) order by rc.created_at desc)
      from sgc.cronograma_recalculos rc
      where rc.proyecto_id = p_proyecto_id
    ), '[]'::jsonb),
    'dependencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'predecesora_id', d.predecesora_id, 'sucesora_id', d.sucesora_id,
        'tipo', d.tipo, 'lag_dias', d.lag_dias) order by d.created_at)
      from sgc.cronograma_dependencias d
      where d.proyecto_id = p_proyecto_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;
