-- Reversa de DS-46 lote 9p: restaura las expresiones originales de las politicas.

alter policy "roles_permisos_auditoria_sel_admin" on sgc.roles_permisos_auditoria
  using (sgc.is_admin());

alter policy "rrhh_accesos_log_select" on sgc.rrhh_accesos_log
  using ((sgc.is_admin() OR sgc.puede_rrhh_sensible('rrhh.auditoria'::text)));

alter policy "rrhh_activos_del" on sgc.rrhh_activos
  using (sgc.puede_operar_submodulo('rrhh.activos'::text));

alter policy "rrhh_activos_ins" on sgc.rrhh_activos
  with check (sgc.puede_operar_submodulo('rrhh.activos'::text));

alter policy "rrhh_activos_sel" on sgc.rrhh_activos
  using (sgc.puede_ver_submodulo('rrhh.activos'::text));

alter policy "rrhh_activos_upd" on sgc.rrhh_activos
  using (sgc.puede_operar_submodulo('rrhh.activos'::text))
  with check (sgc.puede_operar_submodulo('rrhh.activos'::text));

alter policy "rrhh_candidatos_del" on sgc.rrhh_candidatos
  using (sgc.puede_operar_submodulo('rrhh.onboarding'::text));

alter policy "rrhh_candidatos_ins" on sgc.rrhh_candidatos
  with check (sgc.puede_operar_submodulo('rrhh.onboarding'::text));

alter policy "rrhh_candidatos_sel" on sgc.rrhh_candidatos
  using (sgc.puede_ver_submodulo('rrhh.onboarding'::text));

alter policy "rrhh_candidatos_upd" on sgc.rrhh_candidatos
  using (sgc.puede_operar_submodulo('rrhh.onboarding'::text))
  with check (sgc.puede_operar_submodulo('rrhh.onboarding'::text));

alter policy "rrhh_candidatos_lecturas: dueño ve" on sgc.rrhh_candidatos_lecturas
  using ((usuario_id = auth.uid()));

alter policy "rrhh_capacitaciones_ins" on sgc.rrhh_capacitaciones
  with check (sgc.puede_operar_submodulo('rrhh.capacitacion'::text));

alter policy "rrhh_capacitaciones_sel" on sgc.rrhh_capacitaciones
  using (sgc.puede_ver_submodulo('rrhh.capacitacion'::text));

alter policy "rrhh_capacitaciones_upd" on sgc.rrhh_capacitaciones
  using (sgc.puede_operar_submodulo('rrhh.capacitacion'::text))
  with check (sgc.puede_operar_submodulo('rrhh.capacitacion'::text));

alter policy "rrhh_evaluaciones_ins" on sgc.rrhh_evaluaciones
  with check (sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'::text));

alter policy "rrhh_evaluaciones_sel" on sgc.rrhh_evaluaciones
  using (sgc.puede_rrhh_sensible('rrhh.evaluaciones'::text));

alter policy "rrhh_evaluaciones_upd" on sgc.rrhh_evaluaciones
  using (sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'::text))
  with check (sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'::text));

alter policy "rrhh_nomina_detalle_ins" on sgc.rrhh_nomina_detalle
  with check (sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text));

alter policy "rrhh_nomina_detalle_sel" on sgc.rrhh_nomina_detalle
  using (sgc.puede_rrhh_sensible('rrhh.nomina'::text));

alter policy "rrhh_nomina_parametros_sel" on sgc.rrhh_nomina_parametros
  using (sgc.puede_rrhh_sensible('rrhh.nomina'::text));

alter policy "rrhh_nomina_parametros_upd" on sgc.rrhh_nomina_parametros
  using (sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text))
  with check (sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text));

alter policy "rrhh_nomina_periodos_ins" on sgc.rrhh_nomina_periodos
  with check (sgc.puede_operar_rrhh_sensible('rrhh.nomina'::text));

alter policy "rrhh_nomina_periodos_sel" on sgc.rrhh_nomina_periodos
  using (sgc.puede_rrhh_sensible('rrhh.nomina'::text));

alter policy "rrhh_proveedores_admin_del" on sgc.rrhh_proveedores_admin
  using (sgc.puede_operar_submodulo('rrhh.proveedores'::text));

alter policy "rrhh_proveedores_admin_ins" on sgc.rrhh_proveedores_admin
  with check (sgc.puede_operar_submodulo('rrhh.proveedores'::text));

alter policy "rrhh_proveedores_admin_sel" on sgc.rrhh_proveedores_admin
  using (sgc.puede_ver_submodulo('rrhh.proveedores'::text));

alter policy "rrhh_proveedores_admin_upd" on sgc.rrhh_proveedores_admin
  using (sgc.puede_operar_submodulo('rrhh.proveedores'::text))
  with check (sgc.puede_operar_submodulo('rrhh.proveedores'::text));

alter policy "rrhh_tramites_del" on sgc.rrhh_tramites
  using (sgc.puede_operar_submodulo('rrhh.tramites'::text));

alter policy "rrhh_tramites_ins" on sgc.rrhh_tramites
  with check (sgc.puede_operar_submodulo('rrhh.tramites'::text));

alter policy "rrhh_tramites_sel" on sgc.rrhh_tramites
  using (sgc.puede_ver_submodulo('rrhh.tramites'::text));

alter policy "rrhh_tramites_upd" on sgc.rrhh_tramites
  using (sgc.puede_operar_submodulo('rrhh.tramites'::text))
  with check (sgc.puede_operar_submodulo('rrhh.tramites'::text));

alter policy "rrhh_vacantes_ins" on sgc.rrhh_vacantes
  with check (sgc.puede_operar_submodulo('rrhh.onboarding'::text));

alter policy "rrhh_vacantes_sel" on sgc.rrhh_vacantes
  using (sgc.puede_ver_submodulo('rrhh.onboarding'::text));

alter policy "rrhh_vacantes_upd" on sgc.rrhh_vacantes
  using (sgc.puede_operar_submodulo('rrhh.onboarding'::text))
  with check (sgc.puede_operar_submodulo('rrhh.onboarding'::text));

alter policy "ruta_eventos: read" on sgc.ruta_eventos
  using ((EXISTS ( SELECT 1
   FROM sgc.rutas r
  WHERE ((r.id = ruta_eventos.ruta_id) AND (sgc.es_flota_elevado() OR (r.creado_por = auth.uid()) OR (r.conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids)))))));

alter policy "secrets_aplicados_sel" on sgc.secrets_aplicados
  using (sgc.is_admin());

alter policy "compra_adjuntos_select" on sgc.solicitud_compra_adjuntos
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_compra sc
  WHERE ((sc.id = solicitud_compra_adjuntos.solicitud_id) AND ((sc.solicitante_id = auth.uid()) OR (sc.aprobador_id = auth.uid()) OR sgc.es_tecnologia())))));

alter policy "sol_mat_ediciones_sel" on sgc.solicitud_material_ediciones
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_material s
  WHERE ((s.id = solicitud_material_ediciones.solicitud_id) AND ((s.solicitante_id = auth.uid()) OR sgc.is_admin() OR sgc.tiene_modulo('inventario'::text))))));

alter policy "sol_mov_items: ver" on sgc.solicitud_movimiento_items
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_movimiento s
  WHERE ((s.id = solicitud_movimiento_items.solicitud_id) AND ((s.solicitante_id = auth.uid()) OR (s.created_by = auth.uid()) OR sgc.es_referente_movimiento())))));

alter policy "solicitudes_ausencia: delete" on sgc.solicitudes_ausencia
  using ((sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text) OR ((solicitado_por = auth.uid()) AND (estado = 'pendiente'::text))));

alter policy "solicitudes_ausencia: insert" on sgc.solicitudes_ausencia
  with check (((solicitado_por = auth.uid()) AND (sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text) OR (EXISTS ( SELECT 1
   FROM sgc.empleados e
  WHERE ((e.id = solicitudes_ausencia.empleado_id) AND (e.usuario_id = auth.uid())))))));

alter policy "solicitudes_ausencia: select" on sgc.solicitudes_ausencia
  using ((sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text) OR (solicitado_por = auth.uid()) OR (EXISTS ( SELECT 1
   FROM sgc.empleados e
  WHERE ((e.id = solicitudes_ausencia.empleado_id) AND (e.usuario_id = auth.uid()))))));

alter policy "solicitudes_ausencia: update" on sgc.solicitudes_ausencia
  using (((sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text)) AND (estado = 'pendiente'::text)))
  with check (((aprobado_por = auth.uid()) AND (estado = ANY (ARRAY['aprobada'::text, 'rechazada'::text]))));

alter policy "solic_elim_ins" on sgc.solicitudes_eliminacion_cuenta
  with check ((usuario_id = auth.uid()));

alter policy "solic_elim_sel" on sgc.solicitudes_eliminacion_cuenta
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "sticker_packs_read" on sgc.sticker_packs
  using ((es_sistema OR (usuario_id = auth.uid())));

alter policy "sticker_recientes_rw" on sgc.sticker_recientes
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "stickers_read" on sgc.stickers
  using ((EXISTS ( SELECT 1
   FROM sgc.sticker_packs p
  WHERE ((p.id = stickers.pack_id) AND (p.es_sistema OR (p.usuario_id = auth.uid()))))));

alter policy "revisor_solo_demo" on sgc.stock_cuarentena_mov
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "subscriptions: tecnologia" on sgc.subscriptions
  using (sgc.es_tecnologia())
  with check (sgc.es_tecnologia());

alter policy "tec_cat_write" on sgc.tec_categorias
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text)));

alter policy "tec_cot_compras_sel" on sgc.tec_cotizacion_compras
  using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text));

alter policy "tec_cot_equipos_sel" on sgc.tec_cotizacion_equipos
  using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text));

alter policy "tec_cotizaciones_mut" on sgc.tec_cotizaciones
  using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text))
  with check (sgc.puede_operar_submodulo('tecnologia.cotizaciones'::text));

alter policy "tec_cotizaciones_sel" on sgc.tec_cotizaciones
  using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'::text));

alter policy "tec_equipo_condiciones_ins" on sgc.tec_equipo_condiciones
  with check ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_operar_submodulo('tecnologia.inventario'::text)));

alter policy "tec_equipo_condiciones_upd" on sgc.tec_equipo_condiciones
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_operar_submodulo('tecnologia.inventario'::text)));

alter policy "tec_equipo_estados_ins" on sgc.tec_equipo_estados
  with check ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_operar_submodulo('tecnologia.inventario'::text)));

alter policy "tec_equipo_estados_upd" on sgc.tec_equipo_estados
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_operar_submodulo('tecnologia.inventario'::text)));

alter policy "tec_equipo_specs_all" on sgc.tec_equipo_specs
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_ver_submodulo('tecnologia.inventario'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_operar_submodulo('tecnologia.inventario'::text)));

alter policy "tec_equipo_tipos_ins" on sgc.tec_equipo_tipos
  with check ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_operar_submodulo('tecnologia.inventario'::text)));

alter policy "tec_equipo_tipos_upd" on sgc.tec_equipo_tipos
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text) OR sgc.puede_operar_submodulo('tecnologia.inventario'::text)));

alter policy "tec_herr_write" on sgc.tec_herramientas
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text)));

alter policy "tec_matriz_write" on sgc.tec_matriz
  using ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('tecnologia'::text)));

alter policy "trabajo_eventos_sel" on sgc.trabajo_eventos
  using ((sgc.es_flota_elevado() OR (por = auth.uid())));

alter policy "trabajos_manual_sel" on sgc.trabajos_manual
  using ((sgc.es_flota_elevado() OR (creado_por = auth.uid()) OR (EXISTS ( SELECT 1
   FROM sgc.conductores c
  WHERE ((c.id = trabajos_manual.conductor_id) AND (c.usuario_id = auth.uid()))))));

alter policy "uso_ia: ver" on sgc.uso_ia
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "usuario_flags_read" on sgc.usuario_flags
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_flota_elevado() OR sgc.es_tecnologia()));

alter policy "upe_select_admin_o_propio" on sgc.usuario_permisos_extra
  using ((sgc.is_admin() OR (usuario_id = auth.uid())));

alter policy "upe_write_admin" on sgc.usuario_permisos_extra
  using (sgc.is_admin())
  with check (sgc.is_admin());
