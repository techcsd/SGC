-- DS-46 (#71) lote 4: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: conteos_inventario, consentimientos, proveedores, mantenimientos, orden_compra_items, ordenes_compra, reunion_participantes, reunion_agenda, solicitudes_movimiento, conduces_externos, activos_fijos, contratos, wa_listener_estado, whatsapp_conversaciones, bitacora_actividades, bitacora_archivos, bitacora_equipos_alquilados, bitacora_restricciones, cl_registro_firmas, conduce_transferencias, detalle_entradas, detalle_salidas, incentivo_aprobacion, incentivo_semana, ruta_paradas, salida_firmas, salida_items_libres, vehiculo_asignaciones, whatsapp_autorizados, whatsapp_mensajes, aceptaciones_politicas, acero_diametros, actividad_participantes, activos, agente_acciones, agente_acciones_permitidas, agente_aprobaciones, agente_hallazgos, agente_informes_diarios, agente_pendientes_config. Semantica identica; reversa en sql/_reversa/.

alter policy "aceptaciones_politicas_ins" on sgc.aceptaciones_politicas
  with check ((usuario_id = (select auth.uid())));

alter policy "aceptaciones_politicas_sel" on sgc.aceptaciones_politicas
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "cat_diam_ins" on sgc.acero_diametros
  with check ((select sgc.is_admin()));

alter policy "cat_diam_upd" on sgc.acero_diametros
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "actividad_part: select" on sgc.actividad_participantes
  using (((select sgc.puede_gestionar_incentivos()) OR (usuario_id = (select auth.uid())) OR (creado_por = (select auth.uid()))));

alter policy "activos_manage" on sgc.activos
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "activos_select" on sgc.activos
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('gerencia'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "activos_fijos: delete" on sgc.activos_fijos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "activos_fijos: insert" on sgc.activos_fijos
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "activos_fijos: select" on sgc.activos_fijos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "activos_fijos: update" on sgc.activos_fijos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "es_prueba: oculta a no-admin" on sgc.activos_fijos
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.activos_fijos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "agente_acciones: ver" on sgc.agente_acciones
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "agente_acciones_permitidas: ver" on sgc.agente_acciones_permitidas
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "agente_aprobaciones: decidir" on sgc.agente_aprobaciones
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())))
  with check (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "agente_aprobaciones: ver" on sgc.agente_aprobaciones
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "agente_hallazgos: ver" on sgc.agente_hallazgos
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "agente_informes_diarios: ver" on sgc.agente_informes_diarios
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "agente_pendientes_config: ver/editar lo mío" on sgc.agente_pendientes_config
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())))
  with check (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())));

alter policy "bitacora_actividades: insert" on sgc.bitacora_actividades
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_actividades.bitacora_id) AND (b.usuario_id = (select auth.uid()))))));

alter policy "bitacora_archivos: insert" on sgc.bitacora_archivos
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_archivos.bitacora_id) AND (b.usuario_id = (select auth.uid()))))));

alter policy "beq: insert" on sgc.bitacora_equipos_alquilados
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_equipos_alquilados.bitacora_id) AND (b.usuario_id = (select auth.uid()))))));

alter policy "bitacora_restricciones: insert" on sgc.bitacora_restricciones
  with check ((EXISTS ( SELECT 1
   FROM sgc.bitacoras b
  WHERE ((b.id = bitacora_restricciones.bitacora_id) AND (b.usuario_id = (select auth.uid()))))));

alter policy "cl_registro_firmas_all" on sgc.cl_registro_firmas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "conduce_transf es_prueba" on sgc.conduce_transferencias
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "conduce_transf_sel" on sgc.conduce_transferencias
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado()) OR (de_conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids)) OR (a_conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids))));

alter policy "revisor_solo_demo" on sgc.conduce_transferencias
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "revisor_solo_demo" on sgc.conduces_externos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "consentimientos_sel" on sgc.consentimientos
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "consentimientos_write" on sgc.consentimientos
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "conteos_select" on sgc.conteos_inventario
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "es_prueba: oculta a no-admin" on sgc.conteos_inventario
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.conteos_inventario
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: inventario.conteos" on sgc.conteos_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text));

alter policy "submod op-ins: inventario.conteos" on sgc.conteos_inventario
  with check (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text));

alter policy "submod op-upd: inventario.conteos" on sgc.conteos_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text));

alter policy "submod ver: inventario.conteos" on sgc.conteos_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "contratos: delete" on sgc.contratos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "contratos: insert" on sgc.contratos
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "contratos: select" on sgc.contratos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "contratos: update" on sgc.contratos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('legal'::text))));

alter policy "detalle_entradas: delete" on sgc.detalle_entradas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "detalle_entradas: insert" on sgc.detalle_entradas
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "detalle_entradas: select" on sgc.detalle_entradas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "detalle_entradas: update" on sgc.detalle_entradas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "detalle_entradas_insert" on sgc.detalle_entradas
  with check ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "detalle_entradas_select" on sgc.detalle_entradas
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('gerencia'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "submod op-del: inventario.entradas" on sgc.detalle_entradas
  using (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text));

alter policy "submod op-ins: inventario.entradas" on sgc.detalle_entradas
  with check (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text));

alter policy "submod op-upd: inventario.entradas" on sgc.detalle_entradas
  using (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text));

alter policy "submod ver: inventario.entradas" on sgc.detalle_entradas
  using (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "detalle_salidas: delete" on sgc.detalle_salidas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "detalle_salidas: insert" on sgc.detalle_salidas
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "detalle_salidas: select" on sgc.detalle_salidas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR (EXISTS ( SELECT 1
   FROM ((sgc.salidas_inventario si
     JOIN sgc.proyecto_empleados pe ON ((pe.proyecto_id = si.proyecto_id)))
     JOIN sgc.empleados e ON ((e.id = pe.empleado_id)))
  WHERE ((si.id = detalle_salidas.salida_id) AND (e.usuario_id = (select auth.uid())))))));

alter policy "detalle_salidas: select conductor" on sgc.detalle_salidas
  using ((EXISTS ( SELECT 1
   FROM (sgc.salidas_inventario si
     LEFT JOIN sgc.conductores c ON ((c.id = si.conductor_id)))
  WHERE ((si.id = detalle_salidas.salida_id) AND ((si.creado_por = (select auth.uid())) OR (c.usuario_id = (select auth.uid())))))));

alter policy "detalle_salidas: update" on sgc.detalle_salidas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "detalle_salidas_insert" on sgc.detalle_salidas
  with check ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "detalle_salidas_select" on sgc.detalle_salidas
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('gerencia'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "submod op-del: inventario.salidas" on sgc.detalle_salidas
  using (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text));

alter policy "submod op-ins: inventario.salidas" on sgc.detalle_salidas
  with check (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text));

alter policy "submod op-upd: inventario.salidas" on sgc.detalle_salidas
  using (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text));

alter policy "submod ver: inventario.salidas" on sgc.detalle_salidas
  using (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "incentivo_aprob: select" on sgc.incentivo_aprobacion
  using (((select sgc.puede_gestionar_incentivos()) OR (EXISTS ( SELECT 1
   FROM sgc.incentivo_semana s
  WHERE ((s.id = incentivo_aprobacion.informe_id) AND (s.usuario_id = (select auth.uid())))))));

alter policy "incentivo_semana: select" on sgc.incentivo_semana
  using (((select sgc.puede_gestionar_incentivos()) OR (usuario_id = (select auth.uid()))));

alter policy "es_prueba: oculta a no-admin" on sgc.mantenimientos
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "mantenimientos: delete" on sgc.mantenimientos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "mantenimientos: insert" on sgc.mantenimientos
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "mantenimientos: select" on sgc.mantenimientos
  using (sgc.puede_ver_vehiculo(vehiculo_id, (select auth.uid())));

alter policy "mantenimientos: update" on sgc.mantenimientos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "revisor_solo_demo" on sgc.mantenimientos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: flota.mantenimientos" on sgc.mantenimientos
  using (((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = 'operar'::text));

alter policy "submod op-ins: flota.mantenimientos" on sgc.mantenimientos
  with check (((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = 'operar'::text));

alter policy "submod op-upd: flota.mantenimientos" on sgc.mantenimientos
  using (((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = 'operar'::text));

alter policy "submod ver: flota.mantenimientos" on sgc.mantenimientos
  using (((select sgc.submodulo_nivel_explicito('flota.mantenimientos'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "orden_compra_items: delete" on sgc.orden_compra_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "orden_compra_items: insert" on sgc.orden_compra_items
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "orden_compra_items: select" on sgc.orden_compra_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "orden_compra_items: update" on sgc.orden_compra_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "submod op-del: compras.ordenes" on sgc.orden_compra_items
  using (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text));

alter policy "submod op-ins: compras.ordenes" on sgc.orden_compra_items
  with check (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text));

alter policy "submod op-upd: compras.ordenes" on sgc.orden_compra_items
  using (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text));

alter policy "submod ver: compras.ordenes" on sgc.orden_compra_items
  using (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "es_prueba: oculta a no-admin" on sgc.ordenes_compra
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "ordenes_compra: delete" on sgc.ordenes_compra
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "ordenes_compra: insert" on sgc.ordenes_compra
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "ordenes_compra: select" on sgc.ordenes_compra
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "ordenes_compra: update" on sgc.ordenes_compra
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "revisor_solo_demo" on sgc.ordenes_compra
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: compras.ordenes" on sgc.ordenes_compra
  using (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text));

alter policy "submod op-ins: compras.ordenes" on sgc.ordenes_compra
  with check (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text));

alter policy "submod op-upd: compras.ordenes" on sgc.ordenes_compra
  using (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = 'operar'::text));

alter policy "submod ver: compras.ordenes" on sgc.ordenes_compra
  using (((select sgc.submodulo_nivel_explicito('compras.ordenes'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "es_prueba: oculta a no-admin" on sgc.proveedores
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "proveedores: delete" on sgc.proveedores
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "proveedores: insert" on sgc.proveedores
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.es_flota_elevado())));

alter policy "proveedores: select" on sgc.proveedores
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.tiene_modulo('inventario'::text)) OR (select sgc.es_flota_elevado())));

alter policy "proveedores: update" on sgc.proveedores
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.es_flota_elevado())))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)) OR (select sgc.es_flota_elevado())));

alter policy "proveedores_manage" on sgc.proveedores
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('coord_compras'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "proveedores_submodulo_del" on sgc.proveedores
  using ((select sgc.puede_operar_submodulo('compras.proveedores'::text)));

alter policy "proveedores_submodulo_ins" on sgc.proveedores
  with check ((select sgc.puede_operar_submodulo('compras.proveedores'::text)));

alter policy "proveedores_submodulo_sel" on sgc.proveedores
  using ((select sgc.puede_ver_submodulo('compras.proveedores'::text)));

alter policy "proveedores_submodulo_upd" on sgc.proveedores
  using ((select sgc.puede_operar_submodulo('compras.proveedores'::text)))
  with check ((select sgc.puede_operar_submodulo('compras.proveedores'::text)));

alter policy "revisor_solo_demo" on sgc.proveedores
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "reunion_agenda: escribir organizador" on sgc.reunion_agenda
  using ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_agenda.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid())))))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_agenda.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid())))))));

alter policy "reunion_participantes: delete" on sgc.reunion_participantes
  using ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid())))))));

alter policy "reunion_participantes: insert" on sgc.reunion_participantes
  with check ((EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid())))))));

alter policy "reunion_participantes: update propia asistencia" on sgc.reunion_participantes
  using (((usuario_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid()))))))))
  with check (((usuario_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM sgc.reuniones r
  WHERE ((r.id = reunion_participantes.reunion_id) AND ((select sgc.is_admin()) OR (r.organizador_id = (select auth.uid()))))))));

alter policy "ruta_paradas_sel" on sgc.ruta_paradas
  using ((EXISTS ( SELECT 1
   FROM sgc.rutas r
  WHERE ((r.id = ruta_paradas.ruta_id) AND ((select sgc.es_flota_elevado()) OR (r.creado_por = (select auth.uid())) OR (r.conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids)))))));

alter policy "submod op-del: flota.rutas" on sgc.ruta_paradas
  using (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text));

alter policy "submod op-ins: flota.rutas" on sgc.ruta_paradas
  with check (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text));

alter policy "submod op-upd: flota.rutas" on sgc.ruta_paradas
  using (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text));

alter policy "submod ver: flota.rutas" on sgc.ruta_paradas
  using (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "salida_firmas_sel" on sgc.salida_firmas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR (EXISTS ( SELECT 1
   FROM sgc.salidas_inventario s
  WHERE ((s.id = salida_firmas.salida_id) AND ((s.creado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM sgc.conductores c
          WHERE ((c.id = s.conductor_id) AND (c.usuario_id = (select auth.uid())))))))))));

alter policy "revisor_solo_demo" on sgc.salida_items_libres
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "salida_items_libres: read auth" on sgc.salida_items_libres
  using (((select auth.uid()) IS NOT NULL));

alter policy "revisor_solo_demo" on sgc.solicitudes_movimiento
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "sol_mov: es_prueba oculta" on sgc.solicitudes_movimiento
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "sol_mov: select" on sgc.solicitudes_movimiento
  using (((solicitante_id = (select auth.uid())) OR (created_by = (select auth.uid())) OR (select sgc.es_referente_movimiento())));

alter policy "veh_asig_all" on sgc.vehiculo_asignaciones
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "veh_asig_sel" on sgc.vehiculo_asignaciones
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text)) OR (usuario_id = (select auth.uid()))));

alter policy "wa_listener_estado_sel" on sgc.wa_listener_estado
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_autorizados_admin" on sgc.whatsapp_autorizados
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())))
  with check (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "whatsapp_conversaciones_lectura" on sgc.whatsapp_conversaciones
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "whatsapp_mensajes_lectura" on sgc.whatsapp_mensajes
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));
