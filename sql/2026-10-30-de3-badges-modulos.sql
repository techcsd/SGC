-- sql/2026-10-30-de3-badges-modulos.sql — Ronda DE (PROMPT-126 F4, DE3/DE-07/DE-08/DE-10)
-- Fuente única de badges por módulo: el número de un icono DEBE poder abrirse y
-- listar exactamente esos elementos (regla DE-07, va también a PARIDAD.md).
--
-- Causa real de DE3 (ver docs/de-f0-verificacion.md): el badge de Inventario de
-- la app (csd-app badges.service.ts) cuenta TODO `salidas_inventario
-- estado='despachado'` sin filtrar por "mío", mientras la pantalla de adentro
-- (home "Por recibir") usa `mis_entregas_por_confirmar()` + `mis_firmas_pendientes()`
-- (predicado distinto). Esta RPC reemplaza esa cuenta por el MISMO predicado que
-- usan las pantallas reales de cada módulo (es SECURITY DEFINER: bypassa RLS,
-- por eso cada rama REPLICA explícitamente la política RLS real de su tabla —
-- ver comentario en cada rama con la política de origen).
--
-- Solo se devuelve una fila por módulo con total > 0 (DE-08: "si el número es 0
-- no hay badge").
--
--   node scripts/apply-migration.mjs sql/2026-10-30-de3-badges-modulos.sql --env dev

create or replace function sgc.badges_modulos_app()
returns table(modulo text, total int, detalle jsonb)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_por_recibir int := 0;
  v_por_despachar int := 0;
  v_flota int := 0;
  v_compras int := 0;
  v_proyectos int := 0;
  v_admin int := 0;
begin
  -- ── Inventario (DE-08) — conduces por recibir (míos) + requisiciones que me
  -- toca aprobar/despachar (solo si tengo el módulo). NUNCA el conteo global
  -- de "despachado" (esa era la causa de DE3). ──
  select count(distinct sid) into v_por_recibir from (
    select id as sid from sgc.mis_entregas_por_confirmar()
    union
    select (elem->>'salida_id')::uuid as sid from jsonb_array_elements(sgc.mis_firmas_pendientes()) elem
  ) u;

  if sgc.tiene_modulo('inventario') or sgc.is_admin() then
    -- Política real "solicitudes_material: select": solicitante_id=auth.uid() OR puede_ver_todas_requisiciones().
    select count(*) into v_por_despachar
    from sgc.solicitudes_material sm
    where sm.estado = 'pendiente'
      and (sm.solicitante_id = auth.uid() or sgc.puede_ver_todas_requisiciones())
      and (not sgc.es_usuario_demo() or exists (
            select 1 from sgc.proyectos p where p.id = sm.proyecto_id and coalesce(p.es_prueba,false)));
  end if;

  if coalesce(v_por_recibir,0) + coalesce(v_por_despachar,0) > 0 then
    return query select 'inventario'::text, coalesce(v_por_recibir,0) + coalesce(v_por_despachar,0),
      jsonb_build_object('por_recibir', coalesce(v_por_recibir,0), 'por_despachar', coalesce(v_por_despachar,0));
  end if;

  -- ── Flota — avisos operativos pendientes. Política real "avisos_flota_sel":
  -- es_flota_elevado() OR conductor_id IN mis_conductor_ids(). ──
  select count(*) into v_flota
  from sgc.avisos_flota af
  where af.estado = 'pendiente'
    and (not af.es_prueba or sgc.is_admin() or sgc.usuario_actual_es_prueba())
    and (sgc.es_flota_elevado() or af.conductor_id in (select sgc.mis_conductor_ids()));
  if coalesce(v_flota,0) > 0 then
    return query select 'flota'::text, v_flota, jsonb_build_object('avisos_pendientes', v_flota);
  end if;

  -- ── Compras — solicitudes de compra pendientes. Política real
  -- "solicitudes_compra: select": solicitante/aprobador/admin/módulo compras
  -- (o submódulo compras.solicitudes en ver/operar). ──
  select count(*) into v_compras
  from sgc.solicitudes_compra sc
  where sc.estado = 'pendiente'
    and (sc.solicitante_id = auth.uid() or sc.aprobador_id = auth.uid()
         or sgc.is_admin() or sgc.tiene_modulo('compras')
         or sgc.submodulo_nivel_explicito('compras.solicitudes') = any(array['ver','operar']));
  if coalesce(v_compras,0) > 0 then
    return query select 'compras'::text, v_compras, jsonb_build_object('pendientes', v_compras);
  end if;

  -- ── Proyectos — avisos de cronograma pendientes. Política real
  -- "avisos_proyecto_sel": admin OR módulo proyectos OR módulo dirección. ──
  if sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion') then
    select count(*) into v_proyectos
    from sgc.avisos_proyecto ap
    where ap.estado = 'pendiente' and ap.tipo like 'cronograma_%';
    if coalesce(v_proyectos,0) > 0 then
      return query select 'proyectos'::text, v_proyectos, jsonb_build_object('avisos_cronograma', v_proyectos);
    end if;
  end if;

  -- ── Admin — reportes de soporte sin resolver. Política real
  -- "reportes_usuario: select": usuario_id=auth.uid() OR is_admin(); el badge
  -- de Admin solo tiene sentido para quien ve TODOS (is_admin). ──
  if sgc.is_admin() then
    select count(*) into v_admin from sgc.reportes_usuario where estado <> 'resuelto';
    if coalesce(v_admin,0) > 0 then
      return query select 'admin'::text, v_admin, jsonb_build_object('reportes_sin_resolver', v_admin);
    end if;
  end if;

  return;
end $function$;
grant execute on function sgc.badges_modulos_app() to authenticated;
