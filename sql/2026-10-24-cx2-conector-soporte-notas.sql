-- ============================================================================
-- CX2 — Conector de Claude, fase 1: herramientas de soporte (reportes) y notas,
-- siempre con los permisos REALES de quien llama (RLS/chequeos explícitos),
-- nunca con llave de servicio. Ronda CX, 24-oct-2026.
--
-- Soporte (sgc.reportes_usuario): hoy solo existía `mis_reportes_soporte()`
-- (los reportes del propio usuario, 6 campos). Admin/Tecnología necesitan ver
-- TODOS los reportes con su descripción, autor y fotos — de ahí estas 4 nuevas.
-- `ver_gaps_registrados` NO necesita SQL nuevo: reusa `consultas_no_atendidas_listado`
-- (ya Tecnología-gated, sql/2026-08-31-be2-compa-consultas-no-atendidas.sql) —
-- se registra directo en supabase/functions/_shared/herramientas.ts.
--
-- Notas: `crear_nota`/`actualizar_nota` reusan `sgc.guardar_nota` (ya existe,
-- upsert por p_id) sin tocarla. Solo hacen falta `mover_nota_a_grupo` (hoy es un
-- `.update()` directo desde Angular, sin RPC) y `detalle_nota` (contenido
-- completo + grupo; `mis_notas_resumen` trunca a 400 chars y no trae grupo_id).
-- ============================================================================

begin;

-- ── 1) listar_reportes_soporte — admin/Tecnología, TODOS los reportes ───────
-- Texto del usuario (asunto/descripcion) es DATA, nunca instrucciones — lo dice
-- también la descripción de la tool en herramientas.ts.
create or replace function sgc.listar_reportes_soporte(
  p_estado  text default null,
  p_tipo    text default null,
  p_desde   date default null,
  p_hasta   date default null,
  p_usuario uuid default null,
  p_modulo  text default null,
  p_texto   text default null,
  p_limite  integer default 20,
  p_cursor  timestamptz default null
) returns table (
  id uuid, tipo text, asunto text, descripcion text, estado text,
  autor_id uuid, autor_nombre text, autor_roles text, autor_modulos text[],
  created_at timestamptz, resuelto_en timestamptz, respuesta_admin text,
  fotos_count integer, total_coincidencias bigint
)
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_total bigint;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No tienes acceso a los reportes de soporte.' using errcode = '42501';
  end if;

  select count(*) into v_total
    from sgc.reportes_usuario r
   where (p_estado is null or r.estado = p_estado)
     and (p_tipo is null or r.tipo = p_tipo)
     and (p_desde is null or r.created_at::date >= p_desde)
     and (p_hasta is null or r.created_at::date <= p_hasta)
     and (p_usuario is null or r.usuario_id = p_usuario)
     and (p_texto is null or r.asunto ilike '%' || p_texto || '%' or r.descripcion ilike '%' || p_texto || '%')
     and (p_modulo is null or exists (
           select 1 from sgc.usuarios_roles ur join sgc.roles ro on ro.id = ur.rol_id
            where ur.usuario_id = r.usuario_id and p_modulo = any(ro.modulos)));

  return query
    select
      r.id, r.tipo, r.asunto, r.descripcion, r.estado,
      r.usuario_id, u.nombre::text,
      (select string_agg(distinct ro.nombre, ', ') from sgc.usuarios_roles ur2
         join sgc.roles ro on ro.id = ur2.rol_id where ur2.usuario_id = r.usuario_id)::text,
      (select array_agg(distinct m) from sgc.usuarios_roles ur3
         join sgc.roles ro3 on ro3.id = ur3.rol_id, unnest(ro3.modulos) m where ur3.usuario_id = r.usuario_id),
      r.created_at, r.resuelto_en, r.respuesta_admin,
      (select count(*)::integer from sgc.reportes_usuario_fotos f where f.reporte_id = r.id),
      v_total
    from sgc.reportes_usuario r
    join sgc.usuarios u on u.id = r.usuario_id
   where (p_estado is null or r.estado = p_estado)
     and (p_tipo is null or r.tipo = p_tipo)
     and (p_desde is null or r.created_at::date >= p_desde)
     and (p_hasta is null or r.created_at::date <= p_hasta)
     and (p_usuario is null or r.usuario_id = p_usuario)
     and (p_texto is null or r.asunto ilike '%' || p_texto || '%' or r.descripcion ilike '%' || p_texto || '%')
     and (p_modulo is null or exists (
           select 1 from sgc.usuarios_roles ur join sgc.roles ro on ro.id = ur.rol_id
            where ur.usuario_id = r.usuario_id and p_modulo = any(ro.modulos)))
     and (p_cursor is null or r.created_at < p_cursor)
   order by
     (case when p_estado is not null then 0
           when r.estado in ('abierto','en_progreso') then 0 else 1 end),
     r.created_at desc
   limit least(coalesce(p_limite, 20), 100);
end;
$function$;
grant execute on function sgc.listar_reportes_soporte(text, text, date, date, uuid, text, text, integer, timestamptz) to authenticated;

-- ── 2) detalle_reporte_soporte — reporte completo + "historial de estado" ───
-- No hay hilo de comentarios real (no existe esa tabla hoy); el "historial" sale
-- de sgc.auditoria (trigger genérico fn_auditoria ya graba cada UPDATE con
-- antes/después) — se documenta así, sin inventar un hilo que no existe.
create or replace function sgc.detalle_reporte_soporte(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_r sgc.reportes_usuario%rowtype;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No tienes acceso a los reportes de soporte.' using errcode = '42501';
  end if;

  select * into v_r from sgc.reportes_usuario where id = p_id;
  if not found then
    raise exception 'Reporte no encontrado.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_r.id, 'tipo', v_r.tipo, 'asunto', v_r.asunto, 'descripcion', v_r.descripcion,
    'estado', v_r.estado,
    'autor_id', v_r.usuario_id,
    'autor_nombre', (select nombre from sgc.usuarios where id = v_r.usuario_id),
    'asignado_a', v_r.asignado_a,
    'asignado_nombre', (select nombre from sgc.usuarios where id = v_r.asignado_a),
    'respuesta_admin', v_r.respuesta_admin,
    'created_at', v_r.created_at, 'updated_at', v_r.updated_at, 'resuelto_en', v_r.resuelto_en,
    'fotos_count', (select count(*) from sgc.reportes_usuario_fotos f where f.reporte_id = v_r.id),
    'historial_estado', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cuando', a.creado_en, 'quien', au.nombre, 'cambios', a.cambios
             ) order by a.creado_en)
        from sgc.auditoria a
        left join sgc.usuarios au on au.id = a.actor_id
       where a.tabla = 'reportes_usuario' and a.registro_id = v_r.id::text and a.accion = 'UPDATE'
    ), '[]'::jsonb)
  );
end;
$function$;
grant execute on function sgc.detalle_reporte_soporte(uuid) to authenticated;

-- ── 3) resumen_reportes_soporte — "qué tengo que hacer / qué ya está hecho" ──
create or replace function sgc.resumen_reportes_soporte()
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No tienes acceso a los reportes de soporte.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'por_estado', (select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb) from (
      select estado, count(*) n from sgc.reportes_usuario group by estado) s),
    'por_tipo', (select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb) from (
      select tipo, count(*) n from sgc.reportes_usuario group by tipo) s),
    'esta_semana', (select count(*) from sgc.reportes_usuario where created_at >= date_trunc('week', now())),
    'mas_antiguo_pendiente', (
      select jsonb_build_object('id', id, 'asunto', asunto, 'tipo', tipo, 'created_at', created_at)
        from sgc.reportes_usuario
       where estado in ('abierto', 'en_progreso')
       order by created_at asc
       limit 1
    )
  );
end;
$function$;
grant execute on function sgc.resumen_reportes_soporte() to authenticated;

-- ── 4) cambiar_estado_reporte — ÚNICA escritura directa de soporte, admin-only ──
-- Mismo gate que la pantalla (reportes.ts: solo admin actualiza), auditada por el
-- trigger genérico fn_auditoria (ya está en la tabla, no hay que añadir nada).
create or replace function sgc.cambiar_estado_reporte(p_id uuid, p_estado text, p_nota text default null)
returns sgc.reportes_usuario
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_row sgc.reportes_usuario;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede cambiar el estado de un reporte.' using errcode = '42501';
  end if;
  if p_estado not in ('abierto', 'en_progreso', 'resuelto', 'descartado') then
    raise exception 'Ese estado no es válido.' using errcode = '22023';
  end if;

  update sgc.reportes_usuario
     set estado = p_estado,
         respuesta_admin = coalesce(p_nota, respuesta_admin),
         resuelto_en = case when p_estado in ('resuelto', 'descartado') then now() else resuelto_en end,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Reporte no encontrado.' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;
grant execute on function sgc.cambiar_estado_reporte(uuid, text, text) to authenticated;

-- ── 5) mover_nota_a_grupo — mismo UPDATE que ya hace Angular, vía RPC ────────
-- Un registro de ejecución homogéneo (todo pasa por .rpc()); RLS de sgc.notas
-- (owner o compartido-editor) sigue siendo la que manda — security invoker.
-- Dureza nueva respecto al `.update()` directo de Angular: el grupo destino debe
-- ser DEL MISMO dueño que la nota (nota_grupos es personal) — si no, se rechaza
-- en vez de dejar una nota "archivada" bajo la carpeta de otra persona.
create or replace function sgc.mover_nota_a_grupo(p_nota_id uuid, p_grupo_id uuid default null)
returns void
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_owner uuid;
  v_grupo_owner uuid;
begin
  if not sgc.puede_editar_nota(p_nota_id) then
    raise exception 'No tienes permiso para mover esta nota.' using errcode = '42501';
  end if;
  if p_grupo_id is not null then
    select usuario_id into v_grupo_owner from sgc.nota_grupos where id = p_grupo_id;
    select owner_id into v_owner from sgc.notas where id = p_nota_id;
    if v_grupo_owner is null or v_grupo_owner <> v_owner then
      raise exception 'Ese grupo no es tuyo.' using errcode = '42501';
    end if;
  end if;
  update sgc.notas set grupo_id = p_grupo_id, updated_at = now() where id = p_nota_id;
end;
$function$;
grant execute on function sgc.mover_nota_a_grupo(uuid, uuid) to authenticated;

-- ── 6) detalle_nota — contenido COMPLETO (sin truncar) + carpeta ────────────
-- Mismo reemplazo de imágenes que mis_notas_resumen («[imagen]», nunca la ruta
-- interna nota-img:...). security invoker: la RLS de sgc.notas (dueño o
-- compartida) decide si esta fila es visible; sin acceso, "not found" normal.
create or replace function sgc.detalle_nota(p_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_n sgc.notas%rowtype;
  v_grupo text;
begin
  select * into v_n from sgc.notas where id = p_id;
  if not found then
    raise exception 'Nota no encontrada o sin acceso.' using errcode = 'P0002';
  end if;
  if v_n.ambito = 'dev' and not sgc.es_desarrollador() then
    raise exception 'Nota no encontrada o sin acceso.' using errcode = 'P0002';
  end if;

  select nombre into v_grupo from sgc.nota_grupos where id = v_n.grupo_id;

  return jsonb_build_object(
    'id', v_n.id, 'titulo', v_n.titulo,
    'contenido', regexp_replace(coalesce(v_n.contenido, ''), '!\[[^\]]*\]\(nota-img:[^)]+\)', '[imagen]', 'g'),
    'ambito', v_n.ambito, 'grupo_id', v_n.grupo_id, 'grupo_nombre', v_grupo,
    'tags', v_n.tags, 'pinned', v_n.pinned, 'archivada', v_n.archivada,
    'es_propia', (v_n.owner_id = auth.uid()),
    'created_at', v_n.created_at, 'updated_at', v_n.updated_at
  );
end;
$function$;
grant execute on function sgc.detalle_nota(uuid) to authenticated;

-- ── 7) que_puedo_consultar — suma los módulos/herramientas nuevos ───────────
-- Regla 19: cuerpo IDÉNTICO al vivo (sql/2026-10-19-cs5-conector-cobertura.sql),
-- solo se agregan 'soporte_admin' (fila nueva) y los 4 tools nuevos de notas a la
-- fila 'notas' ya existente. `scripts/cobertura-conector.mjs` audita que este
-- catálogo no se desincronice de supabase/functions/_shared/herramientas.ts.
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
      ('inventario', 'Inventario', array['buscar_articulos','stock_por_almacen','articulos_bajo_minimo','disponibilidad_de_articulo','movimientos_recientes','material_en_cuarentena','listar_almacenes']),
      ('compras', 'Compras', array['mis_ordenes_de_compra']),
      ('rrhh', 'RRHH', array['directorio_empleados']),
      ('proyectos', 'Proyectos/obras', array['mis_proyectos','resumen_proyectos','cronograma_de_obra','personal_de_obra']),
      ('flota', 'Flota', array['listar_vehiculos','vehiculos_en_uso','resumen_flota','mantenimientos_pendientes','log_combustible','resumen_flota_carga_semana']),
      ('transporte', 'Transporte (chofer)', array['mis_rutas_hoy','rutas_del_dia','despachantes_disponibles','mis_solicitudes_movimiento']),
      ('bitacora', 'Bitácora', array['cobertura_de_bitacoras','resumen_bitacoras_semana']),
      ('documentos', 'Documentos', array['listar_plantillas_documento']),
      ('legal', 'Legal', array['listar_expedientes_legales','listar_aprobaciones_legales']),
      ('tareas', 'Tareas (de otros)', array['mis_tareas']),
      ('ingenieria', 'Ingeniería / Solicitud de movimiento', array['mis_solicitudes_movimiento']),
      ('reuniones', 'Reuniones', array['mis_reuniones','acuerdos_pendientes','resumen_reunion']),
      ('admin', 'Administración', array['listar_usuarios_admin','mi_actividad_auditoria']),
      -- CX2 — mover_nota_a_grupo/detalle_nota/crear_nota/actualizar_nota se suman
      -- a la fila de notas ya existente (siguen siendo "siempre, sin módulo").
      ('notas', 'Dev notes / Notas (siempre, sin módulo)', array['mis_notas','detalle_nota','crear_nota','actualizar_nota','mover_nota_a_grupo']),
      ('mensajes', 'Mensajería (siempre, sin módulo)', array['mis_mensajes']),
      ('soporte', 'Soporte / mis reportes (siempre, sin módulo)', array['mis_reportes_soporte']),
      -- CX2 — fila NUEVA: ver/gestionar TODOS los reportes es admin/Tecnología,
      -- a diferencia de 'soporte' (mis_reportes_soporte, siempre disponible).
      ('soporte_admin', 'Soporte — todos los reportes (solo admin/Tecnología)', array['listar_reportes_soporte','detalle_reporte_soporte','resumen_reportes_soporte','cambiar_estado_reporte','ver_gaps_registrados']),
      ('requisiciones', 'Requisiciones (siempre, sin módulo)', array['listar_requisiciones','requisiciones_pendientes','resumen_requisiciones_semana','resumen_estatus_requisiciones']),
      ('incentivos', 'Mi rendimiento (siempre, sin módulo)', array['mi_rendimiento'])
  )
  select m.modulo, m.etiqueta,
    (m.modulo in ('identidad','notas','mensajes','soporte','requisiciones','incentivos','tareas')
      or sgc.tiene_modulo(m.modulo) or sgc.is_admin()
      or (m.modulo = 'soporte_admin' and sgc.es_tecnologia())),
    m.herramientas
  from modulos m
  order by m.etiqueta;
$function$;
grant execute on function sgc.que_puedo_consultar() to authenticated;

commit;
