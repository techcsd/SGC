-- Reversa de DS-46 lote 8: restaura las expresiones originales de las politicas.

alter policy "obra_subcontratistas_all" on sgc.obra_subcontratistas
  using ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('obra'::text) OR sgc.tiene_modulo('proyectos'::text) OR sgc.puede_operar_submodulo('obra.subcontratistas'::text)));

alter policy "obra_subcontratistas_sel" on sgc.obra_subcontratistas
  using (sgc.puede_ver_submodulo('obra.subcontratistas'::text));

alter policy "obra_vac_all" on sgc.obra_vaciados
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)));

alter policy "odoo_comandos_oc_select" on sgc.odoo_comandos_oc
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "odoo_conc_corridas_sel" on sgc.odoo_conciliacion_corridas
  using (sgc.es_tecnologia());

alter policy "odoo_contingencias_sel" on sgc.odoo_contingencias
  using ((sgc.es_tecnologia() OR sgc.tiene_modulo('inventario'::text)));

alter policy "odoo_corte_sel" on sgc.odoo_corte_bodega
  using ((sgc.es_tecnologia() OR sgc.tiene_modulo('inventario'::text)));

alter policy "odoo_fases_sel" on sgc.odoo_fases
  using (sgc.es_tecnologia());

alter policy "odoo_homol_prop_leer" on sgc.odoo_homologacion_propuestas
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text) OR sgc.es_tecnologia()));

alter policy "odoo_producto_solicitudes_insert" on sgc.odoo_producto_solicitudes
  with check ((solicitado_por = auth.uid()));

alter policy "odoo_producto_solicitudes_select" on sgc.odoo_producto_solicitudes
  using (((solicitado_por = auth.uid()) OR sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "odoo_ratificaciones_sel" on sgc.odoo_ratificaciones
  using (sgc.es_tecnologia());

alter policy "odoo_ajuste_sel" on sgc.odoo_solicitudes_ajuste
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR sgc.es_tecnologia()));

alter policy "otros_avisos_sel" on sgc.otros_avisos
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.tiene_modulo('direccion'::text)));

alter policy "outbox_evidencia_dueno_ins" on sgc.outbox_atascado_evidencia
  with check ((subido_por = auth.uid()));

alter policy "outbox_evidencia_lee_tec" on sgc.outbox_atascado_evidencia
  using ((sgc.es_tecnologia() OR sgc.is_admin()));

alter policy "outbox_atascados_select_tec" on sgc.outbox_atascados
  using (sgc.es_tecnologia());

alter policy "outbox_atascados_update_tec" on sgc.outbox_atascados
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "revisor_solo_demo" on sgc.personal_obra_listados
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "plantillas_documento: delete" on sgc.plantillas_documento
  using ((sgc.is_admin() OR sgc.tiene_modulo('plantillas'::text)));

alter policy "plantillas_documento: insert" on sgc.plantillas_documento
  with check ((sgc.is_admin() OR sgc.tiene_modulo('plantillas'::text)));

alter policy "plantillas_documento: select" on sgc.plantillas_documento
  using ((sgc.is_admin() OR sgc.tiene_modulo('documentos'::text) OR sgc.tiene_modulo('plantillas'::text)));

alter policy "plantillas_documento: update" on sgc.plantillas_documento
  using ((sgc.is_admin() OR sgc.tiene_modulo('plantillas'::text)));

alter policy "plantilla_versiones: ver" on sgc.plantillas_documento_versiones
  using ((sgc.is_admin() OR sgc.tiene_modulo('plantillas'::text) OR sgc.tiene_modulo('legal'::text)));

alter policy "practica_intentos_sel" on sgc.practica_intentos
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text) OR (EXISTS ( SELECT 1
   FROM (sgc.empleados sub
     JOIN sgc.empleados jefe ON ((jefe.id = sub.jefe_id)))
  WHERE ((sub.usuario_id = practica_intentos.usuario_id) AND (jefe.usuario_id = auth.uid()))))));

alter policy "proveedor_import_log_ins" on sgc.proveedor_import_log
  with check (((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)) AND (importado_por = auth.uid())));

alter policy "proveedor_import_log_sel" on sgc.proveedor_import_log
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "revisor_solo_demo" on sgc.proveedores_transporte
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "proyecto_empleados: delete" on sgc.proyecto_empleados
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text)));

alter policy "proyecto_empleados: insert" on sgc.proyecto_empleados
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text)));

alter policy "proyecto_empleados: select" on sgc.proyecto_empleados
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('rrhh'::text) OR (EXISTS ( SELECT 1
   FROM sgc.empleados e
  WHERE ((e.id = proyecto_empleados.empleado_id) AND (e.usuario_id = auth.uid()))))));

alter policy "proyecto_empleados: update" on sgc.proyecto_empleados
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text)));

alter policy "proyecto_estructuras: read" on sgc.proyecto_estructuras
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)));

alter policy "proyecto_estructuras: write" on sgc.proyecto_estructuras
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text)));

alter policy "proyecto_odoo_analiticas_leer" on sgc.proyecto_odoo_analiticas
  using (sgc.is_admin());

alter policy "proyecto_partidas_all" on sgc.proyecto_partidas
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text)));

alter policy "proyecto_partidas_sel" on sgc.proyecto_partidas
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text) OR sgc.tiene_modulo('direccion'::text)));

alter policy "push_susc_web_select" on sgc.push_suscripciones_web
  using (((usuario_id = auth.uid()) OR sgc.es_tecnologia()));

alter policy "qa_cases_all" on sgc.qa_test_cases
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "qa_results_all" on sgc.qa_test_run_results
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "qa_runs_all" on sgc.qa_test_runs
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "recorrido_diario_read" on sgc.recorrido_diario
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_flota_elevado()));

alter policy "rc_hist_select" on sgc.registros_combustible_historial
  using ((sgc.es_flota_elevado() OR (EXISTS ( SELECT 1
   FROM (sgc.registros_combustible rc
     LEFT JOIN sgc.conductores c ON ((c.id = rc.conductor_id)))
  WHERE ((rc.id = registros_combustible_historial.registro_id) AND ((rc.registrado_por = auth.uid()) OR (c.usuario_id = auth.uid())))))));

alter policy "reportes_perdidas_all" on sgc.reportes_perdidas
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)));

alter policy "reportes_usuario: insert" on sgc.reportes_usuario
  with check ((usuario_id = auth.uid()));

alter policy "reportes_usuario: select" on sgc.reportes_usuario
  using (((usuario_id = auth.uid()) OR sgc.is_admin()));

alter policy "reportes_usuario: update" on sgc.reportes_usuario
  using (sgc.is_admin())
  with check (sgc.is_admin());

alter policy "reportes_fotos_select" on sgc.reportes_usuario_fotos
  using ((EXISTS ( SELECT 1
   FROM sgc.reportes_usuario r
  WHERE ((r.id = reportes_usuario_fotos.reporte_id) AND ((r.usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.tiene_modulo('admin'::text))))));

alter policy "reposicion_snooze: inventario" on sgc.reposicion_snooze
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "roe_select_tec" on sgc.resumen_operaciones_envio
  using ((sgc.es_tecnologia() OR sgc.is_admin()));

alter policy "retiros_prueba_oculta" on sgc.retiros_material
  using (((NOT es_prueba) OR sgc.is_admin()));

alter policy "retiros_select" on sgc.retiros_material
  using (((solicitante_id = auth.uid()) OR sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR sgc.tiene_modulo('compras'::text) OR sgc.tiene_modulo('direccion'::text) OR sgc.es_responsable_de_proyecto(proyecto_id)));

alter policy "revisor_solo_demo" on sgc.retiros_material
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "reunion_actas: escribir organizador" on sgc.reunion_actas
  using ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_actas.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_actas.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid()))))));

alter policy "reunion_notas: escribir la propia" on sgc.reunion_notas
  using ((usuario_id = auth.uid()))
  with check (((usuario_id = auth.uid()) AND sgc.puede_ver_reunion(reunion_id)));

alter policy "reunion_tipos: admin escribe" on sgc.reunion_tipos
  using (sgc.is_admin())
  with check (sgc.is_admin());

alter policy "reuniones: insert" on sgc.reuniones
  with check (((organizador_id = auth.uid()) AND sgc.tiene_modulo('reuniones'::text)));

alter policy "reuniones: update" on sgc.reuniones
  using ((sgc.is_admin() OR (organizador_id = auth.uid())))
  with check ((sgc.is_admin() OR (organizador_id = auth.uid())));
