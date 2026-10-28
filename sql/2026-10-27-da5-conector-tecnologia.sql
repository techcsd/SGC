-- ============================================================================
-- DA5/DA12/DA15/DA16 (PROMPT-122, ronda DA, 27-oct-2026) — Inventario
-- tecnológico, FASE 6: el conector de Claude cubre Tecnología
-- (CONTEXTO-ACTUALIZACION-60.md §1 nota 6). Xaviel pidió que Claude pudiera
-- subir los 16 equipos ya registrados; hoy el conector no tenía ninguna
-- herramienta para `tec_equipos` (gap registrado con reportar_gap).
--
--   DA-15 — RPCs de lectura (RLS decide qué ve cada quien, igual que la web)
--     y de escritura usadas por los "proponer_*" (nunca ejecutan solas — el
--     execRpc lo llama claude-borrador SOLO tras confirmación humana).
--   DA-16 — permisos: "admin o tecnologia" sigue igual; PLUS el Subadministrador
--     (permiso granular 'tecnologia.inventario') debe poder usar estas
--     herramientas igual que en la web. El registro compartido de
--     herramientas (_shared/herramientas.ts) hoy filtra SOLO por módulo
--     completo (`cap.modulos.includes(m)`) — sin soporte de permiso granular.
--     Se EXTIENDE (aditivo): `Cap.permisos` + `ToolDef.submodulos` + el filtro
--     de `toolsParaUsuario` ahora también acepta who tenga 'ver'/'operar' en
--     CUALQUIERA de los submódulos de la tool — sin tocar ninguna tool
--     existente (todas quedan sin `submodulos`, mismo comportamiento de
--     siempre). `capacidades_asistente()` se amplía (mismo cuerpo + el campo
--     nuevo `permisos`, regla 19 — ver sql/2026-10-25-cy21-capacidades-modulos.sql).
--
-- Opción elegida para la carga masiva (DA-15, recomendación de Xaviel): (a)
-- una sola propuesta en lote con pantalla de revisión — máximo 50 filas,
-- idempotente, valida/ejecuta POR FILA (una inválida no tumba el lote).
--
-- Aditivo, idempotente. Regla 18: dev primero.
-- Apply: node scripts/apply-migration.mjs sql/2026-10-27-da5-conector-tecnologia.sql --env dev  →  --env prod
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) capacidades_asistente() + permisos granulares (DA-16) ──────────────
-- MISMO cuerpo de 2026-10-25-cy21-capacidades-modulos.sql + el campo `permisos`
-- (fusión de permisos de TODOS los roles del usuario — mismo criterio que el
-- cliente, `UserService`/`permisosMerged`, y el servidor, `sgc.nivel_submodulo`).
create or replace function sgc.capacidades_asistente()
returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_nombre text;
  v_admin  boolean;
  v_mods   text[] := '{}';
  v_roles  text[] := '{}';
  v_todos  text[];
  v_permisos jsonb := '{}'::jsonb;
  m        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select nombre into v_nombre from sgc.usuarios where id = v_uid;
  v_admin := sgc.is_admin();

  select coalesce(array_agg(distinct modulo order by modulo), '{}')
    into v_todos
    from sgc.roles, unnest(modulos) as modulo;

  foreach m in array v_todos loop
    if v_admin or sgc.tiene_modulo(m) then v_mods := v_mods || m; end if;
  end loop;

  select coalesce(array_agg(distinct r.nombre order by r.nombre), '{}')
    into v_roles
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
   where ur.usuario_id = v_uid;

  -- DA-16 — fusión de permisos granulares (AG12) de todos los roles del
  -- usuario; 'operar' gana sobre 'ver' si hay empate de clave entre roles.
  select coalesce(jsonb_object_agg(k, best), '{}'::jsonb) into v_permisos
    from (
      select k, (array_agg(v order by (v = 'operar') desc))[1] as best
        from (
          select kv.key as k, kv.value #>> '{}' as v
            from sgc.usuarios_roles ur
            join sgc.roles r on r.id = ur.rol_id
            cross join lateral jsonb_each(coalesce(r.permisos, '{}'::jsonb)) as kv
           where ur.usuario_id = v_uid
        ) s
       group by k
    ) agg;

  return jsonb_build_object(
    'usuario_id', v_uid,
    'nombre', coalesce(v_nombre, 'Usuario'),
    'es_admin', v_admin,
    'modulos', to_jsonb(v_mods),
    'roles', to_jsonb(v_roles),
    'permisos', v_permisos,
    'puede_ver_todas_requisiciones', sgc.puede_ver_todas_requisiciones()
  );
end;
$function$;

-- ── (2) Parámetro de alerta de garantía (F7 lo consume también; nace aquí
--     porque el resumen del conector ya lo necesita, regla 6.5) ───────────
insert into sgc.parametros (clave, valor, descripcion)
select 'tec_garantia_alerta_dias', '30', 'DA-18 — días antes de vencer la garantía de un equipo TI para avisarlo (chip + resumen).'
where not exists (select 1 from sgc.parametros where clave = 'tec_garantia_alerta_dias');

-- ── (3) Lectura: resumen del inventario para el conector y la pantalla ─────
create or replace function sgc.tec_equipo_resumen_asistente()
returns jsonb
language plpgsql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_dias int;
  v_por_tipo jsonb;
  v_por_estado jsonb;
  v_por_condicion jsonb;
  v_garantia_por_vencer int;
  v_total int;
begin
  select coalesce(nullif(valor,'')::int, 30) into v_dias from sgc.parametros where clave = 'tec_garantia_alerta_dias';

  select count(*) into v_total from sgc.tec_equipos where activo;

  select coalesce(jsonb_object_agg(coalesce(t.label, e.tipo, 'Otro'), c), '{}'::jsonb) into v_por_tipo
    from (select tipo_id, tipo, count(*) c from sgc.tec_equipos where activo group by tipo_id, tipo) e
    left join sgc.tec_equipo_tipos t on t.id = e.tipo_id;

  select coalesce(jsonb_object_agg(coalesce(es.label, e.estado), c), '{}'::jsonb) into v_por_estado
    from (select estado, count(*) c from sgc.tec_equipos where activo group by estado) e
    left join sgc.tec_equipo_estados es on es.clave = e.estado;

  select coalesce(jsonb_object_agg(coalesce(co.label, e.condicion), c), '{}'::jsonb) into v_por_condicion
    from (select condicion, count(*) c from sgc.tec_equipos where activo group by condicion) e
    left join sgc.tec_equipo_condiciones co on co.clave = e.condicion;

  select count(*) into v_garantia_por_vencer
    from sgc.tec_equipos
   where activo and not garantia_desconocida and garantia_hasta is not null
     and garantia_hasta between current_date and current_date + (v_dias || ' days')::interval;

  return jsonb_build_object(
    'total_equipos', v_total,
    'por_tipo', v_por_tipo,
    'por_situacion', v_por_estado,
    'por_condicion', v_por_condicion,
    'garantias_por_vencer', v_garantia_por_vencer,
    'garantia_alerta_dias', v_dias
  );
end;
$function$;
grant execute on function sgc.tec_equipo_resumen_asistente() to authenticated;

-- ── (4) Lectura: listar equipos (filtros) ───────────────────────────────────
create or replace function sgc.tec_equipos_listar_asistente(
  p_tipo_id uuid default null, p_estado text default null, p_empleado_id uuid default null,
  p_bodega_id uuid default null, p_buscar text default null, p_limite int default 30
)
returns table (
  id uuid, codigo text, nombre text, tipo text, estado text, condicion text,
  empleado_nombre text, responsable_externo text, bodega_nombre text, ubicacion text,
  kit_padre_id uuid, presente boolean, created_at timestamptz
)
language sql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
  select e.id, e.codigo, e.nombre, coalesce(t.label, e.tipo), e.estado, e.condicion,
         trim(coalesce(emp.nombre,'') || ' ' || coalesce(emp.apellido,'')), e.responsable_externo,
         b.nombre, e.ubicacion, e.kit_padre_id, e.presente, e.created_at
    from sgc.tec_equipos e
    left join sgc.tec_equipo_tipos t on t.id = e.tipo_id
    left join sgc.empleados emp on emp.id = e.empleado_id
    left join sgc.bodegas b on b.id = e.bodega_id
   where e.activo
     and (p_tipo_id is null or e.tipo_id = p_tipo_id)
     and (p_estado is null or e.estado = p_estado)
     and (p_empleado_id is null or e.empleado_id = p_empleado_id)
     and (p_bodega_id is null or e.bodega_id = p_bodega_id)
     and (p_buscar is null or e.nombre ilike '%'||p_buscar||'%' or e.codigo ilike '%'||p_buscar||'%' or e.serie ilike '%'||p_buscar||'%')
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limite, 30), 100));
$function$;
grant execute on function sgc.tec_equipos_listar_asistente(uuid, text, uuid, uuid, text, int) to authenticated;

-- ── (5) Lectura: detalle de un equipo (specs + historial + kit) ─────────────
create or replace function sgc.tec_equipo_detalle_asistente(p_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_equipo jsonb;
  v_specs jsonb;
  v_historial jsonb;
  v_componentes jsonb;
begin
  select to_jsonb(e) - 'tipo' || jsonb_build_object('tipo_label', coalesce(t.label, e.tipo))
    into v_equipo
    from sgc.tec_equipos e left join sgc.tec_equipo_tipos t on t.id = e.tipo_id
   where e.id = p_id;
  if v_equipo is null then return null; end if;

  select to_jsonb(s) into v_specs from sgc.tec_equipo_specs s where s.equipo_id = p_id;
  select coalesce(jsonb_agg(h order by h.created_at desc), '[]'::jsonb) into v_historial
    from sgc.tec_equipo_historial h where h.equipo_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo, 'nombre', c.nombre, 'presente', c.presente, 'estado', c.estado)), '[]'::jsonb)
    into v_componentes
    from sgc.tec_equipos c where c.kit_padre_id = p_id;

  return jsonb_build_object('equipo', v_equipo, 'specs', v_specs, 'historial', v_historial, 'componentes', v_componentes);
end;
$function$;
grant execute on function sgc.tec_equipo_detalle_asistente(uuid) to authenticated;

-- ── (6) Lectura: catálogo de tipos ──────────────────────────────────────────
create or replace function sgc.tec_equipo_tipos_listar_asistente()
returns table (id uuid, clave text, label text)
language sql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
  select id, clave, label from sgc.tec_equipo_tipos where activo order by orden, label;
$function$;
grant execute on function sgc.tec_equipo_tipos_listar_asistente() to authenticated;

-- ── (7) Escritura: crear/actualizar UN equipo (usado por proponer_equipo_
--     tecnologico Y por el lote, fila a fila) ──────────────────────────────
-- security invoker: la RLS de tec_equipos (is_admin/tiene_modulo/submodulo)
-- decide, igual que la web — ningún atajo de servicio aquí.
create or replace function sgc.tec_equipo_crear_o_actualizar_asistente(
  p_id uuid default null,
  p_nombre text default null, p_tipo_id uuid default null, p_tipo_clave text default null,
  p_marca text default null, p_modelo text default null, p_serie text default null,
  p_estado text default null, p_condicion text default null,
  p_empleado_id uuid default null, p_responsable_externo text default null,
  p_bodega_id uuid default null, p_ubicacion text default null,
  p_costo numeric default null, p_moneda text default null, p_costo_origen text default null,
  p_fecha_compra date default null, p_garantia_hasta date default null,
  p_service_tag text default null, p_numero_parte text default null, p_imei text default null,
  p_notas text default null, p_origen text default 'claude'
)
returns uuid
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_tipo_id uuid := p_tipo_id;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;

  if v_tipo_id is null and p_tipo_clave is not null then
    select id into v_tipo_id from sgc.tec_equipo_tipos where clave = p_tipo_clave and activo;
  end if;

  if p_id is not null then
    update sgc.tec_equipos set
      nombre = coalesce(p_nombre, nombre), tipo_id = coalesce(v_tipo_id, tipo_id),
      marca = coalesce(p_marca, marca), modelo = coalesce(p_modelo, modelo), serie = coalesce(p_serie, serie),
      estado = coalesce(p_estado, estado), condicion = coalesce(p_condicion, condicion),
      empleado_id = coalesce(p_empleado_id, empleado_id), responsable_externo = coalesce(p_responsable_externo, responsable_externo),
      bodega_id = coalesce(p_bodega_id, bodega_id), ubicacion = coalesce(p_ubicacion, ubicacion),
      costo = coalesce(p_costo, costo), moneda = coalesce(p_moneda, moneda), costo_origen = coalesce(p_costo_origen, costo_origen),
      fecha_compra = coalesce(p_fecha_compra, fecha_compra), garantia_hasta = coalesce(p_garantia_hasta, garantia_hasta),
      service_tag = coalesce(p_service_tag, service_tag), numero_parte = coalesce(p_numero_parte, numero_parte), imei = coalesce(p_imei, imei),
      notas = case when p_notas is not null then trim(both ' ' from coalesce(notas,'') || E'\n' || p_notas) else notas end,
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Equipo no encontrado.' using errcode = 'P0002'; end if;
    return v_id;
  end if;

  if p_nombre is null or trim(p_nombre) = '' then
    perform sgc.error_campo('nombre', 'requerido', 'El nombre del equipo es obligatorio.');
  end if;
  if v_tipo_id is null then
    select id into v_tipo_id from sgc.tec_equipo_tipos where clave = 'otro';
  end if;

  insert into sgc.tec_equipos (
    nombre, tipo_id, tipo, marca, modelo, serie, estado, condicion, empleado_id, responsable_externo,
    bodega_id, ubicacion, costo, moneda, costo_origen, fecha_compra, garantia_hasta,
    service_tag, numero_parte, imei, notas
  ) values (
    p_nombre, v_tipo_id, 'otro', p_marca, p_modelo, p_serie,
    coalesce(p_estado, 'en_stock'), coalesce(p_condicion, 'funciona'),
    p_empleado_id, p_responsable_externo, p_bodega_id, p_ubicacion,
    p_costo, coalesce(p_moneda, 'DOP'), coalesce(p_costo_origen, case when p_costo is not null then 'estimado' else 'compra' end),
    p_fecha_compra, p_garantia_hasta, p_service_tag, p_numero_parte, p_imei,
    case when p_origen = 'claude' then trim(both ' ' from 'Cargado por Claude. ' || coalesce(p_notas,'')) else p_notas end
  )
  returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function sgc.tec_equipo_crear_o_actualizar_asistente(
  uuid, text, uuid, text, text, text, text, text, text, uuid, text, uuid, text,
  numeric, text, text, date, date, text, text, text, text, text
) to authenticated;

-- ── (8) Escritura: cambiar estado/condición ────────────────────────────────
create or replace function sgc.tec_equipo_cambiar_estado_asistente(p_id uuid, p_estado text default null, p_condicion text default null)
returns void
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  update sgc.tec_equipos set estado = coalesce(p_estado, estado), condicion = coalesce(p_condicion, condicion) where id = p_id;
  if not found then raise exception 'Equipo no encontrado.' using errcode = 'P0002'; end if;
end;
$function$;
grant execute on function sgc.tec_equipo_cambiar_estado_asistente(uuid, text, text) to authenticated;

-- ── (9) Escritura: asignar (empleado/responsable externo/ubicación) ───────
create or replace function sgc.tec_equipo_asignar_asistente(
  p_id uuid, p_empleado_id uuid default null, p_responsable_externo text default null,
  p_bodega_id uuid default null, p_ubicacion text default null
)
returns void
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  update sgc.tec_equipos set
    empleado_id = p_empleado_id, responsable_externo = p_responsable_externo,
    bodega_id = coalesce(p_bodega_id, bodega_id), ubicacion = coalesce(p_ubicacion, ubicacion)
  where id = p_id;
  if not found then raise exception 'Equipo no encontrado.' using errcode = 'P0002'; end if;
end;
$function$;
grant execute on function sgc.tec_equipo_asignar_asistente(uuid, uuid, text, uuid, text) to authenticated;

-- ── (10) Escritura: alta de un tipo nuevo ───────────────────────────────────
create or replace function sgc.tec_equipo_tipo_crear_asistente(p_label text)
returns uuid
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_clave text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_label is null or trim(p_label) = '' then perform sgc.error_campo('label', 'requerido', 'El nombre del tipo es obligatorio.'); end if;
  v_clave := regexp_replace(lower(trim(p_label)), '[^a-z0-9]+', '_', 'g');
  v_clave := trim(both '_' from v_clave);
  insert into sgc.tec_equipo_tipos (clave, label, orden) values (v_clave, trim(p_label), 200)
    on conflict (clave) do update set label = excluded.label
    returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function sgc.tec_equipo_tipo_crear_asistente(text) to authenticated;

-- ── (11) Lote: confirma SOLO las filas marcadas, por fila (DA-15 opción a) ──
-- `p_borrador_id` identifica el borrador (dueño ya verificado por RLS de
-- claude_borradores); `p_filas_seleccionadas` son los índices (0-based) del
-- arreglo `params.equipos` que la pantalla de revisión dejó marcados. Máximo
-- 50 filas por lote (match con el límite documentado en DA-15).
create or replace function sgc.tec_equipos_lote_confirmar(p_borrador_id uuid, p_filas_seleccionadas int[])
returns jsonb
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_borrador sgc.claude_borradores;
  v_filas jsonb;
  v_total int;
  v_resultados jsonb := '[]'::jsonb;
  v_fila jsonb;
  v_idx int;
  v_id uuid;
  v_ok_count int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;

  select * into v_borrador from sgc.claude_borradores where id = p_borrador_id and usuario_id = auth.uid();
  if v_borrador is null then raise exception 'Borrador no encontrado.' using errcode = 'P0002'; end if;
  if v_borrador.tool <> 'proponer_equipos_tecnologicos_lote' then
    raise exception 'Este borrador no es un lote de equipos tecnológicos.';
  end if;
  if v_borrador.estado = 'confirmado' then
    return jsonb_build_object('ok', true, 'duplicado', true, 'mensaje', coalesce(v_borrador.resultado->>'mensaje', 'Ya estaba confirmado.'));
  end if;

  v_filas := coalesce(v_borrador.params -> 'equipos', '[]'::jsonb);
  v_total := jsonb_array_length(v_filas);
  if v_total > 50 then raise exception 'El lote supera el máximo de 50 equipos.'; end if;

  for v_idx in 0 .. v_total - 1 loop
    if p_filas_seleccionadas is not null and not (v_idx = any(p_filas_seleccionadas)) then
      continue;
    end if;
    v_fila := v_filas -> v_idx;
    begin
      v_id := sgc.tec_equipo_crear_o_actualizar_asistente(
        p_nombre := v_fila->>'nombre', p_tipo_clave := v_fila->>'tipo_clave',
        p_marca := v_fila->>'marca', p_modelo := v_fila->>'modelo', p_serie := v_fila->>'serie',
        p_estado := coalesce(v_fila->>'estado', 'en_stock'), p_condicion := coalesce(v_fila->>'condicion', 'funciona'),
        p_costo := nullif(v_fila->>'costo', '')::numeric, p_moneda := coalesce(v_fila->>'moneda', 'DOP'),
        p_costo_origen := coalesce(v_fila->>'costo_origen', 'estimado'),
        p_ubicacion := v_fila->>'ubicacion', p_notas := v_fila->>'notas', p_origen := 'claude'
      );
      v_resultados := v_resultados || jsonb_build_object('indice', v_idx, 'ok', true, 'equipo_id', v_id, 'nombre', v_fila->>'nombre');
      v_ok_count := v_ok_count + 1;
    exception when others then
      v_resultados := v_resultados || jsonb_build_object('indice', v_idx, 'ok', false, 'nombre', v_fila->>'nombre', 'error', sqlerrm);
    end;
  end loop;

  update sgc.claude_borradores set
    estado = 'confirmado',
    resultado = jsonb_build_object(
      'ok', true,
      'mensaje', format('%s de %s equipos cargados.', v_ok_count, v_total),
      'filas', v_resultados
    )
  where id = p_borrador_id;

  return jsonb_build_object('ok', true, 'cargados', v_ok_count, 'total', v_total, 'filas', v_resultados);
end;
$function$;
grant execute on function sgc.tec_equipos_lote_confirmar(uuid, int[]) to authenticated;

-- ── (12) que_puedo_consultar() — registra el inventario tecnológico ─────────
-- MISMO cuerpo de sql/2026-10-25-cy-conector-fases-3-4-5.sql + una fila nueva
-- 'tecnologia_inventario' (regla 19). Cierra el reportar_gap "crear/cargar
-- equipos del inventario tecnológico" (nota 6 del contexto): ya hay mecanismo.
create or replace function sgc.que_puedo_consultar()
 returns table (modulo text, etiqueta text, puede_ver boolean, herramientas text[])
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  with modulos(modulo, etiqueta, herramientas) as (
    values
      ('identidad', 'Quién soy / mis permisos', array['quien_soy','mis_permisos']),
      ('inventario', 'Inventario', array['buscar_articulos','stock_por_almacen','articulos_bajo_minimo','disponibilidad_de_articulo','movimientos_recientes','material_en_cuarentena','listar_almacenes','proponer_decision_requisicion','proponer_orden_de_compra','proponer_entrada_inventario','proponer_correccion_conduce']),
      ('compras', 'Compras', array['mis_ordenes_de_compra','proponer_orden_de_compra','detalle_compra_tecnologica']),
      ('rrhh', 'RRHH', array['directorio_empleados']),
      ('proyectos', 'Proyectos/obras', array['mis_proyectos','resumen_proyectos','cronograma_de_obra','personal_de_obra']),
      ('flota', 'Flota', array['listar_vehiculos','vehiculos_en_uso','resumen_flota','mantenimientos_pendientes','log_combustible','resumen_flota_carga_semana','echada_detalle','proponer_mantenimiento']),
      ('transporte', 'Transporte (chofer)', array['mis_rutas_hoy','rutas_del_dia','despachantes_disponibles','mis_solicitudes_movimiento']),
      ('bitacora', 'Bitácora', array['cobertura_de_bitacoras','resumen_bitacoras_semana','bitacora_detalle','proponer_bitacora']),
      ('documentos', 'Documentos', array['listar_plantillas_documento','listar_documentos_generados']),
      ('legal', 'Legal', array['listar_expedientes_legales','listar_aprobaciones_legales','proponer_decision_legal','proponer_actualizacion_expediente']),
      ('tareas', 'Tareas (de otros)', array['mis_tareas','proponer_cambio_tarea']),
      ('ingenieria', 'Ingeniería / Solicitud de movimiento', array['mis_solicitudes_movimiento','proponer_solicitud_movimiento']),
      ('reuniones', 'Reuniones', array['mis_reuniones','acuerdos_pendientes','resumen_reunion','proponer_reunion','proponer_cancelar_reunion','proponer_cerrar_acuerdo']),
      ('admin', 'Administración', array['listar_usuarios_admin','mi_actividad_auditoria']),
      ('notas', 'Dev notes / Notas (siempre, sin módulo)', array['mis_notas','detalle_nota','crear_nota','actualizar_nota','mover_nota_a_grupo']),
      ('mensajes', 'Mensajería (siempre, sin módulo)', array['mis_mensajes','proponer_mensaje']),
      ('soporte', 'Soporte / mis reportes (siempre, sin módulo)', array['mis_reportes_soporte']),
      ('soporte_admin', 'Soporte — todos los reportes (solo admin/Tecnología)', array['listar_reportes_soporte','detalle_reporte_soporte','resumen_reportes_soporte','cambiar_estado_reporte','ver_gaps_registrados']),
      ('requisiciones', 'Requisiciones (siempre, sin módulo)', array['listar_requisiciones','requisiciones_pendientes','resumen_requisiciones_semana','resumen_estatus_requisiciones']),
      ('incentivos', 'Mi rendimiento (siempre, sin módulo)', array['mi_rendimiento']),
      ('admin_visibilidad', 'Administración — conector, envíos y alertas (solo admin/Tecnología)', array['conexiones_claude','estado_envios_automaticos','reglas_de_alertas','historial_importaciones','proponer_cambio_envio_automatico','proponer_probar_envio']),
      ('dev_ops', 'Tecnología — errores y versiones (solo admin/Tecnología)', array['errores_recientes','proponer_nota_de_version']),
      -- DA-15 — inventario tecnológico: admin/Tecnología O el permiso granular
      -- del Subadministrador ('tecnologia.inventario'), sin el módulo completo.
      ('tecnologia_inventario', 'Inventario tecnológico (equipos de TI)', array['resumen_inventario_tecnologico','listar_equipos_tecnologicos','detalle_equipo_tecnologico','listar_tipos_equipo','proponer_tipo_equipo','proponer_equipo_tecnologico','proponer_cambio_estado_equipo','proponer_asignacion_equipo','proponer_equipos_tecnologicos_lote'])
  )
  select m.modulo, m.etiqueta,
    (m.modulo in ('identidad','notas','mensajes','soporte','requisiciones','incentivos','tareas')
      or sgc.tiene_modulo(m.modulo) or sgc.is_admin()
      or (m.modulo = 'soporte_admin' and sgc.es_tecnologia())
      or (m.modulo in ('admin_visibilidad','dev_ops') and (sgc.is_admin() or sgc.es_tecnologia()))
      or (m.modulo = 'tecnologia_inventario' and (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_ver_submodulo('tecnologia.inventario')))),
    m.herramientas
  from modulos m
  order by m.etiqueta;
$function$;
grant execute on function sgc.que_puedo_consultar() to authenticated;

-- ── (13) Cierra el gap registrado (nota 6): "crear/cargar equipos del
--     inventario tecnológico" ya tiene mecanismo (herramientas + lote). ──────
update sgc.assistant_consultas_no_atendidas
   set resuelto = true, resuelto_at = now()
 where motivo = 'sin_tool'
   and pregunta ilike '%equipo%tecnolog%'
   and not resuelto;

commit;
