-- ============================================================================
-- CS5 — el conector de Claude cubre módulos que hoy no tiene: Dev notes/Notas,
-- Mensajes, Documentos, Legal (expedientes), RRHH, Administración (lectura),
-- Soporte. Regla 19: para Mensajes se reusa `sgc.tiene_modulo` (ya vivo) y el
-- MISMO predicado de `sgc.es_participante`; para notas se reusa la RLS viva de
-- sgc.notas_sel (puede_ver_nota + ambito<>'dev' or es_desarrollador). Todo
-- SOLO LECTURA, SECURITY DEFINER, recortado — ninguna de estas escribe nada.
-- Las demás herramientas de esta ronda reusan RPCs YA existentes y probadas
-- por el front (directorio_empleados, listar_aprobaciones_legales,
-- solicitudes_movimiento_listar, incentivo_mi_rendimiento, auditoria_listar,
-- mis_ordenes_de_compra) — no se tocan aquí.
-- ============================================================================

begin;

-- ── Dev notes / Notas — propias + compartidas, sin imágenes/binario ─────────
create or replace function sgc.mis_notas_resumen(p_ambito text default null)
 returns table (
   id uuid, titulo text, resumen text, ambito text, tags text[],
   es_propia boolean, updated_at timestamptz, pinned boolean
 )
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select n.id, n.titulo, left(regexp_replace(n.contenido, '!\[[^\]]*\]\(nota-img:[^)]+\)', '[imagen]', 'g'), 400),
    n.ambito, n.tags, (n.owner_id = auth.uid()), n.updated_at, n.pinned
  from sgc.notas n
  where not n.archivada
    and (p_ambito is null or n.ambito = p_ambito)
    and sgc.puede_ver_nota(n.id, auth.uid())
    and (n.ambito <> 'dev' or sgc.es_desarrollador())
  order by n.pinned desc, n.updated_at desc
  limit 100;
$function$;
grant execute on function sgc.mis_notas_resumen(text) to authenticated;

-- ── Mensajes — mis conversaciones, solo el último mensaje (no el historial) ──
create or replace function sgc.mis_conversaciones_resumen()
 returns table (
   conversacion_id uuid, nombre text, tipo text,
   ultimo_mensaje text, ultimo_autor text, ultimo_at timestamptz, no_leidos integer
 )
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select c.id, coalesce(c.nombre, '(directo)'), c.tipo,
    left(um.contenido, 200), au.nombre, um.created_at,
    (select count(*)::int from sgc.mensajes m2
       where m2.conversacion_id = c.id and m2.created_at > cp.last_read_at and m2.autor_id <> auth.uid())
  from sgc.conversaciones c
  join sgc.conversacion_participantes cp on cp.conversacion_id = c.id and cp.usuario_id = auth.uid()
  left join lateral (
    select m.contenido, m.autor_id, m.created_at from sgc.mensajes m
    where m.conversacion_id = c.id order by m.created_at desc limit 1
  ) um on true
  left join sgc.usuarios au on au.id = um.autor_id
  order by um.created_at desc nulls last
  limit 30;
$function$;
grant execute on function sgc.mis_conversaciones_resumen() to authenticated;

-- ── Documentos — plantillas disponibles (metadatos, sin el HTML/docx) ───────
create or replace function sgc.listar_plantillas_documento()
 returns table (id uuid, nombre text, categoria text, es_default boolean)
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select p.id, p.nombre, p.categoria, p.es_default
  from sgc.plantillas_documento p
  where p.activo and (sgc.tiene_modulo('documentos') or sgc.is_admin())
  order by p.categoria, p.nombre;
$function$;
grant execute on function sgc.listar_plantillas_documento() to authenticated;

-- ── Legal — expedientes (metadatos; el módulo ya gatea quién ve la herramienta) ──
create or replace function sgc.listar_expedientes_legales(p_estado text default null)
 returns table (
   id uuid, codigo text, titulo text, tipo text, estado text, prioridad text,
   proyecto_id uuid, fecha_limite date, responsable text
 )
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select e.id, e.codigo, e.titulo, e.tipo, e.estado, e.prioridad, e.proyecto_id, e.fecha_limite, r.nombre
  from sgc.expedientes_legales e
  left join sgc.usuarios r on r.id = e.responsable_id
  where (sgc.tiene_modulo('legal') or sgc.is_admin())
    and (p_estado is null or e.estado = p_estado)
  order by e.fecha_limite nulls last, e.created_at desc
  limit 100;
$function$;
grant execute on function sgc.listar_expedientes_legales(text) to authenticated;

-- ── Administración (lectura) — usuarios + sus roles, SIN secretos ───────────
create or replace function sgc.listar_usuarios_admin()
 returns table (id uuid, nombre text, email text, activo boolean, roles text[])
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre, u.email, u.activo,
    coalesce(array_agg(r.nombre order by r.nombre) filter (where r.nombre is not null), '{}')
  from sgc.usuarios u
  left join sgc.usuarios_roles ur on ur.usuario_id = u.id
  left join sgc.roles r on r.id = ur.rol_id
  where sgc.is_admin()
  group by u.id, u.nombre, u.email, u.activo
  order by u.nombre
  limit 200;
$function$;
grant execute on function sgc.listar_usuarios_admin() to authenticated;

-- ── que_puedo_consultar — catálogo vivo: por módulo, ¿esta persona lo ve? y con
-- qué herramienta. Misma fuente de verdad que la barra lateral (sgc.tiene_modulo
-- / sgc.is_admin), para que Claude la llame primero cuando no sepa dónde buscar. ──
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
      ('notas', 'Dev notes / Notas (siempre, sin módulo)', array['mis_notas']),
      ('mensajes', 'Mensajería (siempre, sin módulo)', array['mis_mensajes']),
      ('soporte', 'Soporte / mis reportes (siempre, sin módulo)', array['mis_reportes_soporte']),
      ('requisiciones', 'Requisiciones (siempre, sin módulo)', array['listar_requisiciones','requisiciones_pendientes','resumen_requisiciones_semana','resumen_estatus_requisiciones']),
      ('incentivos', 'Mi rendimiento (siempre, sin módulo)', array['mi_rendimiento'])
  )
  select m.modulo, m.etiqueta,
    (m.modulo in ('identidad','notas','mensajes','soporte','requisiciones','incentivos','tareas')
      or sgc.tiene_modulo(m.modulo) or sgc.is_admin()),
    m.herramientas
  from modulos m
  order by m.etiqueta;
$function$;
grant execute on function sgc.que_puedo_consultar() to authenticated;

-- ── Soporte — mis propios reportes de error/sugerencia ──────────────────────
create or replace function sgc.mis_reportes_soporte()
 returns table (id uuid, tipo text, asunto text, estado text, created_at timestamptz, resuelto_en timestamptz)
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select id, tipo, asunto, estado, created_at, resuelto_en
  from sgc.reportes_usuario
  where usuario_id = auth.uid()
  order by created_at desc
  limit 50;
$function$;
grant execute on function sgc.mis_reportes_soporte() to authenticated;

commit;
