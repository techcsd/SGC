-- DS-46 (#71) lote 7: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: gps_eventos, gps_ingesta_log, historial_activos, importaciones, importaciones_mapeo, incentivo_config, incentivo_envio, incentivo_informe_version, incentivo_participante_audit, informes_semanales, jira_adjuntos, jira_comentarios, jira_epicas, jira_historial, jira_issues, licencia_categorias, lugares_por_registrar, lugares_registrados, mantenimiento_adjuntos, mensajes, modulo_orden, monitored_domains, motivos_multa, movimiento_catalogo, nota_checklist_items, nota_compartidos, nota_grupos, notif_entregas, notif_pref_usuario, notif_regla, notif_regla_audit, obra_acciones_correctivas, obra_cubicacion_eventos, obra_cubicaciones, obra_elementos, obra_incidentes, obra_mano_obra, obra_no_conformidades, obra_pruebas_campo, obra_subcontratista_frentes. Semantica identica; reversa en sql/_reversa/.

alter policy "gps_eventos: read" on sgc.gps_eventos
  using (((usuario_id = (select auth.uid())) OR (select sgc.es_flota_elevado()) OR (select sgc.es_tecnologia())));

alter policy "gps_ingesta_log_read" on sgc.gps_ingesta_log
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_flota_elevado()) OR (select sgc.es_tecnologia())));

alter policy "revisor_solo_demo" on sgc.gps_ingesta_log
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "historial_activos_insert" on sgc.historial_activos
  with check ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "historial_activos_select" on sgc.historial_activos
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('gerencia'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "importaciones_sel" on sgc.importaciones
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "importaciones_mapeo_rw" on sgc.importaciones_mapeo
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "incentivo_config: select" on sgc.incentivo_config
  using ((select sgc.puede_gestionar_incentivos()));

alter policy "incentivo_envio: select" on sgc.incentivo_envio
  using ((select sgc.puede_gestionar_incentivos()));

alter policy "incentivo_informe_version_sel" on sgc.incentivo_informe_version
  using (((select sgc.is_admin()) OR (select sgc.puede_gestionar_incentivos())));

alter policy "incentivo_part_audit_sel" on sgc.incentivo_participante_audit
  using (((select sgc.is_admin()) OR (select sgc.puede_gestionar_incentivos())));

alter policy "informes_semanales_all" on sgc.informes_semanales
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_ver_submodulo('obra.informes'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.informes'::text))));

alter policy "jira: tecnologia lee" on sgc.jira_adjuntos
  using ((select sgc.es_tecnologia()));

alter policy "jira: tecnologia lee" on sgc.jira_comentarios
  using ((select sgc.es_tecnologia()));

alter policy "jira: tecnologia lee" on sgc.jira_epicas
  using ((select sgc.es_tecnologia()));

alter policy "jira: tecnologia lee" on sgc.jira_historial
  using ((select sgc.es_tecnologia()));

alter policy "jira: tecnologia lee" on sgc.jira_issues
  using ((select sgc.es_tecnologia()));

alter policy "licencia_categorias_write" on sgc.licencia_categorias
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "revisor_solo_demo" on sgc.lugares_por_registrar
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "revisor_solo_demo" on sgc.lugares_registrados
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "mantenimiento_adjuntos_select" on sgc.mantenimiento_adjuntos
  using ((EXISTS ( SELECT 1
   FROM sgc.mantenimientos m
  WHERE ((m.id = mantenimiento_adjuntos.mantenimiento_id) AND (sgc.puede_ver_vehiculo(m.vehiculo_id, (select auth.uid())) OR ((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])))))));

alter policy "mantenimiento_adjuntos_write" on sgc.mantenimiento_adjuntos
  using ((EXISTS ( SELECT 1
   FROM sgc.mantenimientos m
  WHERE ((m.id = mantenimiento_adjuntos.mantenimiento_id) AND ((select sgc.is_admin()) OR (select sgc.es_flota_elevado()) OR sgc.puede_ver_vehiculo(m.vehiculo_id, (select auth.uid())) OR ((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = 'operar'::text))))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.mantenimientos m
  WHERE ((m.id = mantenimiento_adjuntos.mantenimiento_id) AND ((select sgc.is_admin()) OR (select sgc.es_flota_elevado()) OR sgc.puede_ver_vehiculo(m.vehiculo_id, (select auth.uid())) OR ((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = 'operar'::text))))));

alter policy "mensajes: insert" on sgc.mensajes
  with check (((autor_id = (select auth.uid())) AND sgc.es_participante(conversacion_id)));

alter policy "modulo_orden_all" on sgc.modulo_orden
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "monitored_domains: tecnologia" on sgc.monitored_domains
  using ((select sgc.es_tecnologia()))
  with check ((select sgc.es_tecnologia()));

alter policy "motivos_multa: admin" on sgc.motivos_multa
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())))
  with check (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "movimiento_catalogo_sel" on sgc.movimiento_catalogo
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "nci_del" on sgc.nota_checklist_items
  using (sgc.puede_editar_nota(nota_id, (select auth.uid())));

alter policy "nci_ins" on sgc.nota_checklist_items
  with check (sgc.puede_editar_nota(nota_id, (select auth.uid())));

alter policy "nci_sel" on sgc.nota_checklist_items
  using (sgc.puede_ver_nota(nota_id, (select auth.uid())));

alter policy "nci_upd" on sgc.nota_checklist_items
  using (sgc.puede_editar_nota(nota_id, (select auth.uid())))
  with check (sgc.puede_editar_nota(nota_id, (select auth.uid())));

alter policy "nota_comp_del" on sgc.nota_compartidos
  using (sgc.es_owner_nota(nota_id, (select auth.uid())));

alter policy "nota_comp_ins" on sgc.nota_compartidos
  with check (sgc.es_owner_nota(nota_id, (select auth.uid())));

alter policy "nota_comp_sel" on sgc.nota_compartidos
  using (((usuario_id = (select auth.uid())) OR sgc.es_owner_nota(nota_id, (select auth.uid()))));

alter policy "nota_comp_upd" on sgc.nota_compartidos
  using (sgc.es_owner_nota(nota_id, (select auth.uid())))
  with check (sgc.es_owner_nota(nota_id, (select auth.uid())));

alter policy "nota_grupos_del" on sgc.nota_grupos
  using ((usuario_id = (select auth.uid())));

alter policy "nota_grupos_ins" on sgc.nota_grupos
  with check ((usuario_id = (select auth.uid())));

alter policy "nota_grupos_sel" on sgc.nota_grupos
  using ((usuario_id = (select auth.uid())));

alter policy "nota_grupos_upd" on sgc.nota_grupos
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "notif_entregas_sel" on sgc.notif_entregas
  using ((select sgc.is_admin()));

alter policy "notif_pref_own" on sgc.notif_pref_usuario
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "notif_regla_sel" on sgc.notif_regla
  using ((select sgc.is_admin()));

alter policy "notif_regla_audit: admin" on sgc.notif_regla_audit
  using ((select sgc.is_admin()));

alter policy "obra_acciones_correctivas_all" on sgc.obra_acciones_correctivas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.no_conformidades'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.no_conformidades'::text))));

alter policy "obra_acciones_correctivas_sub_sel" on sgc.obra_acciones_correctivas
  using ((select sgc.puede_ver_submodulo('obra.no_conformidades'::text)));

alter policy "obra_cubicacion_eventos_all" on sgc.obra_cubicacion_eventos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))));

alter policy "obra_cubicacion_eventos_sel" on sgc.obra_cubicacion_eventos
  using ((select sgc.puede_ver_submodulo('obra.subcontratistas'::text)));

alter policy "obra_cubicaciones_all" on sgc.obra_cubicaciones
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))));

alter policy "obra_cubicaciones_sel" on sgc.obra_cubicaciones
  using ((select sgc.puede_ver_submodulo('obra.subcontratistas'::text)));

alter policy "obra_elem_all" on sgc.obra_elementos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "obra_incidentes_all" on sgc.obra_incidentes
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.no_conformidades'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.no_conformidades'::text))));

alter policy "obra_incidentes_sub_sel" on sgc.obra_incidentes
  using ((select sgc.puede_ver_submodulo('obra.no_conformidades'::text)));

alter policy "obra_mano_obra_all" on sgc.obra_mano_obra
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))));

alter policy "obra_mano_obra_sel" on sgc.obra_mano_obra
  using ((select sgc.puede_ver_submodulo('obra.avance'::text)));

alter policy "obra_nc_all" on sgc.obra_no_conformidades
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.no_conformidades'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.no_conformidades'::text))));

alter policy "obra_nc_sub_sel" on sgc.obra_no_conformidades
  using ((select sgc.puede_ver_submodulo('obra.no_conformidades'::text)));

alter policy "obra_pruebas_campo_all" on sgc.obra_pruebas_campo
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))));

alter policy "obra_pruebas_campo_sel" on sgc.obra_pruebas_campo
  using ((select sgc.puede_ver_submodulo('obra.avance'::text)));

alter policy "obra_subcontratista_frentes_all" on sgc.obra_subcontratista_frentes
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))));

alter policy "obra_subcontratista_frentes_sel" on sgc.obra_subcontratista_frentes
  using ((select sgc.puede_ver_submodulo('obra.subcontratistas'::text)));
