-- DM4b (ronda DM) — añade 'claude_skills' (apagado por ahora) a
-- que_puedo_consultar(). Copia verbatim del cuerpo vivo (sql/2026-11-10-dl-f7b-…)
-- + 1 fila nueva, sin módulo (visible siempre, el apagador vive en las RPC).
begin;
set local search_path = sgc, public;

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
      ('tecnologia_inventario', 'Inventario tecnológico (equipos de TI)', array['resumen_inventario_tecnologico','listar_equipos_tecnologicos','detalle_equipo_tecnologico','listar_tipos_equipo','proponer_tipo_equipo','proponer_equipo_tecnologico','proponer_cambio_estado_equipo','proponer_asignacion_equipo','proponer_equipos_tecnologicos_lote']),
      ('wa_grupos', 'Grupos de WhatsApp (memoria IA)', array['listar_grupos_whatsapp','buscar_en_grupos_whatsapp','hallazgos_whatsapp','resumen_grupo_whatsapp']),
      ('wa_mis_pendientes', 'Mis pendientes de grupos de WhatsApp (siempre, sin módulo)', array['mis_pendientes_de_grupos']),
      -- DM4 — siempre visible (el apagador vive en las RPC, no aquí); la
      -- descripción de cada tool ya avisa "[Apagado por ahora]".
      ('claude_skills', 'Skills de Claude por conector (DESACTIVADO hasta que Tecnología lo encienda)', array['mis_skills_claude','leer_skill_claude'])
  )
  select m.modulo, m.etiqueta,
    (m.modulo in ('identidad','notas','mensajes','soporte','requisiciones','incentivos','tareas','wa_mis_pendientes','claude_skills')
      or sgc.tiene_modulo(m.modulo) or sgc.is_admin()
      or (m.modulo = 'soporte_admin' and sgc.es_tecnologia())
      or (m.modulo in ('admin_visibilidad','dev_ops') and (sgc.is_admin() or sgc.es_tecnologia()))
      or (m.modulo = 'tecnologia_inventario' and (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_ver_submodulo('tecnologia.inventario')))
      or (m.modulo = 'wa_grupos' and sgc.puede_ver_submodulo('tecnologia.wa_grupos'))),
    m.herramientas
  from modulos m
  order by m.etiqueta;
$function$;
grant execute on function sgc.que_puedo_consultar() to authenticated;

commit;
