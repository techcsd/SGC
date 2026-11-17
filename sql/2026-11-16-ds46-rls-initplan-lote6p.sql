-- DS-46 (#71) lote 6p: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: combustible_tarjeta_map, combustible_transacciones_proveedor, compa_casos_prueba, conciliacion_combustible_detalle, conciliaciones_combustible, conduce_despachante_cambios, conduce_receptor_cambios, conductor_multas, conductores, conversacion_participantes, conversaciones, cronograma_baseline, cronograma_tareas_catalogo, cuadre_consumo, cuadre_items, cuadre_obra, dev_acceso, device_tokens, documentos_generados, documentos_proyecto, domain_checks, echada_duplicado_descartado, empleado_asignacion_eventos, empleado_asignaciones, empleado_documentos, empleados, empresa, envios_automaticos, estaciones_combustible, expediente_archivos, expediente_notas, expediente_obra, expedientes_legales, fases_proyecto, flota_config_historial, flota_documentos_lecturas, formulario_ia_propuestas, gasto_categorias, gastos_directos, geocode_cache. Semantica identica; reversa en sql/_reversa/.

alter policy "tarjeta_map: select" on sgc.combustible_tarjeta_map
  using ((select sgc.es_flota_elevado()));

alter policy "comb_trans: flota" on sgc.combustible_transacciones_proveedor
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())))
  with check (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "revisor_solo_demo" on sgc.combustible_transacciones_proveedor
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "compa_casos_prueba: admin" on sgc.compa_casos_prueba
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "concil detalle: elevado" on sgc.conciliacion_combustible_detalle
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())))
  with check (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "concil: elevado" on sgc.conciliaciones_combustible
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())))
  with check (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "conduce_despachante_cambios_sel" on sgc.conduce_despachante_cambios
  using (((select sgc.es_flota_elevado()) OR (EXISTS ( SELECT 1
   FROM sgc.salidas_inventario s
  WHERE ((s.id = conduce_despachante_cambios.salida_id) AND (s.creado_por = (select auth.uid())))))));

alter policy "conduce_receptor_cambios_sel" on sgc.conduce_receptor_cambios
  using (((select sgc.es_flota_elevado()) OR (EXISTS ( SELECT 1
   FROM sgc.salidas_inventario s
  WHERE ((s.id = conduce_receptor_cambios.salida_id) AND (s.creado_por = (select auth.uid())))))));

alter policy "cm_delete" on sgc.conductor_multas
  using ((select sgc.es_flota_elevado()));

alter policy "cm_insert" on sgc.conductor_multas
  with check (((select sgc.es_flota_elevado()) OR (conductor_id IN ( SELECT conductores.id
   FROM sgc.conductores
  WHERE (conductores.usuario_id = (select auth.uid()))))));

alter policy "cm_select" on sgc.conductor_multas
  using (((select sgc.es_flota_elevado()) OR (conductor_id IN ( SELECT conductores.id
   FROM sgc.conductores
  WHERE (conductores.usuario_id = (select auth.uid()))))));

alter policy "cm_write" on sgc.conductor_multas
  using ((select sgc.es_flota_elevado()))
  with check ((select sgc.es_flota_elevado()));

alter policy "es_prueba: oculta a no-admin" on sgc.conductor_multas
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.conductor_multas
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "conductores: delete" on sgc.conductores
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "conductores: insert" on sgc.conductores
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "conductores: select" on sgc.conductores
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "conductores: update" on sgc.conductores
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "es_prueba: oculta a no-admin" on sgc.conductores
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.conductores
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: flota.conductores" on sgc.conductores
  using (((select sgc.submodulo_nivel_explicito('flota.conductores'::text)) = 'operar'::text));

alter policy "submod op-ins: flota.conductores" on sgc.conductores
  with check (((select sgc.submodulo_nivel_explicito('flota.conductores'::text)) = 'operar'::text));

alter policy "submod op-upd: flota.conductores" on sgc.conductores
  using (((select sgc.submodulo_nivel_explicito('flota.conductores'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('flota.conductores'::text)) = 'operar'::text));

alter policy "submod ver: flota.conductores" on sgc.conductores
  using (((select sgc.submodulo_nivel_explicito('flota.conductores'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "conv_participantes: select" on sgc.conversacion_participantes
  using (((select sgc.is_admin()) OR sgc.es_participante(conversacion_id)));

alter policy "conv_participantes: update" on sgc.conversacion_participantes
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "conversaciones: select" on sgc.conversaciones
  using (((select sgc.is_admin()) OR sgc.es_participante(id)));

alter policy "cronograma_baseline_all" on sgc.cronograma_baseline
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))));

alter policy "cronograma_baseline_sel" on sgc.cronograma_baseline
  using ((select sgc.puede_ver_submodulo('obra.avance'::text)));

alter policy "cronograma_catalogo: write admin" on sgc.cronograma_tareas_catalogo
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "cuadre_consumo_sel" on sgc.cuadre_consumo
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "cuadre_items_all" on sgc.cuadre_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('direccion'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "cuadre_obra_all" on sgc.cuadre_obra
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('direccion'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "device_tokens: own" on sgc.device_tokens
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())))
  with check (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())));

alter policy "documentos_generados: delete" on sgc.documentos_generados
  using (((select sgc.is_admin()) OR ((proyecto_id IS NULL) AND (select sgc.tiene_modulo('documentos'::text))) OR ((proyecto_id IS NOT NULL) AND (select sgc.tiene_modulo('proyectos'::text)))));

alter policy "documentos_generados: insert" on sgc.documentos_generados
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('documentos'::text))));

alter policy "documentos_generados: select" on sgc.documentos_generados
  using (((select sgc.is_admin()) OR (generado_por = (select auth.uid())) OR ((proyecto_id IS NULL) AND (select sgc.tiene_modulo('documentos'::text))) OR ((proyecto_id IS NOT NULL) AND ((select sgc.tiene_modulo('proyectos'::text)) OR (EXISTS ( SELECT 1
   FROM (sgc.proyecto_empleados pe
     JOIN sgc.empleados e ON ((e.id = pe.empleado_id)))
  WHERE ((pe.proyecto_id = documentos_generados.proyecto_id) AND (e.usuario_id = (select auth.uid()))))))) OR ((select sgc.tiene_modulo('legal'::text)) AND (EXISTS ( SELECT 1
   FROM sgc.aprobaciones_legales al
  WHERE ((al.referencia_tipo = 'documento_generado'::text) AND (al.referencia_id = documentos_generados.id)))))));

alter policy "documentos_proyecto: delete" on sgc.documentos_proyecto
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "documentos_proyecto: insert" on sgc.documentos_proyecto
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "documentos_proyecto: select" on sgc.documentos_proyecto
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (EXISTS ( SELECT 1
   FROM (sgc.proyecto_empleados pe
     JOIN sgc.empleados e ON ((e.id = pe.empleado_id)))
  WHERE ((pe.proyecto_id = documentos_proyecto.proyecto_id) AND (e.usuario_id = (select auth.uid())))))));

alter policy "domain_checks: read tecnologia" on sgc.domain_checks
  using ((select sgc.es_tecnologia()));

alter policy "echada_dup_desc: flota" on sgc.echada_duplicado_descartado
  using (((select sgc.es_flota_elevado()) OR (select sgc.is_admin())));

alter policy "emp_asig_ev: read" on sgc.empleado_asignacion_eventos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text)) OR (EXISTS ( SELECT 1
   FROM (sgc.empleado_asignaciones a
     JOIN sgc.empleados e ON ((e.id = a.empleado_id)))
  WHERE ((a.id = empleado_asignacion_eventos.asignacion_id) AND (e.usuario_id = (select auth.uid())))))));

alter policy "emp_asig: read" on sgc.empleado_asignaciones
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text)) OR (EXISTS ( SELECT 1
   FROM sgc.empleados e
  WHERE ((e.id = empleado_asignaciones.empleado_id) AND (e.usuario_id = (select auth.uid())))))));

alter policy "es_prueba: oculta a no-admin" on sgc.empleado_asignaciones
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.empleado_asignaciones
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "empleado_documentos: delete" on sgc.empleado_documentos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))));

alter policy "empleado_documentos: insert" on sgc.empleado_documentos
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))));

alter policy "empleado_documentos: select" on sgc.empleado_documentos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))));

alter policy "empleados: delete" on sgc.empleados
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))));

alter policy "empleados: insert" on sgc.empleados
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))));

alter policy "empleados: select" on sgc.empleados
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))));

alter policy "empleados: update" on sgc.empleados
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))));

alter policy "es_prueba: oculta a no-admin" on sgc.empleados
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.empleados
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "empresa_upd" on sgc.empresa
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "envios_automaticos_sel" on sgc.envios_automaticos
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "estaciones: admin" on sgc.estaciones_combustible
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())))
  with check (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "expediente_archivos: delete" on sgc.expediente_archivos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expediente_archivos: insert" on sgc.expediente_archivos
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expediente_archivos: select" on sgc.expediente_archivos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expediente_notas: delete" on sgc.expediente_notas
  using (((select sgc.is_admin()) OR (usuario_id = (select auth.uid()))));

alter policy "expediente_notas: insert" on sgc.expediente_notas
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expediente_notas: select" on sgc.expediente_notas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "exp_obra_all" on sgc.expediente_obra
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('legal'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expedientes_legales: delete" on sgc.expedientes_legales
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expedientes_legales: insert" on sgc.expedientes_legales
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expedientes_legales: select" on sgc.expedientes_legales
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "expedientes_legales: update" on sgc.expedientes_legales
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "fases_proyecto: delete" on sgc.fases_proyecto
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "fases_proyecto: insert" on sgc.fases_proyecto
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "fases_proyecto: select" on sgc.fases_proyecto
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (EXISTS ( SELECT 1
   FROM (sgc.proyecto_empleados pe
     JOIN sgc.empleados e ON ((e.id = pe.empleado_id)))
  WHERE ((pe.proyecto_id = fases_proyecto.proyecto_id) AND (e.usuario_id = (select auth.uid())))))));

alter policy "fases_proyecto: update" on sgc.fases_proyecto
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "flota_config_hist_sel" on sgc.flota_config_historial
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "flota_documentos_lecturas: dueño ve" on sgc.flota_documentos_lecturas
  using ((usuario_id = (select auth.uid())));

alter policy "formulario_ia_propuestas: select" on sgc.formulario_ia_propuestas
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "formulario_ia_propuestas: update propia" on sgc.formulario_ia_propuestas
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "gasto_categorias_wr" on sgc.gasto_categorias
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('proyectos'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "gastos_directos_prueba" on sgc.gastos_directos
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "gastos_directos_rw" on sgc.gastos_directos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('direccion'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "revisor_solo_demo" on sgc.gastos_directos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "geocode_cache: read auth" on sgc.geocode_cache
  using (((select auth.uid()) IS NOT NULL));
