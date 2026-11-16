-- DS-46 (#71) lote 8: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: obra_subcontratistas, obra_vaciados, odoo_comandos_oc, odoo_conciliacion_corridas, odoo_contingencias, odoo_corte_bodega, odoo_fases, odoo_homologacion_propuestas, odoo_producto_solicitudes, odoo_ratificaciones, odoo_solicitudes_ajuste, otros_avisos, outbox_atascado_evidencia, outbox_atascados, personal_obra_listados, plantillas_documento, plantillas_documento_versiones, practica_intentos, proveedor_import_log, proveedores_transporte, proyecto_empleados, proyecto_estructuras, proyecto_odoo_analiticas, proyecto_partidas, push_suscripciones_web, qa_test_cases, qa_test_run_results, qa_test_runs, recorrido_diario, registros_combustible_historial, reportes_perdidas, reportes_usuario, reportes_usuario_fotos, reposicion_snooze, resumen_operaciones_envio, retiros_material, reunion_actas, reunion_notas, reunion_tipos, reuniones. Semantica identica; reversa en sql/_reversa/.

alter policy "obra_subcontratistas_all" on sgc.obra_subcontratistas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.subcontratistas'::text))));

alter policy "obra_subcontratistas_sel" on sgc.obra_subcontratistas
  using ((select sgc.puede_ver_submodulo('obra.subcontratistas'::text)));

alter policy "obra_vac_all" on sgc.obra_vaciados
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "odoo_comandos_oc_select" on sgc.odoo_comandos_oc
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "odoo_conc_corridas_sel" on sgc.odoo_conciliacion_corridas
  using ((select sgc.es_tecnologia()));

alter policy "odoo_contingencias_sel" on sgc.odoo_contingencias
  using (((select sgc.es_tecnologia()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "odoo_corte_sel" on sgc.odoo_corte_bodega
  using (((select sgc.es_tecnologia()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "odoo_fases_sel" on sgc.odoo_fases
  using ((select sgc.es_tecnologia()));

alter policy "odoo_homol_prop_leer" on sgc.odoo_homologacion_propuestas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.es_tecnologia())));

alter policy "odoo_producto_solicitudes_insert" on sgc.odoo_producto_solicitudes
  with check ((solicitado_por = (select auth.uid())));

alter policy "odoo_producto_solicitudes_select" on sgc.odoo_producto_solicitudes
  using (((solicitado_por = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "odoo_ratificaciones_sel" on sgc.odoo_ratificaciones
  using ((select sgc.es_tecnologia()));

alter policy "odoo_ajuste_sel" on sgc.odoo_solicitudes_ajuste
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR (select sgc.es_tecnologia())));

alter policy "otros_avisos_sel" on sgc.otros_avisos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "outbox_evidencia_dueno_ins" on sgc.outbox_atascado_evidencia
  with check ((subido_por = (select auth.uid())));

alter policy "outbox_evidencia_lee_tec" on sgc.outbox_atascado_evidencia
  using (((select sgc.es_tecnologia()) OR (select sgc.is_admin())));

alter policy "outbox_atascados_select_tec" on sgc.outbox_atascados
  using ((select sgc.es_tecnologia()));

alter policy "outbox_atascados_update_tec" on sgc.outbox_atascados
  using ((select sgc.es_tecnologia()))
  with check ((select sgc.es_tecnologia()));

alter policy "revisor_solo_demo" on sgc.personal_obra_listados
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "plantillas_documento: delete" on sgc.plantillas_documento
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('plantillas'::text))));

alter policy "plantillas_documento: insert" on sgc.plantillas_documento
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('plantillas'::text))));

alter policy "plantillas_documento: select" on sgc.plantillas_documento
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('documentos'::text)) OR (select sgc.tiene_modulo('plantillas'::text))));

alter policy "plantillas_documento: update" on sgc.plantillas_documento
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('plantillas'::text))));

alter policy "plantilla_versiones: ver" on sgc.plantillas_documento_versiones
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('plantillas'::text)) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "practica_intentos_sel" on sgc.practica_intentos
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text)) OR (EXISTS ( SELECT 1
   FROM (sgc.empleados sub
     JOIN sgc.empleados jefe ON ((jefe.id = sub.jefe_id)))
  WHERE ((sub.usuario_id = practica_intentos.usuario_id) AND (jefe.usuario_id = (select auth.uid())))))));

alter policy "proveedor_import_log_ins" on sgc.proveedor_import_log
  with check ((((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))) AND (importado_por = (select auth.uid()))));

alter policy "proveedor_import_log_sel" on sgc.proveedor_import_log
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "revisor_solo_demo" on sgc.proveedores_transporte
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "proyecto_empleados: delete" on sgc.proyecto_empleados
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "proyecto_empleados: insert" on sgc.proyecto_empleados
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "proyecto_empleados: select" on sgc.proyecto_empleados
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('rrhh'::text)) OR (EXISTS ( SELECT 1
   FROM sgc.empleados e
  WHERE ((e.id = proyecto_empleados.empleado_id) AND (e.usuario_id = (select auth.uid())))))));

alter policy "proyecto_empleados: update" on sgc.proyecto_empleados
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "proyecto_estructuras: read" on sgc.proyecto_estructuras
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "proyecto_estructuras: write" on sgc.proyecto_estructuras
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "proyecto_odoo_analiticas_leer" on sgc.proyecto_odoo_analiticas
  using ((select sgc.is_admin()));

alter policy "proyecto_partidas_all" on sgc.proyecto_partidas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "proyecto_partidas_sel" on sgc.proyecto_partidas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "push_susc_web_select" on sgc.push_suscripciones_web
  using (((usuario_id = (select auth.uid())) OR (select sgc.es_tecnologia())));

alter policy "qa_cases_all" on sgc.qa_test_cases
  using ((select sgc.es_tecnologia()))
  with check ((select sgc.es_tecnologia()));

alter policy "qa_results_all" on sgc.qa_test_run_results
  using ((select sgc.es_tecnologia()))
  with check ((select sgc.es_tecnologia()));

alter policy "qa_runs_all" on sgc.qa_test_runs
  using ((select sgc.es_tecnologia()))
  with check ((select sgc.es_tecnologia()));

alter policy "recorrido_diario_read" on sgc.recorrido_diario
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "rc_hist_select" on sgc.registros_combustible_historial
  using (((select sgc.es_flota_elevado()) OR (EXISTS ( SELECT 1
   FROM (sgc.registros_combustible rc
     LEFT JOIN sgc.conductores c ON ((c.id = rc.conductor_id)))
  WHERE ((rc.id = registros_combustible_historial.registro_id) AND ((rc.registrado_por = (select auth.uid())) OR (c.usuario_id = (select auth.uid()))))))));

alter policy "reportes_perdidas_all" on sgc.reportes_perdidas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "reportes_usuario: insert" on sgc.reportes_usuario
  with check ((usuario_id = (select auth.uid())));

alter policy "reportes_usuario: select" on sgc.reportes_usuario
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())));

alter policy "reportes_usuario: update" on sgc.reportes_usuario
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "reportes_fotos_select" on sgc.reportes_usuario_fotos
  using ((EXISTS ( SELECT 1
   FROM sgc.reportes_usuario r
  WHERE ((r.id = reportes_usuario_fotos.reporte_id) AND ((r.usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('admin'::text)))))));

alter policy "reposicion_snooze: inventario" on sgc.reposicion_snooze
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "roe_select_tec" on sgc.resumen_operaciones_envio
  using (((select sgc.es_tecnologia()) OR (select sgc.is_admin())));

alter policy "retiros_prueba_oculta" on sgc.retiros_material
  using (((NOT es_prueba) OR (select sgc.is_admin())));

alter policy "retiros_select" on sgc.retiros_material
  using (((solicitante_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('direccion'::text)) OR sgc.es_responsable_de_proyecto(proyecto_id)));

alter policy "revisor_solo_demo" on sgc.retiros_material
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "reunion_actas: escribir organizador" on sgc.reunion_actas
  using ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_actas.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid())))))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_actas.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid())))))));

alter policy "reunion_notas: escribir la propia" on sgc.reunion_notas
  using ((usuario_id = (select auth.uid())))
  with check (((usuario_id = (select auth.uid())) AND sgc.puede_ver_reunion(reunion_id)));

alter policy "reunion_tipos: admin escribe" on sgc.reunion_tipos
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "reuniones: insert" on sgc.reuniones
  with check (((organizador_id = (select auth.uid())) AND (select sgc.tiene_modulo('reuniones'::text))));

alter policy "reuniones: update" on sgc.reuniones
  using (((select sgc.is_admin()) OR (organizador_id = (select auth.uid()))))
  with check (((select sgc.is_admin()) OR (organizador_id = (select auth.uid()))));
