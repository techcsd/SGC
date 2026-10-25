-- ============================================================================
-- CY — Conector de Claude, fases 3-4-5 de la nota de Xaviel ("SGC Connector –
-- Full Access Improvement Plan"). Continúa CX2 (fase 1, ya en prod). Siempre
-- con los permisos reales de quien llama; nada con llave de servicio.
--
-- FASE 3 (visibilidad admin): reusa RPCs ya existentes donde los hay
-- (claude_conexiones_listado, envios_automaticos_listar, app_error_reports_grupos,
-- echada_detalle) + funciones nuevas simples sobre tablas que YA existen
-- (reglas_de_alertas, historial_importaciones, detalle_compra_tecnologica,
-- listar_documentos_generados, bitacora_detalle) + 2 extensiones aditivas
-- (claude_conexiones_listado gana "borradores_pendientes"; reunion_resumen_compa
-- gana el estado de sincronización con Calendar).
--
-- FASE 4 (borradores "proponer_*"): TODOS modo D (draft+confirmar) — la nota
-- de la fase 1 ya decidió "Claude escribe directo SOLO notas y estado de
-- reportes" (W); todo lo demás sigue siendo un borrador. Donde ya existe el RPC
-- que usa la pantalla real, se reusa tal cual (mismo camino, AU1). Donde no
-- existe, es una función nueva que REPRODUCE EXACTAMENTE el mismo
-- update/insert que ya hace Angular (mismo nombre de columnas, misma RLS que
-- ya gobierna esa tabla) — no se inventa lógica de negocio nueva.
--
-- Deliberadamente NO construido esta ronda (ver supabase/functions/assistant/
-- PERMISOS-TOOLS.md §"CY" para el detalle completo de cada motivo):
--   - sesiones_de_usuario (admin, ver sesiones de OTRO): mis_sesiones()/
--     cerrar_mi_sesion() YA llaman sgc.rechazar_si_cliente_oauth() — el propio
--     proyecto ya decidió que esta familia NO se expone a un cliente OAuth
--     (Claude Desktop lo es). Construir una versión "admin" del mismo dato
--     iría en contra de esa decisión ya tomada, no es un olvido.
--   - proponer_cambio_usuario (activar/desactivar, roles): assign_roles() TAMBIÉN
--     llama rechazar_si_cliente_oauth() — confirma el mismo criterio; además
--     activar/desactivar pasa por una edge function (bloquea en Auth, no solo
--     un flag), sin equivalente en RPC.
--   - reintentar_sync_calendario, proponer_revocar_conexion_claude: ambas
--     acciones reales son llamadas a OTRA edge function (reuniones-calendar,
--     claude-conexiones), no un RPC — el mecanismo de confirmar un borrador
--     (claude-borrador) solo ejecuta RPCs vía supabase.rpc(), nunca invoca otra
--     edge. Extender ese mecanismo es una decisión de arquitectura aparte.
--   - proponer_echada_combustible (ejecutar, no solo preparar): registrar_combustible_app
--     exige fotos de evidencia que un borrador de chat no tiene — por eso ya
--     existe preparar_echada (CV1, "abrir formulario"), que se queda como está.
--   - cambios_pendientes_de_publicar / version_por_usuario: no existe ninguna
--     tabla que trackee qué versión usa cada usuario ahora mismo — se necesitaría
--     infraestructura nueva (reportar versión activa por sesión), no un SELECT.
--   - avisos_de_seguridad: el Security Advisor de Supabase solo se audita
--     on-demand vía Management API (scripts/audit-public-schema-cu2.mjs) — no
--     hay tabla persistida que una RPC pueda leer.
--   - SQL de solo lectura sobre vistas v_*: la propia nota de Xaviel lo marca
--     "Not now" en su tabla de decisiones — se deja fuera a propósito.
-- ============================================================================

begin;

-- ── FASE 3.1 — conexiones_claude: agrega "borradores_pendientes" ───────────
-- Regla 19: mismo cuerpo vivo de sql/2026-10-18-cr1-claude-conector.sql:168,
-- solo se agrega la columna al final (aditivo). Postgres no deja CREATE OR
-- REPLACE cuando cambian las columnas OUT — hay que dropear primero.
drop function if exists sgc.claude_conexiones_listado();
create or replace function sgc.claude_conexiones_listado()
 returns table (
   usuario_id uuid, nombre text, conectado_desde timestamptz,
   ultima_actividad timestamptz, consultas_7d bigint, total_llamadas bigint,
   borradores_pendientes bigint
 )
 language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select l.usuario_id, u.nombre::text, min(l.creado_en), max(l.creado_en),
           count(*) filter (where l.creado_en > now() - interval '7 days'),
           count(*),
           (select count(*) from sgc.claude_borradores b where b.usuario_id = l.usuario_id and b.estado = 'pendiente')
      from sgc.claude_llamadas l
      join sgc.usuarios u on u.id = l.usuario_id
     group by l.usuario_id, u.nombre
     order by max(l.creado_en) desc;
end;
$function$;
grant execute on function sgc.claude_conexiones_listado() to authenticated;

-- ── FASE 3.2 — reglas_de_alertas: reglas por rol + exclusiones por usuario ──
create or replace function sgc.reglas_de_alertas()
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No tienes acceso a las reglas de alertas.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'reglas', (select coalesce(jsonb_agg(jsonb_build_object(
                 'tipo', r.tipo, 'rol', r.rol, 'habilitado', r.habilitado, 'actualizado', r.updated_at
               ) order by r.tipo, r.rol), '[]'::jsonb)
                 from sgc.notif_regla r),
    'exclusiones_por_usuario', (select coalesce(jsonb_agg(jsonb_build_object(
                 'usuario_id', p.usuario_id, 'usuario_nombre', u.nombre,
                 'tipo', p.tipo, 'silenciado', p.silenciado,
                 'definida_por', p.definida_por, 'definida_por_nombre', du.nombre,
                 'actualizado', p.updated_at
               ) order by p.tipo, u.nombre), '[]'::jsonb)
                 from sgc.notif_pref_usuario p
                 join sgc.usuarios u on u.id = p.usuario_id
                 left join sgc.usuarios du on du.id = p.definida_por
                where p.definida_por is not null)
  );
end;
$function$;
grant execute on function sgc.reglas_de_alertas() to authenticated;

-- ── FASE 3.3 — historial_importaciones ──────────────────────────────────────
-- security invoker: sgc.importaciones ya tiene RLS (is_admin/es_flota_elevado/
-- tiene_modulo('inventario')) — no hace falta elevar privilegios.
create or replace function sgc.historial_importaciones(p_limite integer default 30)
returns table (
  id uuid, entidad text, archivo_path text, usuario_id uuid, usuario_nombre text,
  filas integer, nuevos integer, actualizados integer, errores jsonb,
  deshecha_at timestamptz, created_at timestamptz
)
language sql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
  select i.id, i.entidad, i.archivo_path, i.usuario_id, u.nombre::text,
         i.filas, i.nuevos, i.actualizados, i.errores, i.deshecha_at, i.created_at
    from sgc.importaciones i
    join sgc.usuarios u on u.id = i.usuario_id
   order by i.created_at desc
   limit least(coalesce(p_limite, 30), 100);
$function$;
grant execute on function sgc.historial_importaciones(integer) to authenticated;

-- ── FASE 3.4 — resumen_reunion gana el estado de sync con Calendar ──────────
-- Regla 19: cuerpo IDÉNTICO al verificado en vivo (sql/2026-10-16-cp8b-reuniones-
-- compa-tools.sql, leído de nuevo hoy) — solo se agregan 3 columnas al final
-- (aditivo), ya presentes en sgc.reuniones desde CT1. Dropear primero: cambian
-- las columnas OUT (returns table), Postgres no deja CREATE OR REPLACE directo.
drop function if exists sgc.reunion_resumen_compa(text);
create or replace function sgc.reunion_resumen_compa(p_texto text default null)
returns table(
  id uuid, titulo text, tipo_nombre text, inicio timestamptz, estado text,
  organizador_nombre text, agenda text[], acuerdos_n bigint, acta_resumen text, acta_aprobada boolean,
  calendar_sync_estado text, calendar_sync_error text, calendar_sync_at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if p_texto is not null and trim(p_texto) <> '' then
    select r.id into v_id from sgc.reuniones r
     where sgc.puede_ver_reunion(r.id) and r.titulo ilike '%'||trim(p_texto)||'%'
     order by abs(extract(epoch from (r.inicio - now()))) asc limit 1;
  end if;
  if v_id is null then
    select r.id into v_id from sgc.reuniones r
     where sgc.puede_ver_reunion(r.id) and r.inicio >= now() - interval '1 day' and r.estado <> 'cancelada'
     order by r.inicio asc limit 1;
  end if;
  if v_id is null then
    select r.id into v_id from sgc.reuniones r
     where sgc.puede_ver_reunion(r.id)
     order by r.inicio desc limit 1;
  end if;
  if v_id is null then return; end if;

  return query
    select r.id, r.titulo, rt.nombre, r.inicio, r.estado, u.nombre::text,
           (select array_agg(ag.texto order by ag.orden) from sgc.reunion_agenda ag where ag.reunion_id = r.id),
           (select count(*) from sgc.reunion_acuerdos ac where ac.reunion_id = r.id),
           (select act.resumen from sgc.reunion_actas act where act.reunion_id = r.id),
           (select act.aprobada_at is not null from sgc.reunion_actas act where act.reunion_id = r.id),
           r.calendar_sync_estado, r.calendar_sync_error, r.calendar_sync_at
      from sgc.reuniones r join sgc.reunion_tipos rt on rt.id = r.tipo_id join sgc.usuarios u on u.id = r.organizador_id
     where r.id = v_id;
end $$;
grant execute on function sgc.reunion_resumen_compa(text) to authenticated;

-- ── FASE 3.5 — detalle_compra_tecnologica ───────────────────────────────────
create or replace function sgc.detalle_compra_tecnologica(p_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare v_sol sgc.solicitudes_compra%rowtype;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id;
  if not found then
    raise exception 'Compra no encontrada o sin acceso.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', v_sol.id, 'titulo', v_sol.titulo, 'estado', v_sol.estado, 'urgencia', v_sol.urgencia,
    'subtotal', v_sol.subtotal, 'itbis', v_sol.itbis, 'itbis_incluido', v_sol.itbis_incluido, 'total', v_sol.total,
    'created_at', v_sol.created_at,
    'cotizaciones', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', c.id, 'proveedor', c.proveedor, 'monto', c.monto, 'tipo', c.tipo,
                       'elegida', c.elegida, 'nombre_archivo', c.nombre
                     ) order by c.elegida desc, c.monto asc), '[]'::jsonb)
                       from sgc.solicitud_compra_adjuntos c where c.solicitud_id = v_sol.id)
  );
end;
$function$;
grant execute on function sgc.detalle_compra_tecnologica(uuid) to authenticated;

-- ── FASE 3.6 — listar_documentos_generados ──────────────────────────────────
-- security invoker: sgc.documentos_generados ya tiene RLS por proyecto.
create or replace function sgc.listar_documentos_generados(p_proyecto_id uuid default null, p_limite integer default 30)
returns table (id uuid, nombre text, plantilla_nombre text, proyecto_nombre text, generado_por_nombre text, created_at timestamptz)
language sql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
  select d.id, d.nombre, p.nombre::text, pr.nombre, u.nombre::text, d.created_at
    from sgc.documentos_generados d
    left join sgc.plantillas_documento p on p.id = d.plantilla_id
    left join sgc.proyectos pr on pr.id = d.proyecto_id
    left join sgc.usuarios u on u.id = d.generado_por
   where p_proyecto_id is null or d.proyecto_id = p_proyecto_id
   order by d.created_at desc
   limit least(coalesce(p_limite, 30), 100);
$function$;
grant execute on function sgc.listar_documentos_generados(uuid, integer) to authenticated;

-- ── FASE 3.7 — bitacora_detalle (item-by-item, mismo gate que la pantalla) ──
create or replace function sgc.bitacora_detalle(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_row jsonb;
begin
  if not sgc.puede_ver_bitacora(p_id) then
    raise exception 'Bitácora no encontrada o sin acceso.' using errcode = 'P0002';
  end if;
  select to_jsonb(b) into v_row from sgc.bitacoras b where b.id = p_id;
  if v_row is null then
    raise exception 'Bitácora no encontrada o sin acceso.' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;
grant execute on function sgc.bitacora_detalle(uuid) to authenticated;

-- ── FASE 4.1 — proponer_cambio_tarea ─────────────────────────────────────────
-- security invoker: misma RLS que ya gobierna sgc.tareas ("tareas: update").
create or replace function sgc.actualizar_tarea_campos(
  p_id uuid, p_estado text default null, p_comentario text default null,
  p_asignado_a uuid default null, p_fecha_limite date default null
)
returns sgc.tareas
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare v_row sgc.tareas;
begin
  if p_estado is not null and p_estado not in ('pendiente','en_progreso','completada','cancelada') then
    raise exception 'Ese estado no es válido.' using errcode = '22023';
  end if;
  update sgc.tareas set
    estado = coalesce(p_estado, estado),
    asignado_a = coalesce(p_asignado_a, asignado_a),
    fecha_limite = coalesce(p_fecha_limite, fecha_limite),
    fecha_completada = case when p_estado = 'completada' then now() else fecha_completada end
  where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Tarea no encontrada o sin permiso.' using errcode = 'P0002';
  end if;
  if p_comentario is not null and trim(p_comentario) <> '' then
    insert into sgc.tarea_comentarios (tarea_id, usuario_id, comentario)
    values (p_id, auth.uid(), p_comentario);
  end if;
  return v_row;
end;
$function$;
grant execute on function sgc.actualizar_tarea_campos(uuid, text, text, uuid, date) to authenticated;

-- ── FASE 4.2 — proponer_cerrar_acuerdo ──────────────────────────────────────
-- Un acuerdo de reunión se "cierra" completando su tarea vinculada (tarea_id) —
-- el esquema no tiene un flag propio de "cumplido" en reunion_acuerdos.
create or replace function sgc.reunion_acuerdo_cerrar(p_acuerdo_id uuid)
returns sgc.tareas
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_tarea_id uuid;
  v_row sgc.tareas;
begin
  select tarea_id into v_tarea_id from sgc.reunion_acuerdos where id = p_acuerdo_id;
  if v_tarea_id is null then
    raise exception 'Este acuerdo no tiene una tarea vinculada que cerrar.' using errcode = '22023';
  end if;
  update sgc.tareas set estado = 'completada', fecha_completada = now()
   where id = v_tarea_id
  returning * into v_row;
  if not found then
    raise exception 'La tarea del acuerdo no se encontró o no tienes permiso.' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;
grant execute on function sgc.reunion_acuerdo_cerrar(uuid) to authenticated;

-- ── FASE 4.3 — proponer_decision_requisicion (aprobar, camino simple) ───────
-- Usa el artículo YA vinculado de cada renglón (coalesce articulo_despacho_id,
-- articulo_id) — sin fuzzy-matching nuevo. Renglones LIBRE sin vincular deben
-- resolverse en la app (RequisicionItemsMapper) antes de aprobar por aquí.
create or replace function sgc.aprobar_requisicion_simple(p_solicitud_id uuid, p_bodega_id uuid, p_observaciones text default null)
returns jsonb
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_items jsonb;
  v_nombre text;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', smi.id,
           'articulo_id', coalesce(smi.articulo_despacho_id, smi.articulo_id),
           'cantidad', smi.cantidad,
           'descripcion', smi.descripcion,
           'talla', smi.talla,
           'unidad', smi.unidad
         )), '[]'::jsonb)
    into v_items
    from sgc.solicitud_material_items smi
   where smi.solicitud_id = p_solicitud_id and coalesce(smi.estado, 'pendiente') = 'pendiente';

  select nombre into v_nombre from sgc.usuarios where id = auth.uid();

  return sgc.aprobar_requisicion(
    p_solicitud_id, p_bodega_id, current_date, coalesce(v_nombre, 'Claude'), p_observaciones, v_items, auth.uid()
  );
end;
$function$;
grant execute on function sgc.aprobar_requisicion_simple(uuid, uuid, text) to authenticated;

-- Un solo punto de entrada para el borrador "proponer_decision_requisicion" (el
-- mecanismo de confirmar un borrador llama UN RPC fijo — no puede elegir entre
-- dos según el valor de un parámetro). Delega en las 2 funciones ya existentes.
create or replace function sgc.decidir_requisicion(p_solicitud_id uuid, p_decision text, p_bodega_id uuid default null, p_notas text default null)
returns jsonb
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if p_decision = 'rechazar' then
    perform sgc.rechazar_solicitud_material(p_solicitud_id, p_notas);
    return jsonb_build_object('decision', 'rechazada', 'solicitud_id', p_solicitud_id);
  elsif p_decision = 'aprobar' then
    if p_bodega_id is null then
      raise exception 'Falta el almacén (bodega_id) para aprobar.' using errcode = '22023';
    end if;
    return sgc.aprobar_requisicion_simple(p_solicitud_id, p_bodega_id, p_notas) || jsonb_build_object('decision', 'aprobada');
  else
    raise exception 'La decisión debe ser "aprobar" o "rechazar".' using errcode = '22023';
  end if;
end;
$function$;
grant execute on function sgc.decidir_requisicion(uuid, text, uuid, text) to authenticated;

-- ── FASE 4.4 — proponer_decision_legal ──────────────────────────────────────
-- security invoker: misma RLS que ya gobierna "aprobaciones_legales: update"
-- (solo admin/módulo legal, solo mientras pendiente; el WITH CHECK ya exige
-- revisado_por = auth.uid()).
create or replace function sgc.resolver_aprobacion_legal(p_id uuid, p_estado text, p_comentario text default null)
returns sgc.aprobaciones_legales
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare v_row sgc.aprobaciones_legales;
begin
  if p_estado not in ('aprobado', 'rechazado') then
    raise exception 'Ese estado no es válido.' using errcode = '22023';
  end if;
  update sgc.aprobaciones_legales
     set estado = p_estado, revisado_por = auth.uid(), comentario_revisor = p_comentario, fecha_resolucion = now()
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Aprobación no encontrada, ya resuelta, o sin permiso.' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;
grant execute on function sgc.resolver_aprobacion_legal(uuid, text, text) to authenticated;

-- ── FASE 4.5 — proponer_actualizacion_expediente ────────────────────────────
-- security invoker: misma RLS que ya gobierna "expedientes_legales: update".
create or replace function sgc.actualizar_expediente_legal(
  p_id uuid, p_estado text default null, p_responsable_id uuid default null
)
returns sgc.expedientes_legales
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare v_row sgc.expedientes_legales;
begin
  update sgc.expedientes_legales set
    estado = coalesce(p_estado, estado),
    responsable_id = coalesce(p_responsable_id, responsable_id),
    fecha_cierre = case when p_estado = 'cerrado' then current_date else fecha_cierre end
  where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Expediente no encontrado o sin permiso.' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;
grant execute on function sgc.actualizar_expediente_legal(uuid, text, uuid) to authenticated;

-- ── FASE 4.6 — proponer_mensaje ──────────────────────────────────────────────
-- security invoker: crear_conversacion_directa (ya definer) resuelve/crea el DM;
-- el insert en sgc.mensajes pasa por su RLS normal (autor_id=auth.uid() + participante).
create or replace function sgc.enviar_mensaje_directo(p_destinatario_usuario_id uuid, p_contenido text)
returns sgc.mensajes
language plpgsql security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_conv_id uuid;
  v_row sgc.mensajes;
begin
  if coalesce(trim(p_contenido), '') = '' then
    raise exception 'El mensaje no puede estar vacío.' using errcode = '22023';
  end if;
  v_conv_id := sgc.crear_conversacion_directa(p_destinatario_usuario_id);
  insert into sgc.mensajes (conversacion_id, autor_id, contenido)
  values (v_conv_id, auth.uid(), p_contenido)
  returning * into v_row;
  return v_row;
end;
$function$;
grant execute on function sgc.enviar_mensaje_directo(uuid, text) to authenticated;

-- ── que_puedo_consultar — suma los módulos/herramientas de fases 3-4-5 ──────
-- Regla 19: cuerpo IDÉNTICO al vivo (sql/2026-10-24-cx2-conector-soporte-notas.sql),
-- + fila nueva 'admin_visibilidad' + 'dev_ops' + tools nuevos sumados a filas
-- ya existentes (tareas, reuniones, inventario, compras, flota, bitacora, legal,
-- mensajes, admin, tecnologia). `scripts/cobertura-conector.mjs` audita que este
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
      -- CY — proponer_mensaje se suma a mensajería (siempre, sin módulo).
      ('mensajes', 'Mensajería (siempre, sin módulo)', array['mis_mensajes','proponer_mensaje']),
      ('soporte', 'Soporte / mis reportes (siempre, sin módulo)', array['mis_reportes_soporte']),
      ('soporte_admin', 'Soporte — todos los reportes (solo admin/Tecnología)', array['listar_reportes_soporte','detalle_reporte_soporte','resumen_reportes_soporte','cambiar_estado_reporte','ver_gaps_registrados']),
      ('requisiciones', 'Requisiciones (siempre, sin módulo)', array['listar_requisiciones','requisiciones_pendientes','resumen_requisiciones_semana','resumen_estatus_requisiciones']),
      ('incentivos', 'Mi rendimiento (siempre, sin módulo)', array['mi_rendimiento']),
      -- CY — filas NUEVAS: visibilidad admin (conexiones del conector, envíos
      -- automáticos, reglas de alertas, importaciones) y dev/ops (errores).
      ('admin_visibilidad', 'Administración — conector, envíos y alertas (solo admin/Tecnología)', array['conexiones_claude','estado_envios_automaticos','reglas_de_alertas','historial_importaciones','proponer_cambio_envio_automatico','proponer_probar_envio']),
      ('dev_ops', 'Tecnología — errores y versiones (solo admin/Tecnología)', array['errores_recientes','proponer_nota_de_version'])
  )
  select m.modulo, m.etiqueta,
    (m.modulo in ('identidad','notas','mensajes','soporte','requisiciones','incentivos','tareas')
      or sgc.tiene_modulo(m.modulo) or sgc.is_admin()
      or (m.modulo = 'soporte_admin' and sgc.es_tecnologia())
      or (m.modulo in ('admin_visibilidad','dev_ops') and (sgc.is_admin() or sgc.es_tecnologia()))),
    m.herramientas
  from modulos m
  order by m.etiqueta;
$function$;
grant execute on function sgc.que_puedo_consultar() to authenticated;

commit;
