-- Reversa de DS-46 lote 5: restaura las expresiones originales de las politicas.

alter policy "agentes: ver" on sgc.agentes
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "alertas_cuadre_sel" on sgc.alertas_cuadre
  using ((sgc.is_admin() OR sgc.tiene_modulo('direccion'::text)));

alter policy "alertas_cuadre_upd" on sgc.alertas_cuadre
  using ((sgc.is_admin() OR sgc.tiene_modulo('direccion'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('direccion'::text)));

alter policy "alerts: read tecnologia" on sgc.alerts
  using (sgc.es_tecnologia());

alter policy "api_serv_select" on sgc.api_servicios
  using (sgc.es_tecnologia());

alter policy "api_serv_write" on sgc.api_servicios
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "aee_select" on sgc.app_error_estados
  using (sgc.es_tecnologia());

alter policy "aprobaciones_legales: insert" on sgc.aprobaciones_legales
  with check ((solicitado_por = auth.uid()));

alter policy "aprobaciones_legales: select" on sgc.aprobaciones_legales
  using ((sgc.is_admin() OR sgc.tiene_modulo('legal'::text) OR (solicitado_por = auth.uid())));

alter policy "aprobaciones_legales: update" on sgc.aprobaciones_legales
  using (((sgc.is_admin() OR sgc.tiene_modulo('legal'::text)) AND (estado = 'pendiente'::text)))
  with check (((revisado_por = auth.uid()) AND (estado = ANY (ARRAY['aprobado'::text, 'rechazado'::text]))));

alter policy "asistencia: delete" on sgc.asistencia
  using ((sgc.is_admin() OR sgc.puede_operar_submodulo('rrhh.asistencia'::text)));

alter policy "asistencia: insert" on sgc.asistencia
  with check ((sgc.is_admin() OR sgc.puede_operar_submodulo('rrhh.asistencia'::text)));

alter policy "asistencia: select" on sgc.asistencia
  using ((sgc.is_admin() OR sgc.puede_ver_submodulo('rrhh.asistencia'::text)));

alter policy "asistencia: update" on sgc.asistencia
  using ((sgc.is_admin() OR sgc.puede_operar_submodulo('rrhh.asistencia'::text)))
  with check ((sgc.is_admin() OR sgc.puede_operar_submodulo('rrhh.asistencia'::text)));

alter policy "assistant_compartidas: insert" on sgc.assistant_compartidas
  with check (((compartida_por = auth.uid()) AND (EXISTS ( SELECT 1
   FROM sgc.assistant_conversaciones c
  WHERE ((c.id = assistant_compartidas.conversacion_id) AND (c.usuario_id = auth.uid()))))));

alter policy "assistant_compartidas: select" on sgc.assistant_compartidas
  using (((compartida_con = auth.uid()) OR (compartida_por = auth.uid()) OR sgc.is_admin()));

alter policy "assistant_compartidas: update propia" on sgc.assistant_compartidas
  using ((compartida_con = auth.uid()))
  with check ((compartida_con = auth.uid()));

alter policy "cna_select_tec" on sgc.assistant_consultas_no_atendidas
  using (sgc.es_tecnologia());

alter policy "cna_update_tec" on sgc.assistant_consultas_no_atendidas
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "assistant_idem_own" on sgc.assistant_idempotencia
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "assistant_memory_rw" on sgc.assistant_memory
  using (((usuario_id = auth.uid()) OR sgc.is_admin()))
  with check (((usuario_id = auth.uid()) OR sgc.is_admin()));

alter policy "audit_log: admin insert" on sgc.audit_log
  with check (sgc.is_admin());

alter policy "audit_log: admin select" on sgc.audit_log
  using (sgc.is_admin());

alter policy "avisos_proyecto_all" on sgc.avisos_proyecto
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('direccion'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('direccion'::text)));

alter policy "avisos_proyecto_sel" on sgc.avisos_proyecto
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('direccion'::text)));

alter policy "ayuda_feedback_admin_sel" on sgc.ayuda_feedback
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "ayuda_feedback_propio_sel" on sgc.ayuda_feedback
  using ((usuario_id = auth.uid()));

alter policy "bitacora_danos: select" on sgc.bitacora_danos
  using ((sgc.puede_ver_bitacora(bitacora_id) AND ((NOT es_prueba) OR sgc.is_admin())));

alter policy "revisor_solo_demo" on sgc.bitacora_danos
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "bitacora_ia_propuestas: select" on sgc.bitacora_ia_propuestas
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_tecnologia() OR sgc.puede_ver_bitacora_de(proyecto_id)));

alter policy "bitacora_ia_propuestas: update propia" on sgc.bitacora_ia_propuestas
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "bitacora_moldes: select" on sgc.bitacora_molde_medidas
  using ((sgc.puede_ver_bitacora(bitacora_id) AND ((NOT es_prueba) OR sgc.is_admin())));

alter policy "revisor_solo_demo" on sgc.bitacora_molde_medidas
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "revisor_solo_demo" on sgc.bitacora_orden_detalle
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "boveda_entradas_sel" on sgc.boveda_entradas
  using (sgc.puede_ver_vault());

alter policy "cargos: escritura" on sgc.cargos
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('rrhh'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('rrhh'::text)));

alter policy "cat_fig_ins" on sgc.cartilla_figuras
  with check (sgc.is_admin());

alter policy "cat_fig_upd" on sgc.cartilla_figuras
  using (sgc.is_admin())
  with check (sgc.is_admin());

alter policy "revisor_solo_demo" on sgc.cartillas
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "charlas_seguridad_all" on sgc.charlas_seguridad
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_ver_submodulo('obra.plan_dia'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.plan_dia'::text)));

alter policy "chk_plant_all" on sgc.checklist_plantillas
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "chk_plant_sel" on sgc.checklist_plantillas
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "chofer_estado: read" on sgc.chofer_estado
  using (((usuario_id = auth.uid()) OR sgc.es_flota_elevado()));

alter policy "chofer_estado_hist: read" on sgc.chofer_estado_historial
  using (((usuario_id = auth.uid()) OR sgc.es_flota_elevado()));

alter policy "chofer_posiciones: read" on sgc.chofer_posiciones
  using (((usuario_id = auth.uid()) OR sgc.es_flota_elevado() OR sgc.es_tecnologia()));

alter policy "revisor_solo_demo" on sgc.chofer_posiciones
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "chofer_ultima_posicion: read" on sgc.chofer_ultima_posicion
  using (((usuario_id = auth.uid()) OR sgc.es_flota_elevado() OR sgc.es_tecnologia()));

alter policy "cl_plantillas_all" on sgc.cl_plantillas
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)));

alter policy "cl_plantillas_obra" on sgc.cl_plantillas
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_ver_submodulo('obra.checklists'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.checklists'::text)));

alter policy "cl_registros_all" on sgc.cl_registros
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)));

alter policy "cl_registros_obra" on sgc.cl_registros
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_ver_submodulo('obra.checklists'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.puede_operar_submodulo('obra.checklists'::text)));

alter policy "claude_borradores_rw" on sgc.claude_borradores
  using (((usuario_id = auth.uid()) OR sgc.is_admin()))
  with check ((usuario_id = auth.uid()));

alter policy "claude_encuesta: responder lo mío" on sgc.claude_encuesta_respuestas
  using (((usuario_id = auth.uid()) OR sgc.puede_ver_submodulo('tecnologia.claude_auditoria'::text)))
  with check ((usuario_id = auth.uid()));

alter policy "claude_llamadas_ins" on sgc.claude_llamadas
  with check ((usuario_id = auth.uid()));

alter policy "claude_llamadas_sel" on sgc.claude_llamadas
  using (((usuario_id = auth.uid()) OR sgc.is_admin()));

alter policy "claude_org_info: editar" on sgc.claude_org_info
  using (sgc.puede_operar_submodulo('tecnologia.claude_administrar'::text))
  with check (sgc.puede_operar_submodulo('tecnologia.claude_administrar'::text));

alter policy "claude_progreso: lo mío" on sgc.claude_progreso
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "claude_skills: crear propia" on sgc.claude_skills
  with check ((owner_id = auth.uid()));

alter policy "claude_skills: editar lo mío" on sgc.claude_skills
  using (((owner_id = auth.uid()) OR sgc.puede_operar_submodulo('tecnologia.claude_administrar'::text)))
  with check (((owner_id = auth.uid()) OR sgc.puede_operar_submodulo('tecnologia.claude_administrar'::text)));

alter policy "comb_facturas_sel" on sgc.combustible_facturas
  using ((sgc.is_admin() OR sgc.es_flota_elevado()));

alter policy "comb_retro_sel" on sgc.combustible_permisos_retro
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_flota_elevado()));

alter policy "cupo_solicitudes: ver" on sgc.combustible_solicitudes_cupo
  using (((solicitante_id = auth.uid()) OR sgc.es_flota_elevado()));

alter policy "cupo_alertas: ver" on sgc.combustible_tarjeta_alertas
  using (sgc.es_flota_elevado());
