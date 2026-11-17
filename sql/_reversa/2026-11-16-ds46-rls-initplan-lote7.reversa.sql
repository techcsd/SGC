-- Reversa de DS-46 lote 7: restaura las expresiones originales de las politicas.

alter policy "gps_eventos: read" on sgc.gps_eventos
  using (((usuario_id = auth.uid()) OR sgc.es_flota_elevado() OR sgc.es_tecnologia()));

alter policy "gps_ingesta_log_read" on sgc.gps_ingesta_log
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_flota_elevado() OR sgc.es_tecnologia()));

alter policy "revisor_solo_demo" on sgc.gps_ingesta_log
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "historial_activos_insert" on sgc.historial_activos
  with check ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles()))));

alter policy "historial_activos_select" on sgc.historial_activos
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles())) OR ('gerencia'::text = ANY (sgc.get_user_roles()))));

alter policy "importaciones_sel" on sgc.importaciones
  using ((sgc.is_admin() OR sgc.es_flota_elevado() OR sgc.tiene_modulo('inventario'::text)));

alter policy "importaciones_mapeo_rw" on sgc.importaciones_mapeo
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "incentivo_config: select" on sgc.incentivo_config
  using (sgc.puede_gestionar_incentivos());

alter policy "incentivo_envio: select" on sgc.incentivo_envio
  using (sgc.puede_gestionar_incentivos());

alter policy "incentivo_informe_version_sel" on sgc.incentivo_informe_version
  using ((sgc.is_admin() OR sgc.puede_gestionar_incentivos()));

alter policy "incentivo_part_audit_sel" on sgc.incentivo_participante_audit
  using ((sgc.is_admin() OR sgc.puede_gestionar_incentivos()));

alter policy "informes_semanales_all" on sgc.informes_semanales
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_ver_submodulo('obra.informes'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.informes'::text)));

alter policy "jira: tecnologia lee" on sgc.jira_adjuntos
  using (sgc.es_tecnologia());

alter policy "jira: tecnologia lee" on sgc.jira_comentarios
  using (sgc.es_tecnologia());

alter policy "jira: tecnologia lee" on sgc.jira_epicas
  using (sgc.es_tecnologia());

alter policy "jira: tecnologia lee" on sgc.jira_historial
  using (sgc.es_tecnologia());

alter policy "jira: tecnologia lee" on sgc.jira_issues
  using (sgc.es_tecnologia());

alter policy "licencia_categorias_write" on sgc.licencia_categorias
  using (sgc.is_admin())
  with check (sgc.is_admin());

alter policy "revisor_solo_demo" on sgc.lugares_por_registrar
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "revisor_solo_demo" on sgc.lugares_registrados
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "mantenimiento_adjuntos_select" on sgc.mantenimiento_adjuntos
  using ((EXISTS ( SELECT 1
   FROM sgc.mantenimientos m
  WHERE ((m.id = mantenimiento_adjuntos.mantenimiento_id) AND (sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid()) OR (sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = ANY (ARRAY['ver'::text, 'operar'::text])))))));

alter policy "mantenimiento_adjuntos_write" on sgc.mantenimiento_adjuntos
  using ((EXISTS ( SELECT 1
   FROM sgc.mantenimientos m
  WHERE ((m.id = mantenimiento_adjuntos.mantenimiento_id) AND (sgc.is_admin() OR sgc.es_flota_elevado() OR sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid()) OR (sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = 'operar'::text))))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.mantenimientos m
  WHERE ((m.id = mantenimiento_adjuntos.mantenimiento_id) AND (sgc.is_admin() OR sgc.es_flota_elevado() OR sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid()) OR (sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = 'operar'::text))))));

alter policy "mensajes: insert" on sgc.mensajes
  with check (((autor_id = auth.uid()) AND sgc.es_participante(conversacion_id)));

alter policy "modulo_orden_all" on sgc.modulo_orden
  using (sgc.is_admin())
  with check (sgc.is_admin());

alter policy "monitored_domains: tecnologia" on sgc.monitored_domains
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "motivos_multa: admin" on sgc.motivos_multa
  using ((sgc.is_admin() OR sgc.es_flota_elevado()))
  with check ((sgc.is_admin() OR sgc.es_flota_elevado()));

alter policy "movimiento_catalogo_sel" on sgc.movimiento_catalogo
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "nci_del" on sgc.nota_checklist_items
  using (sgc.puede_editar_nota(nota_id, auth.uid()));

alter policy "nci_ins" on sgc.nota_checklist_items
  with check (sgc.puede_editar_nota(nota_id, auth.uid()));

alter policy "nci_sel" on sgc.nota_checklist_items
  using (sgc.puede_ver_nota(nota_id, auth.uid()));

alter policy "nci_upd" on sgc.nota_checklist_items
  using (sgc.puede_editar_nota(nota_id, auth.uid()))
  with check (sgc.puede_editar_nota(nota_id, auth.uid()));

alter policy "nota_comp_del" on sgc.nota_compartidos
  using (sgc.es_owner_nota(nota_id, auth.uid()));

alter policy "nota_comp_ins" on sgc.nota_compartidos
  with check (sgc.es_owner_nota(nota_id, auth.uid()));

alter policy "nota_comp_sel" on sgc.nota_compartidos
  using (((usuario_id = auth.uid()) OR sgc.es_owner_nota(nota_id, auth.uid())));

alter policy "nota_comp_upd" on sgc.nota_compartidos
  using (sgc.es_owner_nota(nota_id, auth.uid()))
  with check (sgc.es_owner_nota(nota_id, auth.uid()));

alter policy "nota_grupos_del" on sgc.nota_grupos
  using ((usuario_id = auth.uid()));

alter policy "nota_grupos_ins" on sgc.nota_grupos
  with check ((usuario_id = auth.uid()));

alter policy "nota_grupos_sel" on sgc.nota_grupos
  using ((usuario_id = auth.uid()));

alter policy "nota_grupos_upd" on sgc.nota_grupos
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "notif_entregas_sel" on sgc.notif_entregas
  using (sgc.is_admin());

alter policy "notif_pref_own" on sgc.notif_pref_usuario
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "notif_regla_sel" on sgc.notif_regla
  using (sgc.is_admin());

alter policy "notif_regla_audit: admin" on sgc.notif_regla_audit
  using (sgc.is_admin());

alter policy "obra_acciones_correctivas_all" on sgc.obra_acciones_correctivas
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.no_conformidades'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.no_conformidades'::text)));

alter policy "obra_acciones_correctivas_sub_sel" on sgc.obra_acciones_correctivas
  using (sgc.puede_ver_submodulo('obra.no_conformidades'::text));

alter policy "obra_cubicacion_eventos_all" on sgc.obra_cubicacion_eventos
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)));

alter policy "obra_cubicacion_eventos_sel" on sgc.obra_cubicacion_eventos
  using (sgc.puede_ver_submodulo('obra.subcontratistas'::text));

alter policy "obra_cubicaciones_all" on sgc.obra_cubicaciones
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)));

alter policy "obra_cubicaciones_sel" on sgc.obra_cubicaciones
  using (sgc.puede_ver_submodulo('obra.subcontratistas'::text));

alter policy "obra_elem_all" on sgc.obra_elementos
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)));

alter policy "obra_incidentes_all" on sgc.obra_incidentes
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.no_conformidades'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.no_conformidades'::text)));

alter policy "obra_incidentes_sub_sel" on sgc.obra_incidentes
  using (sgc.puede_ver_submodulo('obra.no_conformidades'::text));

alter policy "obra_mano_obra_all" on sgc.obra_mano_obra
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.avance'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.avance'::text)));

alter policy "obra_mano_obra_sel" on sgc.obra_mano_obra
  using (sgc.puede_ver_submodulo('obra.avance'::text));

alter policy "obra_nc_all" on sgc.obra_no_conformidades
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.no_conformidades'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.no_conformidades'::text)));

alter policy "obra_nc_sub_sel" on sgc.obra_no_conformidades
  using (sgc.puede_ver_submodulo('obra.no_conformidades'::text));

alter policy "obra_pruebas_campo_all" on sgc.obra_pruebas_campo
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.avance'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.avance'::text)));

alter policy "obra_pruebas_campo_sel" on sgc.obra_pruebas_campo
  using (sgc.puede_ver_submodulo('obra.avance'::text));

alter policy "obra_subcontratista_frentes_all" on sgc.obra_subcontratista_frentes
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)));

alter policy "obra_subcontratista_frentes_sel" on sgc.obra_subcontratista_frentes
  using (sgc.puede_ver_submodulo('obra.subcontratistas'::text));
