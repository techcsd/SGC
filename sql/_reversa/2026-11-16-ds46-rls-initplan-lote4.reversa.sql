-- Reversa de DS-46 lote 4: restaura las expresiones originales de las politicas.

alter policy "aceptaciones_politicas_ins" on sgc.aceptaciones_politicas
  with check ((usuario_id = auth.uid()));

alter policy "aceptaciones_politicas_sel" on sgc.aceptaciones_politicas
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "cat_diam_ins" on sgc.acero_diametros
  with check (sgc.is_admin());

alter policy "cat_diam_upd" on sgc.acero_diametros
  using (sgc.is_admin())
  with check (sgc.is_admin());

alter policy "actividad_part: select" on sgc.actividad_participantes
  using ((sgc.puede_gestionar_incentivos() OR (usuario_id = auth.uid()) OR (creado_por = auth.uid())));

alter policy "activos_manage" on sgc.activos
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles()))));

alter policy "activos_select" on sgc.activos
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles())) OR ('gerencia'::text = ANY (sgc.get_user_roles()))));

alter policy "activos_fijos: delete" on sgc.activos_fijos
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "activos_fijos: insert" on sgc.activos_fijos
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "activos_fijos: select" on sgc.activos_fijos
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "activos_fijos: update" on sgc.activos_fijos
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "es_prueba: oculta a no-admin" on sgc.activos_fijos
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.activos_fijos
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "agente_acciones: ver" on sgc.agente_acciones
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "agente_acciones_permitidas: ver" on sgc.agente_acciones_permitidas
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "agente_aprobaciones: decidir" on sgc.agente_aprobaciones
  using ((sgc.is_admin() OR sgc.es_tecnologia()))
  with check ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "agente_aprobaciones: ver" on sgc.agente_aprobaciones
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "agente_hallazgos: ver" on sgc.agente_hallazgos
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "agente_informes_diarios: ver" on sgc.agente_informes_diarios
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "agente_pendientes_config: ver/editar lo mío" on sgc.agente_pendientes_config
  using (((usuario_id = auth.uid()) OR sgc.is_admin()))
  with check (((usuario_id = auth.uid()) OR sgc.is_admin()));

alter policy "bitacora_actividades: insert" on sgc.bitacora_actividades
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_actividades.bitacora_id) AND (b.usuario_id = auth.uid())))));

alter policy "bitacora_archivos: insert" on sgc.bitacora_archivos
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_archivos.bitacora_id) AND (b.usuario_id = auth.uid())))));

alter policy "beq: insert" on sgc.bitacora_equipos_alquilados
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_equipos_alquilados.bitacora_id) AND (b.usuario_id = auth.uid())))));

alter policy "bitacora_restricciones: insert" on sgc.bitacora_restricciones
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_restricciones.bitacora_id) AND (b.usuario_id = auth.uid())))));

alter policy "cl_registro_firmas_all" on sgc.cl_registro_firmas
  using ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('bitacora'::text)));

alter policy "conduce_transf es_prueba" on sgc.conduce_transferencias
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "conduce_transf_sel" on sgc.conduce_transferencias
  using ((sgc.is_admin() OR sgc.es_flota_elevado() OR (de_conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids)) OR (a_conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids))));

alter policy "revisor_solo_demo" on sgc.conduce_transferencias
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "revisor_solo_demo" on sgc.conduces_externos
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "consentimientos_sel" on sgc.consentimientos
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "consentimientos_write" on sgc.consentimientos
  using ((usuario_id = auth.uid()))
  with check ((usuario_id = auth.uid()));

alter policy "conteos_select" on sgc.conteos_inventario
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "es_prueba: oculta a no-admin" on sgc.conteos_inventario
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.conteos_inventario
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "submod op-del: inventario.conteos" on sgc.conteos_inventario
  using ((sgc.submodulo_nivel_explicito('inventario.conteos'::text) = 'operar'::text));

alter policy "submod op-ins: inventario.conteos" on sgc.conteos_inventario
  with check ((sgc.submodulo_nivel_explicito('inventario.conteos'::text) = 'operar'::text));

alter policy "submod op-upd: inventario.conteos" on sgc.conteos_inventario
  using ((sgc.submodulo_nivel_explicito('inventario.conteos'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('inventario.conteos'::text) = 'operar'::text));

alter policy "submod ver: inventario.conteos" on sgc.conteos_inventario
  using ((sgc.submodulo_nivel_explicito('inventario.conteos'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "contratos: delete" on sgc.contratos
  using ((sgc.is_admin() OR sgc.tiene_modulo('legal'::text)));

alter policy "contratos: insert" on sgc.contratos
  with check ((sgc.is_admin() OR sgc.tiene_modulo('legal'::text)));

alter policy "contratos: select" on sgc.contratos
  using ((sgc.is_admin() OR sgc.tiene_modulo('legal'::text)));

alter policy "contratos: update" on sgc.contratos
  using ((sgc.is_admin() OR sgc.tiene_modulo('legal'::text)));

alter policy "detalle_entradas: delete" on sgc.detalle_entradas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "detalle_entradas: insert" on sgc.detalle_entradas
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "detalle_entradas: select" on sgc.detalle_entradas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "detalle_entradas: update" on sgc.detalle_entradas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "detalle_entradas_insert" on sgc.detalle_entradas
  with check ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles()))));

alter policy "detalle_entradas_select" on sgc.detalle_entradas
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles())) OR ('gerencia'::text = ANY (sgc.get_user_roles()))));

alter policy "submod op-del: inventario.entradas" on sgc.detalle_entradas
  using ((sgc.submodulo_nivel_explicito('inventario.entradas'::text) = 'operar'::text));

alter policy "submod op-ins: inventario.entradas" on sgc.detalle_entradas
  with check ((sgc.submodulo_nivel_explicito('inventario.entradas'::text) = 'operar'::text));

alter policy "submod op-upd: inventario.entradas" on sgc.detalle_entradas
  using ((sgc.submodulo_nivel_explicito('inventario.entradas'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('inventario.entradas'::text) = 'operar'::text));

alter policy "submod ver: inventario.entradas" on sgc.detalle_entradas
  using ((sgc.submodulo_nivel_explicito('inventario.entradas'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "detalle_salidas: delete" on sgc.detalle_salidas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "detalle_salidas: insert" on sgc.detalle_salidas
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "detalle_salidas: select" on sgc.detalle_salidas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR (EXISTS ( SELECT 1
   FROM ((sgc.salidas_inventario si
     JOIN sgc.proyecto_empleados pe ON ((pe.proyecto_id = si.proyecto_id)))
     JOIN sgc.empleados e ON ((e.id = pe.empleado_id)))
  WHERE ((si.id = detalle_salidas.salida_id) AND (e.usuario_id = auth.uid()))))));

alter policy "detalle_salidas: select conductor" on sgc.detalle_salidas
  using ((EXISTS ( SELECT 1
   FROM (sgc.salidas_inventario si
     LEFT JOIN sgc.conductores c ON ((c.id = si.conductor_id)))
  WHERE ((si.id = detalle_salidas.salida_id) AND ((si.creado_por = auth.uid()) OR (c.usuario_id = auth.uid()))))));

alter policy "detalle_salidas: update" on sgc.detalle_salidas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "detalle_salidas_insert" on sgc.detalle_salidas
  with check ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles()))));

alter policy "detalle_salidas_select" on sgc.detalle_salidas
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles())) OR ('gerencia'::text = ANY (sgc.get_user_roles()))));

alter policy "submod op-del: inventario.salidas" on sgc.detalle_salidas
  using ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text));

alter policy "submod op-ins: inventario.salidas" on sgc.detalle_salidas
  with check ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text));

alter policy "submod op-upd: inventario.salidas" on sgc.detalle_salidas
  using ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text));

alter policy "submod ver: inventario.salidas" on sgc.detalle_salidas
  using ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "incentivo_aprob: select" on sgc.incentivo_aprobacion
  using ((sgc.puede_gestionar_incentivos() OR (EXISTS ( SELECT 1
   FROM sgc.incentivo_semana s
  WHERE ((s.id = incentivo_aprobacion.informe_id) AND (s.usuario_id = auth.uid()))))));

alter policy "incentivo_semana: select" on sgc.incentivo_semana
  using ((sgc.puede_gestionar_incentivos() OR (usuario_id = auth.uid())));

alter policy "es_prueba: oculta a no-admin" on sgc.mantenimientos
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "mantenimientos: delete" on sgc.mantenimientos
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "mantenimientos: insert" on sgc.mantenimientos
  with check ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "mantenimientos: select" on sgc.mantenimientos
  using (sgc.puede_ver_vehiculo(vehiculo_id, auth.uid()));

alter policy "mantenimientos: update" on sgc.mantenimientos
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "revisor_solo_demo" on sgc.mantenimientos
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "submod op-del: flota.mantenimientos" on sgc.mantenimientos
  using ((sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = 'operar'::text));

alter policy "submod op-ins: flota.mantenimientos" on sgc.mantenimientos
  with check ((sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = 'operar'::text));

alter policy "submod op-upd: flota.mantenimientos" on sgc.mantenimientos
  using ((sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = 'operar'::text));

alter policy "submod ver: flota.mantenimientos" on sgc.mantenimientos
  using ((sgc.submodulo_nivel_explicito('flota.mantenimientos'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "orden_compra_items: delete" on sgc.orden_compra_items
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "orden_compra_items: insert" on sgc.orden_compra_items
  with check ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "orden_compra_items: select" on sgc.orden_compra_items
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text) OR sgc.tiene_modulo('inventario'::text)));

alter policy "orden_compra_items: update" on sgc.orden_compra_items
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "submod op-del: compras.ordenes" on sgc.orden_compra_items
  using ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text));

alter policy "submod op-ins: compras.ordenes" on sgc.orden_compra_items
  with check ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text));

alter policy "submod op-upd: compras.ordenes" on sgc.orden_compra_items
  using ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text));

alter policy "submod ver: compras.ordenes" on sgc.orden_compra_items
  using ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "es_prueba: oculta a no-admin" on sgc.ordenes_compra
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "ordenes_compra: delete" on sgc.ordenes_compra
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "ordenes_compra: insert" on sgc.ordenes_compra
  with check ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "ordenes_compra: select" on sgc.ordenes_compra
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text) OR sgc.tiene_modulo('inventario'::text)));

alter policy "ordenes_compra: update" on sgc.ordenes_compra
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "revisor_solo_demo" on sgc.ordenes_compra
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "submod op-del: compras.ordenes" on sgc.ordenes_compra
  using ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text));

alter policy "submod op-ins: compras.ordenes" on sgc.ordenes_compra
  with check ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text));

alter policy "submod op-upd: compras.ordenes" on sgc.ordenes_compra
  using ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = 'operar'::text));

alter policy "submod ver: compras.ordenes" on sgc.ordenes_compra
  using ((sgc.submodulo_nivel_explicito('compras.ordenes'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "es_prueba: oculta a no-admin" on sgc.proveedores
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "proveedores: delete" on sgc.proveedores
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text)));

alter policy "proveedores: insert" on sgc.proveedores
  with check ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text) OR sgc.es_flota_elevado()));

alter policy "proveedores: select" on sgc.proveedores
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text) OR sgc.tiene_modulo('inventario'::text) OR sgc.es_flota_elevado()));

alter policy "proveedores: update" on sgc.proveedores
  using ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text) OR sgc.es_flota_elevado()))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('compras'::text) OR sgc.es_flota_elevado()));

alter policy "proveedores_manage" on sgc.proveedores
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles())) OR ('coord_compras'::text = ANY (sgc.get_user_roles()))));

alter policy "proveedores_submodulo_del" on sgc.proveedores
  using (sgc.puede_operar_submodulo('compras.proveedores'::text));

alter policy "proveedores_submodulo_ins" on sgc.proveedores
  with check (sgc.puede_operar_submodulo('compras.proveedores'::text));

alter policy "proveedores_submodulo_sel" on sgc.proveedores
  using (sgc.puede_ver_submodulo('compras.proveedores'::text));

alter policy "proveedores_submodulo_upd" on sgc.proveedores
  using (sgc.puede_operar_submodulo('compras.proveedores'::text))
  with check (sgc.puede_operar_submodulo('compras.proveedores'::text));

alter policy "revisor_solo_demo" on sgc.proveedores
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "reunion_agenda: escribir organizador" on sgc.reunion_agenda
  using ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_agenda.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_agenda.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid()))))));

alter policy "reunion_participantes: delete" on sgc.reunion_participantes
  using ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid()))))));

alter policy "reunion_participantes: insert" on sgc.reunion_participantes
  with check ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid()))))));

alter policy "reunion_participantes: update propia asistencia" on sgc.reunion_participantes
  using (((usuario_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid())))))))
  with check (((usuario_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND (sgc.is_admin() OR (r.organizador_id = auth.uid())))))));

alter policy "ruta_paradas_sel" on sgc.ruta_paradas
  using ((EXISTS ( SELECT 1
   FROM sgc.rutas r
  WHERE ((r.id = ruta_paradas.ruta_id) AND (sgc.es_flota_elevado() OR (r.creado_por = auth.uid()) OR (r.conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids)))))));

alter policy "submod op-del: flota.rutas" on sgc.ruta_paradas
  using ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text));

alter policy "submod op-ins: flota.rutas" on sgc.ruta_paradas
  with check ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text));

alter policy "submod op-upd: flota.rutas" on sgc.ruta_paradas
  using ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text));

alter policy "submod ver: flota.rutas" on sgc.ruta_paradas
  using ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "salida_firmas_sel" on sgc.salida_firmas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR (EXISTS ( SELECT 1
   FROM sgc.salidas_inventario s
  WHERE ((s.id = salida_firmas.salida_id) AND ((s.creado_por = auth.uid()) OR (EXISTS ( SELECT 1
           FROM sgc.conductores c
          WHERE ((c.id = s.conductor_id) AND (c.usuario_id = auth.uid()))))))))));

alter policy "revisor_solo_demo" on sgc.salida_items_libres
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "salida_items_libres: read auth" on sgc.salida_items_libres
  using ((auth.uid() IS NOT NULL));

alter policy "revisor_solo_demo" on sgc.solicitudes_movimiento
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "sol_mov: es_prueba oculta" on sgc.solicitudes_movimiento
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "sol_mov: select" on sgc.solicitudes_movimiento
  using (((solicitante_id = auth.uid()) OR (created_by = auth.uid()) OR sgc.es_referente_movimiento()));

alter policy "veh_asig_all" on sgc.vehiculo_asignaciones
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "veh_asig_sel" on sgc.vehiculo_asignaciones
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text) OR (usuario_id = auth.uid())));

alter policy "wa_listener_estado_sel" on sgc.wa_listener_estado
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_autorizados_admin" on sgc.whatsapp_autorizados
  using ((sgc.is_admin() OR sgc.es_tecnologia()))
  with check ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "whatsapp_conversaciones_lectura" on sgc.whatsapp_conversaciones
  using ((sgc.is_admin() OR sgc.es_tecnologia()));

alter policy "whatsapp_mensajes_lectura" on sgc.whatsapp_mensajes
  using ((sgc.is_admin() OR sgc.es_tecnologia()));
