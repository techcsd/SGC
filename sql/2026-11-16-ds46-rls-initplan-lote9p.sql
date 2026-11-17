-- DS-46 (#71) lote 9p: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: roles_permisos_auditoria, rrhh_accesos_log, rrhh_activos, rrhh_candidatos, rrhh_candidatos_lecturas, rrhh_capacitaciones, rrhh_evaluaciones, rrhh_nomina_detalle, rrhh_nomina_parametros, rrhh_nomina_periodos, rrhh_proveedores_admin, rrhh_tramites, rrhh_vacantes, ruta_eventos, secrets_aplicados, solicitud_compra_adjuntos, solicitud_material_ediciones, solicitud_movimiento_items, solicitudes_ausencia, solicitudes_eliminacion_cuenta, sticker_packs, sticker_recientes, stickers, stock_cuarentena_mov, subscriptions, tec_categorias, tec_cotizacion_compras, tec_cotizacion_equipos, tec_cotizaciones, tec_equipo_condiciones, tec_equipo_estados, tec_equipo_specs, tec_equipo_tipos, tec_herramientas, tec_matriz, trabajo_eventos, trabajos_manual, uso_ia, usuario_flags, usuario_permisos_extra. Semantica identica; reversa en sql/_reversa/.

alter policy "roles_permisos_auditoria_sel_admin" on sgc.roles_permisos_auditoria
  using ((select sgc.is_admin()));

alter policy "rrhh_accesos_log_select" on sgc.rrhh_accesos_log
  using (((select sgc.is_admin()) OR (select sgc.puede_rrhh_sensible('rrhh.auditoria'::text))));

alter policy "rrhh_activos_del" on sgc.rrhh_activos
  using ((select sgc.puede_operar_submodulo('rrhh.activos'::text)));

alter policy "rrhh_activos_ins" on sgc.rrhh_activos
  with check ((select sgc.puede_operar_submodulo('rrhh.activos'::text)));

alter policy "rrhh_activos_sel" on sgc.rrhh_activos
  using ((select sgc.puede_ver_submodulo('rrhh.activos'::text)));

alter policy "rrhh_activos_upd" on sgc.rrhh_activos
  using ((select sgc.puede_operar_submodulo('rrhh.activos'::text)))
  with check ((select sgc.puede_operar_submodulo('rrhh.activos'::text)));

alter policy "rrhh_candidatos_del" on sgc.rrhh_candidatos
  using ((select sgc.puede_operar_submodulo('rrhh.onboarding'::text)));

alter policy "rrhh_candidatos_ins" on sgc.rrhh_candidatos
  with check ((select sgc.puede_operar_submodulo('rrhh.onboarding'::text)));

alter policy "rrhh_candidatos_sel" on sgc.rrhh_candidatos
  using ((select sgc.puede_ver_submodulo('rrhh.onboarding'::text)));

alter policy "rrhh_candidatos_upd" on sgc.rrhh_candidatos
  using ((select sgc.puede_operar_submodulo('rrhh.onboarding'::text)))
  with check ((select sgc.puede_operar_submodulo('rrhh.onboarding'::text)));

alter policy "rrhh_candidatos_lecturas: dueño ve" on sgc.rrhh_candidatos_lecturas
  using ((usuario_id = (select auth.uid())));

alter policy "rrhh_capacitaciones_ins" on sgc.rrhh_capacitaciones
  with check ((select sgc.puede_operar_submodulo('rrhh.capacitacion'::text)));

alter policy "rrhh_capacitaciones_sel" on sgc.rrhh_capacitaciones
  using ((select sgc.puede_ver_submodulo('rrhh.capacitacion'::text)));

alter policy "rrhh_capacitaciones_upd" on sgc.rrhh_capacitaciones
  using ((select sgc.puede_operar_submodulo('rrhh.capacitacion'::text)))
  with check ((select sgc.puede_operar_submodulo('rrhh.capacitacion'::text)));

alter policy "rrhh_evaluaciones_ins" on sgc.rrhh_evaluaciones
  with check ((select sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'::text)));

alter policy "rrhh_evaluaciones_sel" on sgc.rrhh_evaluaciones
  using ((select sgc.puede_rrhh_sensible('rrhh.evaluaciones'::text)));

alter policy "rrhh_evaluaciones_upd" on sgc.rrhh_evaluaciones
  using ((select sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'::text)))
  with check ((select sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'::text)));

alter policy "rrhh_nomina_detalle_ins" on sgc.rrhh_nomina_detalle
  with check ((select sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text)));

alter policy "rrhh_nomina_detalle_sel" on sgc.rrhh_nomina_detalle
  using ((select sgc.puede_rrhh_sensible('rrhh.nomina'::text)));

alter policy "rrhh_nomina_parametros_sel" on sgc.rrhh_nomina_parametros
  using ((select sgc.puede_rrhh_sensible('rrhh.nomina'::text)));

alter policy "rrhh_nomina_parametros_upd" on sgc.rrhh_nomina_parametros
  using ((select sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text)))
  with check ((select sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text)));

alter policy "rrhh_nomina_periodos_ins" on sgc.rrhh_nomina_periodos
  with check ((select sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text)));

alter policy "rrhh_nomina_periodos_sel" on sgc.rrhh_nomina_periodos
  using ((select sgc.puede_rrhh_sensible('rrhh.nomina'::text)));

alter policy "rrhh_proveedores_admin_del" on sgc.rrhh_proveedores_admin
  using ((select sgc.puede_operar_submodulo('rrhh.proveedores'::text)));

alter policy "rrhh_proveedores_admin_ins" on sgc.rrhh_proveedores_admin
  with check ((select sgc.puede_operar_submodulo('rrhh.proveedores'::text)));

alter policy "rrhh_proveedores_admin_sel" on sgc.rrhh_proveedores_admin
  using ((select sgc.puede_ver_submodulo('rrhh.proveedores'::text)));

alter policy "rrhh_proveedores_admin_upd" on sgc.rrhh_proveedores_admin
  using ((select sgc.puede_operar_submodulo('rrhh.proveedores'::text)))
  with check ((select sgc.puede_operar_submodulo('rrhh.proveedores'::text)));

alter policy "rrhh_tramites_del" on sgc.rrhh_tramites
  using ((select sgc.puede_operar_submodulo('rrhh.tramites'::text)));

alter policy "rrhh_tramites_ins" on sgc.rrhh_tramites
  with check ((select sgc.puede_operar_submodulo('rrhh.tramites'::text)));

alter policy "rrhh_tramites_sel" on sgc.rrhh_tramites
  using ((select sgc.puede_ver_submodulo('rrhh.tramites'::text)));

alter policy "rrhh_tramites_upd" on sgc.rrhh_tramites
  using ((select sgc.puede_operar_submodulo('rrhh.tramites'::text)))
  with check ((select sgc.puede_operar_submodulo('rrhh.tramites'::text)));

alter policy "rrhh_vacantes_ins" on sgc.rrhh_vacantes
  with check ((select sgc.puede_operar_submodulo('rrhh.onboarding'::text)));

alter policy "rrhh_vacantes_sel" on sgc.rrhh_vacantes
  using ((select sgc.puede_ver_submodulo('rrhh.onboarding'::text)));

alter policy "rrhh_vacantes_upd" on sgc.rrhh_vacantes
  using ((select sgc.puede_operar_submodulo('rrhh.onboarding'::text)))
  with check ((select sgc.puede_operar_submodulo('rrhh.onboarding'::text)));

alter policy "ruta_eventos: read" on sgc.ruta_eventos
  using ((EXISTS ( SELECT 1
   FROM sgc.rutas r
  WHERE ((r.id = ruta_eventos.ruta_id) AND ((select sgc.es_flota_elevado()) OR (r.creado_por = (select auth.uid())) OR (r.conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids)))))));

alter policy "secrets_aplicados_sel" on sgc.secrets_aplicados
  using ((select sgc.is_admin()));

alter policy "compra_adjuntos_select" on sgc.solicitud_compra_adjuntos
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_compra sc
  WHERE ((sc.id = solicitud_compra_adjuntos.solicitud_id) AND ((sc.solicitante_id = (select auth.uid())) OR (sc.aprobador_id = (select auth.uid())) OR (select sgc.es_tecnologia()))))));

alter policy "sol_mat_ediciones_sel" on sgc.solicitud_material_ediciones
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_material s
  WHERE ((s.id = solicitud_material_ediciones.solicitud_id) AND ((s.solicitante_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)))))));

alter policy "sol_mov_items: ver" on sgc.solicitud_movimiento_items
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_movimiento s
  WHERE ((s.id = solicitud_movimiento_items.solicitud_id) AND ((s.solicitante_id = (select auth.uid())) OR (s.created_by = (select auth.uid())) OR (select sgc.es_referente_movimiento()))))));

alter policy "solicitudes_ausencia: delete" on sgc.solicitudes_ausencia
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text)) OR ((solicitado_por = (select auth.uid())) AND (estado = 'pendiente'::text))));

alter policy "solicitudes_ausencia: insert" on sgc.solicitudes_ausencia
  with check (((solicitado_por = (select auth.uid())) AND ((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text)) OR (EXISTS ( SELECT 1
   FROM sgc.empleados e
  WHERE ((e.id = solicitudes_ausencia.empleado_id) AND (e.usuario_id = (select auth.uid()))))))));

alter policy "solicitudes_ausencia: select" on sgc.solicitudes_ausencia
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text)) OR (solicitado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM sgc.empleados e
  WHERE ((e.id = solicitudes_ausencia.empleado_id) AND (e.usuario_id = (select auth.uid())))))));

alter policy "solicitudes_ausencia: update" on sgc.solicitudes_ausencia
  using ((((select sgc.is_admin()) OR (select sgc.tiene_modulo('rrhh'::text))) AND (estado = 'pendiente'::text)))
  with check (((aprobado_por = (select auth.uid())) AND (estado = ANY (ARRAY['aprobada'::text, 'rechazada'::text]))));

alter policy "solic_elim_ins" on sgc.solicitudes_eliminacion_cuenta
  with check ((usuario_id = (select auth.uid())));

alter policy "solic_elim_sel" on sgc.solicitudes_eliminacion_cuenta
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "sticker_packs_read" on sgc.sticker_packs
  using ((es_sistema OR (usuario_id = (select auth.uid()))));

alter policy "sticker_recientes_rw" on sgc.sticker_recientes
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "stickers_read" on sgc.stickers
  using ((EXISTS ( SELECT 1
   FROM sgc.sticker_packs p
  WHERE ((p.id = stickers.pack_id) AND (p.es_sistema OR (p.usuario_id = (select auth.uid())))))));

alter policy "revisor_solo_demo" on sgc.stock_cuarentena_mov
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "subscriptions: tecnologia" on sgc.subscriptions
  using ((select sgc.es_tecnologia()))
  with check ((select sgc.es_tecnologia()));

alter policy "tec_cat_write" on sgc.tec_categorias
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text))));

alter policy "tec_cot_compras_sel" on sgc.tec_cotizacion_compras
  using ((select sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text)));

alter policy "tec_cot_equipos_sel" on sgc.tec_cotizacion_equipos
  using ((select sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text)));

alter policy "tec_cotizaciones_mut" on sgc.tec_cotizaciones
  using ((select sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text)))
  with check ((select sgc.puede_operar_submodulo('tecnologia.cotizaciones'::text)));

alter policy "tec_cotizaciones_sel" on sgc.tec_cotizaciones
  using ((select sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text)));

alter policy "tec_equipo_condiciones_ins" on sgc.tec_equipo_condiciones
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_equipo_condiciones_upd" on sgc.tec_equipo_condiciones
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_equipo_estados_ins" on sgc.tec_equipo_estados
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_equipo_estados_upd" on sgc.tec_equipo_estados
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_equipo_specs_all" on sgc.tec_equipo_specs
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_ver_submodulo('tecnologia.inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_equipo_tipos_ins" on sgc.tec_equipo_tipos
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_equipo_tipos_upd" on sgc.tec_equipo_tipos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_herr_write" on sgc.tec_herramientas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text))));

alter policy "tec_matriz_write" on sgc.tec_matriz
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text))));

alter policy "trabajo_eventos_sel" on sgc.trabajo_eventos
  using (((select sgc.es_flota_elevado()) OR (por = (select auth.uid()))));

alter policy "trabajos_manual_sel" on sgc.trabajos_manual
  using (((select sgc.es_flota_elevado()) OR (creado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM sgc.conductores c
  WHERE ((c.id = trabajos_manual.conductor_id) AND (c.usuario_id = (select auth.uid())))))));

alter policy "uso_ia: ver" on sgc.uso_ia
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "usuario_flags_read" on sgc.usuario_flags
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_flota_elevado()) OR (select sgc.es_tecnologia())));

alter policy "upe_select_admin_o_propio" on sgc.usuario_permisos_extra
  using (((select sgc.is_admin()) OR (usuario_id = (select auth.uid()))));

alter policy "upe_write_admin" on sgc.usuario_permisos_extra
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));
